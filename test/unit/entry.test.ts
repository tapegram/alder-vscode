import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entryFile } from '../../src/generate/entry';

function tree(files: string[]): string {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'alder-entry-')));
  for (const f of files) {
    mkdirSync(join(t, f, '..'), { recursive: true });
    writeFileSync(join(t, f), '');
  }
  return t;
}

test('entry: app/App.alder when it exists', async () => {
  const t = tree(['app/App.alder', 'app/A/B.alder']);
  assert.equal(await entryFile(t), join(t, 'app/App.alder'));
});

test('entry: else the first .alder under app/ in name order, depth first', async () => {
  const t = tree(['app/Zed.alder', 'app/Posts/Show.alder', 'app/Posts/Index.alder', 'app/notes.txt']);
  assert.equal(await entryFile(t), join(t, 'app/Posts/Index.alder'));
});

test('entry: none', async () => {
  assert.equal(await entryFile(tree(['app/readme.md'])), undefined);
  assert.equal(await entryFile(tree([])), undefined);
});
