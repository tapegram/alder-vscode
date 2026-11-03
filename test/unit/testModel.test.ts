import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, discover, label, messageText, moduleOf, mutateTitle, resultsOf, runPattern, scoreOf, summary,
  survivors, survivorText, testAt,
} from '../../src/testModel';

const SRC = [
  'module Todos.Index',            // 0
  '',                              // 1
  'test "a plain name" = 1 == 1',  // 2
  '',                              // 3
  'test "a \\"quoted\\" (name)?" =', // 4
  '  x == "y"',                    // 5
  'testing = 3',                   // 6
  '  test "indented is not a test" = True', // 7
  'test "b" = a == "c" == d',      // 8
].join('\n');

test('discover reads the module and each top-level test, its name as written between the quotes', () => {
  assert.deepEqual(discover(SRC), {
    module: 'Todos.Index',
    tests: [
      { name: 'a plain name', line: 2 },
      { name: 'a \\"quoted\\" (name)?', line: 4 },
      { name: 'b', line: 8 },
    ],
  });
  assert.equal(discover('x = 1\ntest "t" = True\n'), undefined);
  assert.equal(moduleOf('-- c\nmodule A.B exposing\n'), 'A.B');
});

test('testAt is the nearest test at or above the line', () => {
  assert.equal(testAt(SRC, 1), undefined);
  assert.equal(testAt(SRC, 2), 'a plain name');
  assert.equal(testAt(SRC, 5), 'a \\"quoted\\" (name)?');
  assert.equal(testAt(SRC, 7), 'a \\"quoted\\" (name)?');
  assert.equal(testAt(SRC, 99), 'b');
});

test('runPattern anchors one test or the module, escaping Go regexp metacharacters', () => {
  assert.equal(runPattern('Todo'), '^Todo ');
  assert.equal(runPattern('Todo', 'adds one'), '^Todo "adds one"$');
  assert.equal(runPattern('A.B', 'a \\"q\\" (x)? [y] {2} a|b ^$ + * .'),
    '^A.B "a \\\\"q\\\\" \\(x\\)\\? \\[y\\] \\{2\\} a\\|b \\^\\$ \\+ \\* \\."$');
});

test('messageText: sides, else the error, else the note, flattened', () => {
  assert.equal(messageText({ module: 'M', name: 'n', ok: false, left: '3', right: '2' }), 'left: 3  right: 2');
  assert.equal(messageText({ module: 'M', name: 'n', ok: false, error: 'boom\n  here' }), 'error: boom here');
  assert.equal(messageText({ module: 'M', name: 'n', ok: false, note: 'sides print the same' }), 'note: sides print the same');
  assert.equal(messageText({ module: 'M', name: 'n', ok: false }), 'failed');
});

test('summary counts', () => {
  assert.equal(summary([{ module: 'M', name: 'a', ok: true }, { module: 'M', name: 'b', ok: false }]), '1 passed, 1 failed');
  assert.equal(summary([]), '0 passed, 0 failed');
});

test('resultsOf keeps the objects that name a test', () => {
  const objs = [{ module: 'M', name: 'a', ok: true }, { diagnostics: [] }, { mutants: [] }, { score: 1, killed: 1, survived: 0 }];
  assert.deepEqual(resultsOf(objs), [{ module: 'M', name: 'a', ok: true }]);
});

const MUTATE = [
  { module: 'Demo', name: 'answer is positive', ok: true },
  { mutants: [
    { id: 2, module: 'Home', file: 'app/Home.alder', line: 26, col: 5, kind: 'write replaced', before: 'a', after: 'b', killed: false },
    { id: 1, module: 'Home', file: 'app/Home.alder', line: 14, col: 10, kind: 'orderBy reversed', before: 'x.desc', after: 'x.asc', killed: false },
    { id: 3, module: 'Home', file: 'app/Home.alder', line: 30, col: 1, kind: 'k', before: 'c', after: 'd', killed: true },
    { id: 4, module: 'A', file: 'app/A.alder', line: 99, col: 1, kind: 'k', before: 'e', after: 'f', killed: false },
    { id: 5, kind: 'k', killed: false },
  ] },
  { score: 0.5625, killed: 18, survived: 14, suppressed: 0, skipped: 0 },
];

test('survivors are the unkilled mutants with a file, by file then line', () => {
  assert.deepEqual(survivors(MUTATE).map(m => `${m.file}:${m.line}`), ['app/A.alder:99', 'app/Home.alder:14', 'app/Home.alder:26']);
  assert.equal(survivorText(survivors(MUTATE)[1]), 'survived  orderBy reversed: x.desc → x.asc');
  assert.equal(survivorText({}), 'survived  ?:  → ');
});

test('the score object and the title', () => {
  const s = scoreOf(MUTATE);
  assert.deepEqual(s && { score: s.score, killed: s.killed, survived: s.survived }, { score: 0.5625, killed: 18, survived: 14 });
  assert.equal(mutateTitle(s!), 'alder test --mutate — 18 killed, 14 survived (0.56)');
  assert.equal(scoreOf([{ module: 'M', name: 'a', ok: true }]), undefined);
  assert.equal(label('test'), 'alder test');
  assert.equal(label('mutate'), 'alder test --mutate');
});

test('classify: diagnostics are a compile failure; a usage error, no results or a JSON error a report', () => {
  const r = (code: number | null, objects: Record<string, unknown>[]) => ({ code, objects, json: objects[0] });
  assert.equal(classify(r(1, [{ diagnostics: [{ code: 'E0003' }] }]), 'test'), 'compile');
  assert.equal(classify(r(1, [{ diagnostics: [] }]), 'mutate'), 'compile');
  assert.equal(classify(r(1, [{ module: 'M', name: 'a', ok: false }]), 'test'), 'ok');
  assert.equal(classify(r(0, []), 'test'), 'ok');
  assert.equal(classify(r(1, []), 'test'), 'report');
  assert.equal(classify(r(2, [{ module: 'M', name: 'a', ok: true }]), 'test'), 'report');
  assert.equal(classify(r(1, [{ error: 'no app' }]), 'test'), 'report');
  assert.equal(classify(r(0, MUTATE), 'mutate'), 'ok');
  // tests fail before mutants are measured: results, no score
  assert.equal(classify(r(1, [{ module: 'M', name: 'a', ok: false }]), 'mutate'), 'report');
});
