import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { candidates, checkBinary, hasLsp, report, BUILD_HINT, MISSING_TOKENS } from '../../src/health';

function dir(): string { return realpathSync(mkdtempSync(join(tmpdir(), 'alder-health-'))); }

// fake writes an executable shell script named alder into d.
function fake(d: string, body: string): string {
  mkdirSync(d, { recursive: true });
  const p = join(d, 'alder');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

const TREE = '{"version":"(devel)","commands":[{"name":"check"},{"name":"lsp"}]}';

test('an absolute setting is the only candidate', () => {
  assert.deepEqual(candidates('/opt/alder', { PATH: '/usr/bin' }, '/home/u'), ['/opt/alder']);
});

test('a bare name searches PATH, then GOBIN, GOPATH/bin, ~/go/bin, ~/bin', () => {
  const env = { PATH: ['/a', '/b'].join(delimiter), GOBIN: '/gobin', GOPATH: ['/gp', '/gp2'].join(delimiter) };
  assert.deepEqual(candidates('alder', env, '/home/u'),
    ['/a/alder', '/b/alder', '/gobin/alder', '/gp/bin/alder', '/home/u/go/bin/alder', '/home/u/bin/alder']);
});

test('the Dock case: not on PATH, found in ~/go/bin', async () => {
  const home = dir();
  const p = fake(join(home, 'go/bin'), `case "$1" in help) echo '${TREE}';; esac`);
  assert.equal((await checkBinary('alder', { PATH: '/nonexistent' }, home)).path, p);
});

test('a non-executable file is not a candidate', async () => {
  const home = dir();
  mkdirSync(join(home, 'bin'), { recursive: true });
  writeFileSync(join(home, 'bin/alder'), 'not executable');
  assert.equal((await checkBinary('alder', { PATH: '' }, home)).path, undefined);
});

test('hasLsp needs a command tree that lists lsp', () => {
  assert.equal(hasLsp(TREE), true);
  assert.equal(hasLsp('{"commands":[{"name":"check"}]}'), false);
  assert.equal(hasLsp('usage: alder <command>'), false);
  assert.equal(hasLsp('{"commands":"lsp"}'), false);
});

test('the gate passes a current alder and reads its version', async () => {
  const home = dir();
  fake(join(home, 'bin'), `case "$1" in help) echo '${TREE}';; version) echo 'alder 1.2.3 (go 1.27)';; esac`);
  const g = await checkBinary('alder', { PATH: '' }, home);
  assert.equal(g.ok, true, g.problem);
  assert.equal(g.version, 'alder 1.2.3 (go 1.27)');
});

test('an old alder (help --json prints text, exit 0) fails the gate with the build hint', async () => {
  const home = dir();
  fake(join(home, 'bin'), `echo 'usage: alder <command>'`);
  const g = await checkBinary('alder', { PATH: '' }, home);
  assert.equal(g.ok, false);
  assert.match(g.problem!, /help --json/);
  assert.ok(g.problem!.includes(BUILD_HINT));
});

test('a binary that exits non-zero fails the gate', async () => {
  const home = dir();
  fake(join(home, 'bin'), 'exit 3');
  assert.equal((await checkBinary('alder', { PATH: '' }, home)).ok, false);
});

test('no binary: the problem names where it looked and the build hint', async () => {
  const g = await checkBinary('alder', { PATH: '' }, dir());
  assert.equal(g.ok, false);
  assert.equal(g.path, undefined);
  assert.match(g.problem!, /alder\.path/);
  assert.ok(g.problem!.includes(BUILD_HINT));
});

test('the report says what is missing and never prints a secret', () => {
  const lines = report(
    { path: '/bin/alder', version: 'alder 1.2.3', ok: true },
    [{ root: '/w/blog', running: true, tokens: false, scratch: true }],
    { ANTHROPIC_API_KEY: 'sk-secret', ALDER_FILL_COMMAND: '' },
  );
  const text = lines.join('\n');
  assert.match(text, /\/bin\/alder \(alder 1\.2\.3\)/);
  assert.match(text, /alder lsp running for \/w\/blog/);
  assert.ok(text.includes(MISSING_TOKENS));
  assert.match(text, /ANTHROPIC_API_KEY: set/);
  assert.match(text, /ALDER_FILL_COMMAND: not set/);
  assert.ok(!text.includes('sk-secret'));
});

test('the report with no server running says how to start one', () => {
  const text = report({ ok: false, problem: 'x' }, [], {}).join('\n');
  assert.match(text, /no alder lsp running \(open an \.alder file inside an app\)/);
});

test('candidates expands ~/ in alder.path to the home directory', () => {
  assert.deepEqual(candidates('~/bin/alder', { PATH: '/usr/bin' }, '/home/u'), ['/home/u/bin/alder']);
});

const OLD = `case "$1" in help) echo 'usage: alder <command>';; version) echo 'alder v0.1.0';; esac`;
const NEW = `case "$1" in help) echo '${TREE}';; version) echo 'alder 1.2.3';; esac`;

test('an old alder first on PATH is skipped for one with lsp in ~/go/bin', async () => {
  const home = dir();
  const pdir = dir();
  const old = fake(pdir, OLD);
  const cur = fake(join(home, 'go/bin'), NEW);
  const g = await checkBinary('alder', { PATH: pdir }, home);
  assert.equal(g.ok, true, g.problem);
  assert.equal(g.path, cur);
  assert.deepEqual(g.skipped, [{ path: old, version: 'alder v0.1.0' }]);
});

test('with alder.path set to a path, only that binary is checked', async () => {
  const home = dir();
  const old = fake(dir(), OLD);
  fake(join(home, 'go/bin'), NEW);
  const g = await checkBinary(old, { PATH: '' }, home);
  assert.equal(g.ok, false);
  assert.equal(g.path, old);
  assert.ok(!g.skipped || g.skipped.length === 0);
});

test('when none has lsp, the first is reported and the rest are skipped', async () => {
  const home = dir();
  const pdir = dir();
  const first = fake(pdir, OLD);
  const second = fake(join(home, 'bin'), OLD);
  const g = await checkBinary('alder', { PATH: pdir }, home);
  assert.equal(g.ok, false);
  assert.equal(g.path, first);
  assert.match(g.problem!, /help --json/);
  assert.ok(g.problem!.includes(BUILD_HINT));
  assert.deepEqual(g.skipped, [{ path: second, version: 'alder v0.1.0' }]);
});

test('report lists skipped binaries', () => {
  const lines = report(
    { path: '/new/alder', version: 'alder 1.2.3', ok: true, skipped: [{ path: '/old/alder', version: 'alder v0.1.0' }, { path: '/older/alder' }] },
    [], {});
  assert.equal(lines[0], 'binary: /new/alder (alder 1.2.3)');
  assert.equal(lines[1], 'skipped: /old/alder (alder v0.1.0): failed the `lsp` check');
  assert.equal(lines[2], 'skipped: /older/alder: failed the `lsp` check');
  assert.match(lines[3], /^ok:/);
});

test('candidates returns a repeated directory once, keeping the first occurrence', () => {
  const env = { PATH: ['/a', '/b', '/a'].join(delimiter), GOBIN: '/b' };
  assert.deepEqual(candidates('alder', env, '/home/u'),
    ['/a/alder', '/b/alder', '/home/u/go/bin/alder', '/home/u/bin/alder']);
});

test('an old alder reachable twice is listed once in skipped', async () => {
  const home = dir();
  const old = join(dir(), 'old');
  fake(old, OLD);
  const good = join(home, 'go/bin');
  fake(good, NEW);
  const g = await checkBinary('alder', { PATH: [old, old].join(delimiter) }, home);
  assert.equal(g.ok, true, g.problem);
  assert.deepEqual(g.skipped?.map(s => s.path), [join(old, 'alder')]);
});

test('an old alder reachable twice and the only one is not also listed as skipped', async () => {
  const old = join(dir(), 'old');
  fake(old, OLD);
  const g = await checkBinary('alder', { PATH: [old, old].join(delimiter) }, dir());
  assert.equal(g.ok, false);
  assert.equal(g.path, join(old, 'alder'));
  assert.equal(g.skipped, undefined);
});

test('three candidates: skipped keeps the PATH order', async () => {
  const home = dir();
  const a = fake(dir(), OLD);
  const b = fake(dir(), OLD);
  const cur = fake(join(home, 'bin'), NEW);
  const g = await checkBinary('alder', { PATH: [join(a, '..'), join(b, '..')].join(delimiter) }, home);
  assert.equal(g.ok, true, g.problem);
  assert.equal(g.path, cur);
  assert.deepEqual(g.skipped?.map(s => s.path), [a, b]);
});

test('skipped is absent when the first candidate passes', async () => {
  const home = dir();
  const pdir = dir();
  const first = fake(pdir, NEW);
  fake(join(home, 'bin'), OLD);
  const g = await checkBinary('alder', { PATH: pdir }, home);
  assert.equal(g.ok, true, g.problem);
  assert.equal(g.path, first);
  assert.equal(g.skipped, undefined);
});
