import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerRows } from '../../src/generate/picker';
import type { Generator } from '../../src/generate/types';

const items: Generator[] = [
  { id: 'new msg', summary: 'a message and its update arm', here: true },
  { id: 'new form', summary: 'a form, its message and arm', here: true },
  { id: 'new page', summary: 'a page module', here: false },
  { id: 'edit table', summary: 'change a table', here: false },
];

test('picker: here heading above the first here item, all above the first other', () => {
  const rows = pickerRows(items);
  assert.deepEqual(rows.map(r => 'heading' in r ? `-- ${r.heading}` : r.item.id),
    ['-- here', 'new msg', 'new form', '-- all', 'new page', 'edit table']);
});

test('picker: no here items is one all heading; nothing is nothing', () => {
  assert.deepEqual(pickerRows(items.slice(2)).map(r => 'heading' in r ? r.heading : r.item.id), ['all', 'new page', 'edit table']);
  assert.deepEqual(pickerRows([]), []);
});
