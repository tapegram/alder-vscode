import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  headerModule, inHeaderWarning, isDefinition, isScratchPath, lineSpan, moduleName, scratchInsert, TEMPLATE,
} from '../../src/scratchText';

test('the template is alder\'s scaffold scratch.alder', () => {
  const repo = process.env.ALDER_REPO;
  if (!repo) return; // the e2e environment sets it; CI's unit job does too
  assert.equal(TEMPLATE, readFileSync(join(repo, 'internal/scaffold/files/scratch.alder'), 'utf8'));
});

test('isScratchPath is the base name ending in scratch.alder', () => {
  assert.equal(isScratchPath('/w/blog/scratch.alder'), true);
  assert.equal(isScratchPath('/w/blog/posts.scratch.alder'), true);
  assert.equal(isScratchPath('C:\\w\\blog\\scratch.alder'), true);
  assert.equal(isScratchPath('/w/blog/app/Posts.alder'), false);
  assert.equal(isScratchPath('/w/scratch.alder/x.alder'), false);
});

test('isDefinition (alder.nvim scratch_spec cases)', () => {
  const cases: [string, boolean][] = [
    ['f x = x + 1', true], ['pair (a, b) = a', true], ['name : Int', true], ['x = 1', true],
    ['type Shape = Circle | Square', true], ['alias P = { x : Int }', true], ['import Html', true],
    ['test "adds" = 1 + 1 == 2', true], ['page Index = …', true],
    ['x == y', false], ['f x <= y', false], ['{ a = 1 }', false], ['let x = 1 in x', false],
    ['if a then b else c', false], ['foo', false], ['1 + 1', false], ['-- a comment', false],
    ['typeOf x', false],
    ['msg == Save', false], ['session |> Session.user', false], ['session { user : Int }', true],
    ['login = …', true], ['page "/login" { }', true], ['import\tHtml', true],
    ['x /= y', false], ['x != y', false], ['log "a = b"', false], ['g x =', true],
    ['   f x = 1', true],
  ];
  for (const [line, want] of cases) assert.equal(isDefinition(line), want, line);
});

const T = TEMPLATE; // ends in "> 1 + 1\n"

test('a sent expression becomes a watch after one blank line', () => {
  assert.equal(scratchInsert(T, ['x == y'], false), '\n> x == y\n');
  assert.equal(scratchInsert(T, ['', 'x == y', ''], false), '\n> x == y\n');
});

test('a sent definition goes in as written', () => {
  assert.equal(scratchInsert(T, ['f x = x + 1'], false), '\nf x = x + 1\n');
  assert.equal(scratchInsert(T, ['g : Int -> Int', 'g x =', '    x * 2'], false), '\ng : Int -> Int\ng x =\n    x * 2\n');
});

test('leading comments go in as written; the first other line is classified', () => {
  assert.equal(scratchInsert(T, ['-- note', 'f x = 1'], false), '\n-- note\nf x = 1\n');
  assert.equal(scratchInsert(T, ['-- note', 'x == y'], false), '\n-- note\n> x == y\n');
  assert.equal(scratchInsert(T, ['-- only', '-- comments'], false), '\n-- only\n-- comments\n');
});

test('the common indent is removed and continuation lines get four spaces', () => {
  assert.equal(scratchInsert(T, ['    xs', '      |> f', '', '      |> g'], false), '\n> xs\n      |> f\n\n      |> g\n');
});

test('raw lines go in as they are', () => {
  assert.equal(scratchInsert(T, ['> xs', '    |> f'], true), '\n> xs\n    |> f\n');
});

test('nothing to send', () => {
  assert.equal(scratchInsert(T, ['', '   '], false), undefined);
  assert.equal(scratchInsert(T, [], true), undefined);
});

test('the separator depends on how the file ends', () => {
  assert.equal(scratchInsert('', ['1'], false), '> 1\n');
  assert.equal(scratchInsert('> 1', ['2'], false), '\n\n> 2\n');
  assert.equal(scratchInsert('> 1\n\n', ['2'], false), '> 2\n');
});

test('a CRLF file gets one separator', () => {
  assert.equal(scratchInsert('> 1\r\n', ['2'], false), '\n> 2\n');
  assert.equal(scratchInsert('> 1\r\n\r\n', ['2'], false), '> 2\n');
});

test('lineSpan drops a last line selected only up to column 0', () => {
  assert.deepEqual(lineSpan({ line: 3, character: 4 }, { line: 3, character: 4 }), [3, 3]);
  assert.deepEqual(lineSpan({ line: 3, character: 0 }, { line: 5, character: 2 }), [3, 5]);
  assert.deepEqual(lineSpan({ line: 3, character: 0 }, { line: 5, character: 0 }), [3, 4]);
  assert.deepEqual(lineSpan({ line: 3, character: 2 }, { line: 3, character: 2 }), [3, 3]);
});

test('moduleName is the first module line', () => {
  assert.equal(moduleName('-- x\nmodule Posts.Show exposing (..)\n'), 'Posts.Show');
  assert.equal(moduleName('x = 1\n'), undefined);
});

test('headerModule is the in header on the first line of code', () => {
  assert.equal(headerModule('-- c\n\nin Todo\n\n> 1\n'), 'Todo');
  assert.equal(headerModule('in Posts.Show  \n'), 'Posts.Show');
  assert.equal(headerModule('> 1\nin Todo\n'), undefined);
  assert.equal(headerModule(''), undefined);
});

test('inHeaderWarning only when a module is sending and the header differs', () => {
  assert.equal(inHeaderWarning('Todo', '> 1\n'),
    'alder: scratch.alder is not "in Todo"; names from Todo need qualifying (add "in Todo" as its first line)');
  assert.equal(inHeaderWarning('Todo', 'in Todo\n> 1\n'), undefined);
  assert.equal(inHeaderWarning(undefined, '> 1\n'), undefined);
});

test('the in header allows _ in a module name, as the server does', () => {
  assert.equal(headerModule('in My_Mod\n> 1\n'), 'My_Mod');
  assert.equal(inHeaderWarning('My_Mod', 'in My_Mod\n'), undefined);
});
