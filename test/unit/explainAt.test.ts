import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeAt, codeOf, DiagLike } from '../../src/explainAt';

const d = (code: DiagLike['code'], sl: number, sc: number, el: number, ec: number, source = 'alder'): DiagLike =>
  ({ source, code, range: { start: { line: sl, character: sc }, end: { line: el, character: ec } } });

test('codeOf reads a string, a number and a {value} code', () => {
  assert.equal(codeOf(d('E0003', 0, 0, 0, 1)), 'E0003');
  assert.equal(codeOf(d(7, 0, 0, 0, 1)), '7');
  assert.equal(codeOf(d({ value: 'W0001' }, 0, 0, 0, 1)), 'W0001');
  assert.equal(codeOf(d(undefined, 0, 0, 0, 1)), undefined);
});

test('the diagnostic whose range holds the cursor wins, its end included', () => {
  const ds = [d('E0001', 3, 0, 3, 4), d('E0002', 3, 8, 3, 12)];
  assert.equal(codeAt(ds, { line: 3, character: 9 }), 'E0002');
  assert.equal(codeAt(ds, { line: 3, character: 12 }), 'E0002');
  assert.equal(codeAt(ds, { line: 3, character: 2 }), 'E0001');
});

test('else the first alder diagnostic on the cursor line, a multi-line one included', () => {
  assert.equal(codeAt([d('E0001', 3, 0, 3, 4), d('E0002', 3, 8, 3, 12)], { line: 3, character: 6 }), 'E0001');
  assert.equal(codeAt([d('E0005', 1, 4, 5, 0)], { line: 2, character: 0 }), 'E0005');
  assert.equal(codeAt([d('E0001', 3, 0, 3, 4)], { line: 4, character: 0 }), undefined);
});

test('other sources and code-less diagnostics are skipped', () => {
  assert.equal(codeAt([d('X1', 0, 0, 0, 9, 'eslint'), d(undefined, 0, 0, 0, 9)], { line: 0, character: 1 }), undefined);
  assert.equal(codeAt([d('X1', 0, 0, 0, 9, 'eslint'), d('E0003', 0, 2, 0, 3)], { line: 0, character: 1 }), 'E0003');
});
