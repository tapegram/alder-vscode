import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRoot, realRoot } from '../../src/root';

function tree(): string {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'alder-root-')));
  mkdirSync(join(t, 'blog/app/Posts'), { recursive: true });
  writeFileSync(join(t, 'blog/app/Posts/Show.alder'), 'module Posts.Show\n');
  return t;
}

test('a file under app/ has the directory holding app/ as its root', async () => {
  const t = tree();
  assert.equal(await findRoot(join(t, 'blog/app/Posts/Show.alder')), join(t, 'blog'));
  assert.equal(await findRoot(join(t, 'blog/app')), join(t, 'blog'));
  assert.equal(await findRoot(join(t, 'blog')), join(t, 'blog'));
});

test('no app/ above: undefined', async () => {
  const t = tree();
  writeFileSync(join(t, 'loose.alder'), '');
  assert.equal(await findRoot(join(t, 'loose.alder')), undefined);
});

test('a module directory App/ is not app/ (case-insensitive file systems)', async () => {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'alder-root-')));
  mkdirSync(join(t, 'x/App'), { recursive: true });
  writeFileSync(join(t, 'x/App/Main.alder'), '');
  assert.equal(await findRoot(join(t, 'x/App/Main.alder')), undefined);
});

test('a file named app is not a root', async () => {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'alder-root-')));
  mkdirSync(join(t, 'y'));
  writeFileSync(join(t, 'y/app'), '');
  assert.equal(await findRoot(join(t, 'y/Main.alder')), undefined);
});

test('app/ as a symlink to a directory counts; realRoot resolves the link', async () => {
  const t = tree();
  symlinkSync(join(t, 'blog'), join(t, 'link'));
  assert.equal(await findRoot(join(t, 'link/app/Posts/Show.alder')), join(t, 'link'));
  assert.equal(await realRoot(join(t, 'link')), join(t, 'blog'));
  mkdirSync(join(t, 'z'));
  symlinkSync(join(t, 'blog/app'), join(t, 'z/app'));
  assert.equal(await findRoot(join(t, 'z/app/Posts/Show.alder')), join(t, 'z'));
});
