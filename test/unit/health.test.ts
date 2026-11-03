import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { candidates, resolveBinary, checkBinary, hasLsp, report, BUILD_HINT, MISSING_TOKENS } from '../../src/health';

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
  const p = fake(join(home, 'go/bin'), `echo '${TREE}'`);
  assert.equal(await resolveBinary('alder', { PATH: '/nonexistent' }, home), p);
});

test('a non-executable file is skipped', async () => {
  const home = dir();
  mkdirSync(join(home, 'bin'), { recursive: true });
  writeFileSync(join(home, 'bin/alder'), 'not executable');
  assert.equal(await resolveBinary('alder', { PATH: '' }, home), undefined);
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
