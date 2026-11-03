import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode, run, reportOf, bugText, shellQuote, CliResult } from '../../src/cli';

function dir(): string { return realpathSync(mkdtempSync(join(tmpdir(), 'alder-cli-'))); }

// fake writes an executable shell script and returns its path.
function fake(body: string): string {
  const p = join(dir(), 'alder');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

function res(over: Partial<CliResult>): CliResult {
  return { code: 0, signal: null, stdout: '', stderr: '', objects: [], json: undefined, cancelled: false, ...over };
}

test('decode keeps every JSON object printed one per line and skips the rest', () => {
  const out = decode('{"a":1}\nnot json\n  {"b":2}\n{broken\n[1,2]\n"x"\n');
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(decode(''), []);
});

test('run gives the exit code, both streams, the objects and the first object', async () => {
  const bin = fake(`echo '{"name":"t","ok":true}'; echo '{"score":1}'; echo 'summary' >&2; exit 1`);
  const r = await run(bin, ['test', '--json'], { cwd: dir() });
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trim(), 'summary');
  assert.deepEqual(r.objects, [{ name: 't', ok: true }, { score: 1 }]);
  assert.deepEqual(r.json, { name: 't', ok: true });
  assert.equal(r.cancelled, false);
});

test('run passes the arguments, the working directory and the environment', async () => {
  const bin = fake('echo "$PWD|$1|$2|$ALDER_X"');
  const cwd = dir();
  const r = await run(bin, ['a b', 'c'], { cwd, env: { ...process.env, ALDER_X: 'y' } });
  assert.equal(r.stdout.trim(), `${cwd}|a b|c|y`);
});

test('an abort kills the run with SIGTERM and marks it cancelled', async () => {
  const bin = fake('exec sleep 30');
  const ac = new AbortController();
  const p = run(bin, [], { cwd: dir(), signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  const started = Date.now();
  const r = await p;
  assert.ok(Date.now() - started < 10_000, 'the run was not killed');
  assert.equal(r.cancelled, true);
  assert.equal(r.signal, 'SIGTERM');
});

test('an already-aborted signal never leaves the child running', async () => {
  const ac = new AbortController();
  ac.abort();
  const r = await run(fake('exec sleep 30'), [], { cwd: dir(), signal: ac.signal });
  assert.equal(r.cancelled, true);
});

test('a missing binary resolves with the spawn error in stderr', async () => {
  const r = await run(join(dir(), 'nope'), [], { cwd: dir() });
  assert.equal(r.code, null);
  assert.match(r.stderr, /ENOENT/);
});

test('reportOf: a JSON error as is, exit 2 a bug, else stderr, stdout or the exit code', () => {
  assert.deepEqual(reportOf(['routes'], res({ code: 1, json: { error: 'no app' } })), { kind: 'error', message: 'no app' });
  assert.deepEqual(reportOf(['test'], res({ code: 2, stderr: 'panic' })), { kind: 'bug' });
  assert.deepEqual(reportOf(['explain', 'E1'], res({ code: 2, stderr: 'usage' }), { bugOn2: false }), { kind: 'error', message: 'usage' });
  assert.deepEqual(reportOf(['test'], res({ code: 1, stderr: '  tests fail: fix them\n' })), { kind: 'error', message: 'tests fail: fix them' });
  assert.deepEqual(reportOf(['test'], res({ code: 1, stdout: 'out\n' })), { kind: 'error', message: 'out' });
  assert.deepEqual(reportOf(['test', '--json'], res({ code: 3 })), { kind: 'error', message: 'alder test exited 3' });
});

test('bugText names the command, the output and the version', () => {
  const t = bugText(['test', '--json', '/app'], res({ code: 2, stderr: 'panic: x\n' }), 'alder devel+abc');
  assert.equal(t, [
    'This may be a compiler bug; `alder version` and the command are in this document.',
    '',
    '$ alder test --json /app',
    '',
    'panic: x',
    '',
    '$ alder version',
    'alder devel+abc',
    '',
  ].join('\n'));
});

test('shellQuote leaves plain paths alone and single-quotes the rest', () => {
  assert.equal(shellQuote('/usr/local/bin/alder'), '/usr/local/bin/alder');
  assert.equal(shellQuote('/Users/a b/alder'), `'/Users/a b/alder'`);
  assert.equal(shellQuote(`/x/it's`), `'/x/it'\\''s'`);
});

test('a cancelled run settles on exit, not waiting for a child that holds its pipes', async () => {
  const bin = fake('sleep 30');
  const ac = new AbortController();
  const p = run(bin, [], { cwd: dir(), signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  const started = Date.now();
  const r = await p;
  assert.equal(r.cancelled, true);
  assert.ok(Date.now() - started < 5000, 'settled late');
});
