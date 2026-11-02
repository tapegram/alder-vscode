import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const conf = JSON.parse(readFileSync(join(__dirname, '../../../language-configuration.json'), 'utf8'));
const re = (s: string) => new RegExp(s);

test('line comments are --', () => assert.equal(conf.comments.lineComment, '--'));

test('a word allows primes, and a hole is one word', () => {
  const w = new RegExp(conf.wordPattern, 'g');
  assert.deepEqual('x\' = ?h + fooBar'.match(w), ['x\'', '?h', 'fooBar']);
});

test('indent after an opener, an arrow, then/else, or a lone start tag', () => {
  const inc = re(conf.indentationRules.increaseIndentPattern);
  for (const l of ['load params = {', '  xs = [', '  f = (', 'x =', '  Just p ->', '  let x <-',
    '  if a then', '  else', '  <article>', '  <Layout.Page title={t}>']) assert.ok(inc.test(l), l);
  for (const l of ['  <h1>{x}</h1>', '  x = 1', '  a < b', '  <br/>', '  <br />']) assert.ok(!inc.test(l), l);
});

test('dedent on a closer, else, or an end tag', () => {
  const dec = re(conf.indentationRules.decreaseIndentPattern);
  for (const l of ['  }', ']', '  )', '  else', '  </article>']) assert.ok(dec.test(l), l);
  for (const l of ['  x', '  elsewhere']) assert.ok(!dec.test(l), l);
});

test('enter after a continuation operator indents', () => {
  const rule = conf.onEnterRules[0];
  assert.equal(rule.action.indent, 'indent');
  const before = re(rule.beforeText);
  for (const l of ['  Db.from Comment |>', '  a ??', '  a ||', '  a &&', '  s ++', '  a +', '  a ==',
    '  a !=', '  a <=', '  a >=']) assert.ok(before.test(l), l);
  assert.ok(!before.test('  x = f y'));
});
