import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleProblems, bundleRequires, EXPECTED_VSIX, main, releaseNotes, tagVersion, vsixProblems } from '../../scripts/release';

const LOG = [
  '# Changelog',
  '',
  '## 0.2.0-rc.1',
  '',
  '- rc notes',
  '',
  '## 0.1.0',
  '',
  '- First release.',
  '- Scratch files.',
  '',
  '## 0.0.9',
  '',
  '',
  '## 0.0.1',
  '',
  '- old',
  '',
].join('\n');

test('tagVersion accepts v<version> equal to the package version', () => {
  assert.equal(tagVersion('v0.1.0', '0.1.0'), '0.1.0');
  assert.equal(tagVersion('refs/tags/v0.1.0', '0.1.0'), '0.1.0');
});

test('tagVersion refuses a mismatched or v-less tag', () => {
  assert.throws(() => tagVersion('v0.1.0', '0.0.1'), /tag v0\.1\.0 does not match package\.json version 0\.0\.1/);
  assert.throws(() => tagVersion('0.1.0', '0.1.0'), /tag 0\.1\.0 is not v<version>/);
  assert.throws(() => tagVersion('v0.1.0-rc.1', '0.1.0'), /does not match/);
});

test('releaseNotes cuts the version\'s section, trimmed', () => {
  assert.equal(releaseNotes(LOG, '0.1.0'), '- First release.\n- Scratch files.');
  assert.equal(releaseNotes(LOG, '0.2.0-rc.1'), '- rc notes');
  assert.equal(releaseNotes(LOG, '0.0.1'), '- old');
});

test('releaseNotes accepts a heading with a date after the version', () => {
  assert.equal(releaseNotes('## 0.1.0 (2026-11-04)\n\n- x\n', '0.1.0'), '- x');
});

test('releaseNotes takes CRLF text', () => {
  assert.equal(releaseNotes(LOG.replace(/\n/g, '\r\n'), '0.1.0'), '- First release.\n- Scratch files.');
});

test('releaseNotes refuses a missing, empty or prefix-matching section', () => {
  assert.throws(() => releaseNotes(LOG, '0.3.0'), /CHANGELOG\.md has no "## 0\.3\.0" section/);
  assert.throws(() => releaseNotes(LOG, '0.0.9'), /CHANGELOG\.md's "## 0\.0\.9" section is empty/);
  assert.throws(() => releaseNotes('## 0.1.0-rc.1\n\n- x\n## 0.1.01\n\n- y\n', '0.1.0'), /no "## 0\.1\.0" section/);
  assert.throws(() => releaseNotes('## Unreleased\n\n- x\n', '0.1.0'), /no "## 0\.1\.0" section/);
});

test('vsixProblems is empty for the expected entries in any order', () => {
  assert.deepEqual(vsixProblems([...EXPECTED_VSIX].reverse()), []);
});

test('vsixProblems names missing and unexpected entries', () => {
  const entries = EXPECTED_VSIX.filter(e => e !== 'extension/dist/extension.js')
    .concat(['extension/dist/extension.js.map', 'extension/node_modules/vscode-languageclient/package.json']);
  assert.deepEqual(vsixProblems(entries), [
    'missing from the .vsix: extension/dist/extension.js',
    'unexpected in the .vsix: extension/dist/extension.js.map',
    'unexpected in the .vsix: extension/node_modules/vscode-languageclient/package.json',
  ]);
});

test('vsixProblems ignores directory entries', () => {
  assert.deepEqual(vsixProblems([...EXPECTED_VSIX, 'extension/', 'extension/dist/']), []);
});

test('bundleRequires lists each required module once, sorted', () => {
  const js = 'var a=require("vscode"),b=require("node:fs");const c=require("path");require("vscode");require(\'os\')';
  assert.deepEqual(bundleRequires(js), ['node:fs', 'os', 'path', 'vscode']);
});

test('bundleProblems accepts vscode and Node built-ins', () => {
  assert.deepEqual(bundleProblems(['child_process', 'fs/promises', 'node:fs/promises', 'readline', 'vscode']), []);
});

test('bundleProblems refuses a non-builtin require', () => {
  assert.deepEqual(bundleProblems(['vscode', 'vscode-languageclient/node', 'node:path']), [
    'the bundle requires vscode-languageclient/node (not vscode or a Node built-in): bundle it or drop it',
  ]);
});

test('releaseNotes ignores a "## " line inside a fenced code block', () => {
  const log = ['## 0.1.0', '', '- Shell:', '', '```sh', '## not a heading', 'echo hi', '```', '', '~~~', '## nor this', '~~~', '', '## 0.0.9', '', '- old'].join('\n');
  const notes = releaseNotes(log, '0.1.0');
  assert.ok(notes.includes('## not a heading') && notes.includes('## nor this'));
  assert.ok(!notes.includes('old'));
  assert.throws(() => releaseNotes(['```', '## 0.1.0', '- x', '```'].join('\n'), '0.1.0'), /no "## 0.1.0" section/);
});

function runMain(argv: string[], files: Record<string, string>): { code: number; out: string; err: string } {
  const root = mkdtempSync(join(tmpdir(), 'alder-release-'));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(root, n), c);
  let out = '', err = '';
  const code = main(argv, root, { out: s => { out += s; }, err: s => { err += s; } });
  return { code, out, err };
}

test('main notes prints the tag\'s section', () => {
  const r = runMain(['notes', 'v0.1.0'], { 'package.json': '{"version":"0.1.0"}', 'CHANGELOG.md': LOG });
  assert.deepEqual(r, { code: 0, out: '- First release.\n- Scratch files.\n', err: '' });
});

test('main notes fails on a tag that does not match package.json, and on bad usage', () => {
  const files = { 'package.json': '{"version":"0.1.0"}', 'CHANGELOG.md': LOG };
  const r = runMain(['notes', 'v0.2.0'], files);
  assert.equal(r.code, 1);
  assert.match(r.err, /does not match package\.json version 0\.1\.0/);
  assert.equal(runMain([], files).code, 2);
});
