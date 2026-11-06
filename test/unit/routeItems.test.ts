import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { normalizeCli, normalizeLsp, pickItem, routesCliError, verb } from '../../src/routeItems';
import type { CliResult } from '../../src/cli';

const lsp = (root: string) => [
  { kind: 'page', path: '/sites/:id', module: 'Sites.Clarity.Index', name: 'page',
    uri: pathToFileURL(`${root}/app/Sites/Clarity/Index.alder`).href, range: { start: { line: 1, character: 2 } } },
  { kind: 'msg', path: '/sites/:id/delete', module: 'Sites.Clarity.Index', name: 'Delete',
    uri: pathToFileURL(`${root}/app/Sites/Clarity/Index.alder`).href, range: { start: { line: 2, character: 0 } } },
];

test('normalizeLsp keeps the 0-based position and turns the uri into a path', () => {
  const r = normalizeLsp(lsp('/x'));
  assert.deepEqual(r[0], { kind: 'page', path: '/sites/:id', module: 'Sites.Clarity.Index', name: 'page',
    file: '/x/app/Sites/Clarity/Index.alder', line: 1, character: 2 });
  assert.deepEqual(normalizeLsp(null), []);
});

test('a route without a range starts at the top of its file', () => {
  const [r] = normalizeLsp([{ ...lsp('/x')[0], range: undefined }]);
  assert.equal(r.line, 0);
  assert.equal(r.character, 0);
});

test('normalizeCli reads the JSON array, makes the file absolute and the position 0-based', () => {
  const out = '[{"kind":"page","path":"/","module":"Home","name":"page","file":"app/Home.alder","line":3,"col":5}]\n';
  assert.deepEqual(normalizeCli(out, '/proj'), [
    { kind: 'page', path: '/', module: 'Home', name: 'page', file: '/proj/app/Home.alder', line: 2, character: 4 },
  ]);
});

test('normalizeCli also reads {routes: […]}, JSONL, one object, and an absolute file', () => {
  const one = { kind: 'msg', path: '/_m/A/B', module: 'A', name: 'B', file: '/abs/app/A.alder', line: 1, col: 1 };
  assert.equal(normalizeCli(JSON.stringify({ routes: [one] }), '/p')[0].file, '/abs/app/A.alder');
  assert.equal(normalizeCli(`${JSON.stringify(one)}\n${JSON.stringify(one)}\n`, '/p').length, 2);
  assert.equal(normalizeCli(JSON.stringify(one), '/p').length, 1);
  assert.deepEqual(normalizeCli('', '/p'), []);
});

test('a msg is POST, a page GET; the pick shows the verb and path, then the declaration', () => {
  const [page, msg] = normalizeLsp(lsp('/x'));
  assert.equal(verb(msg), 'POST');
  assert.deepEqual(pickItem(page), { label: 'GET /sites/:id', description: 'Sites.Clarity.Index.page' });
  assert.deepEqual(pickItem(msg), { label: 'POST /sites/:id/delete', description: 'Sites.Clarity.Index.Delete' });
});

const cli = (o: Partial<CliResult>): CliResult => ({
  code: 0, signal: null, stdout: '', stderr: '', objects: [], json: undefined, cancelled: false, ...o,
});
const OLD_USAGE = 'usage: alder <command> [arguments]\n\n  build  compile\n';

test('routesCliError: an old alder (usage on exit 2) after a server error gets the update advice', () => {
  const m = routesCliError(cli({ code: 2, stderr: OLD_USAGE }), 'Unhandled method alder/routes');
  assert.match(m, /update alder/);
  assert.match(m, /Unhandled method alder\/routes/);
});

test('routesCliError: exit 2 with an `alder routes:` message gives that message, not advice', () => {
  const m = routesCliError(cli({ code: 2, stderr: 'alder routes: no .alder files under /x/app\n' }), 'Unhandled method alder/routes');
  assert.match(m, /no \.alder files under \/x\/app/);
  assert.doesNotMatch(m, /update alder/);
});

test('routesCliError: a JSON error gives its message', () => {
  const m = routesCliError(cli({ code: 2, json: { error: 'boom' } }), 'server down');
  assert.match(m, /boom/);
  assert.doesNotMatch(m, /update alder/);
});

test('routesCliError: without a server error the usage output is not advice', () => {
  const m = routesCliError(cli({ code: 2, stderr: OLD_USAGE }));
  assert.doesNotMatch(m, /update alder/);
});
