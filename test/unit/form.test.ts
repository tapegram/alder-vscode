import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as form from '../../src/generate/form';
import type { FieldState } from '../../src/generate/types';

const f = (o: Partial<FieldState> & { name: string }): FieldState =>
  ({ kind: 'text', flag: false, required: false, value: '', source: '', valid: true, help: '', ...o });

const fields: FieldState[] = [
  f({ name: 'page', kind: 'page', required: true, value: 'Posts.Index', source: 'here', choices: ['Posts.Index', 'Posts.Show'] }),
  f({ name: 'name', required: true, valid: false, why: 'required' }),
  f({ name: 'fields', kind: 'fieldList' }),
  f({ name: 'example', kind: 'bool', flag: true, value: 'true', source: 'default' }),
];

const described: FieldState[] = [
  f({ name: 'page', kind: 'page', required: true, value: 'Posts.Index', source: 'here', help: 'the page the message belongs to', example: 'Posts.Index' }),
  f({ name: 'name', required: true, value: 'Archive', source: 'default', help: "the message's name", example: 'Archive' }),
  f({ name: 'fields', kind: 'fieldList', help: 'the values it carries', example: 'note:Text' }),
  f({ name: 'when', flag: true, help: 'show the button only when this holds', example: 'model.canWrite', agent: true }),
];

test('form: rows show values, toggles and notes', () => {
  const r = form.rows(fields, {});
  assert.deepEqual(r.map(x => x.value), ['Posts.Index', '', '', '[x]']);
  assert.deepEqual(r.map(x => x.name), ['page', 'name', 'fields', 'example']);
  assert.equal(r[0].note, 'from the cursor');
  assert.equal(r[0].error, false);
  assert.equal(r[1].note, 'required');
  assert.equal(r[2].note, undefined);
  assert.equal(r[3].note, 'default');
});

test('form: a bool with an empty value is unchecked, with no note', () => {
  const r = form.rows([f({ name: 'blank', kind: 'bool', flag: true })], {});
  assert.equal(r[0].value, '[ ]');
  assert.equal(r[0].note, undefined);
});

test('form: typed text wins; a why that is not "required" is an error', () => {
  const g = structuredClone(fields);
  g[1].value = 'bad name';
  g[1].why = 'not a message name: write Capitalised';
  const r = form.rows(g, { name: 'Del' });
  assert.equal(r[1].value, 'Del');
  assert.equal(r[1].note, g[1].why);
  assert.equal(r[1].error, true);
});

test('form: sets merge the preset and the typed text, dropping empties', () => {
  assert.deepEqual(form.sets({ page: 'Posts.Index' }, { name: 'Delete', fields: '' }), { page: 'Posts.Index', name: 'Delete' });
  assert.deepEqual(form.sets({ page: 'Posts.Index' }, { page: '' }), {});
  assert.deepEqual(form.sets({ page: '' }, {}), {});
  assert.deepEqual(form.sets(undefined, undefined), {});
});

test('form: shownSets echo every shown value under the preset and typed text (alder#211)', () => {
  assert.deepEqual(form.shownSets(described, { name: 'Delete' }, {}), { page: 'Posts.Index', name: 'Delete' });
  assert.deepEqual(form.shownSets(described, {}, { page: 'Posts.Show', name: '' }), { page: 'Posts.Show' });
  assert.deepEqual(form.shownSets(fields, {}, {}), { page: 'Posts.Index', example: 'true' });
});

test('form: a default bool is not sent until toggled', () => {
  assert.equal(form.sets({}, {}).example, undefined);
  assert.equal(form.sets({}, { example: 'false' }).example, 'false');
  assert.equal(form.sets({}, { example: 'true' }).example, 'true');
});

test('form: options, fuzzy, firstInvalid', () => {
  assert.deepEqual(form.options(fields[0], ''), ['Posts.Index', 'Posts.Show']);
  assert.deepEqual(form.options(fields[0], 'show'), ['Posts.Show']);
  assert.deepEqual(form.options(fields[1], 'x'), []);
  assert.deepEqual(form.fuzzy(['abc', 'xaxbxc', 'cba'], 'abc'), ['abc', 'xaxbxc']);
  assert.deepEqual(form.fuzzy(['Posts.', 'Sites.'], 'PS'), ['Posts.']);
  assert.equal(form.firstInvalid(fields), 1);
  assert.equal(form.firstInvalid([fields[0]]), undefined);
});

test('form: visible leaves out the agent flags', () => {
  assert.deepEqual(form.visible(described).map(x => x.name), ['page', 'name', 'fields']);
  assert.equal(form.visible(fields).length, fields.length);
  assert.deepEqual(form.visible(null), []);
  assert.deepEqual(form.visible(undefined), []);
});

test('form: the note carries the help after the source; an error still wins', () => {
  const r = form.rows(form.visible(described), {});
  assert.equal(r[0].note, 'from the cursor · the page the message belongs to');
  assert.equal(r[1].note, "default · the message's name");
  assert.equal(r[2].note, 'the values it carries');
  const g = structuredClone(described);
  g[1].valid = false;
  g[1].why = 'not a name';
  const e = form.rows(g, {});
  assert.equal(e[1].note, 'not a name');
  assert.equal(e[1].error, true);
});

test('form: a cleared field says which value the server uses instead', () => {
  const r = form.rows(form.visible(described), { name: '' });
  assert.equal(r[1].value, '');
  assert.equal(r[1].note, 'default: Archive');
  assert.equal(form.rows(form.visible(described), { page: '' })[0].note, 'from the cursor: Posts.Index');
});

test('form: exampleLine', () => {
  assert.equal(form.exampleLine(described[2]), 'e.g. note:Text');
  assert.equal(form.exampleLine(fields[0]), undefined);
  assert.equal(form.exampleLine(f({ name: 'x', kind: 'bool', example: '' })), undefined);
  assert.equal(form.exampleLine(undefined), undefined);
});

test('form: firstToFill is the first invalid field, else the first required one at its starting value', () => {
  assert.equal(form.firstToFill(fields), 1);
  assert.equal(form.firstToFill(described), 1);
  assert.equal(form.firstToFill(described, { name: 'Archive' }), undefined, 'typed counts as touched');
  const g = structuredClone(described);
  g[1].source = 'you';
  assert.equal(form.firstToFill(g), undefined);
});

test('form: editorKind and moduleText', () => {
  assert.equal(form.editorKind(fields[3]), 'bool');
  assert.equal(form.editorKind(fields[0]), 'choice');
  assert.equal(form.editorKind(f({ name: 'module', kind: 'module' })), 'module');
  assert.equal(form.editorKind(fields[1]), 'text');
  assert.equal(form.editorKind(f({ name: 'p', kind: 'page', choices: [] })), 'text');
  assert.equal(form.moduleText(f({ name: 'module', kind: 'module', value: '<Module>' }), {}), '');
  assert.equal(form.moduleText(f({ name: 'module', kind: 'module', value: '<Module>' }), { module: 'Tags.' }), 'Tags.');
  assert.equal(form.moduleText(f({ name: 'module', kind: 'module', value: 'Posts.Show' }), {}), 'Posts.Show');
});

test('form: moduleDirs lists the capitalised folders under app/ as dotted prefixes, shallow first', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alder-form-')));
  for (const [p, s] of [['app/App.alder', 'module App\n'], ['app/Sites/Clarity/Index.alder', ''], ['app/Posts/Index.alder', ''], ['app/lowercase/X.alder', '']]) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), s);
  }
  assert.deepEqual(form.moduleDirs(root), ['Posts.', 'Sites.', 'Sites.Clarity.']);
  assert.deepEqual(form.moduleDirs(join(root, 'nope')), []);
});

test('form: modulePath and moduleHelp', () => {
  assert.equal(form.modulePath('Sites.Clarity.Index'), 'app/Sites/Clarity/Index.alder');
  assert.equal(form.moduleHelp('Posts.Show'), 'Posts.Show → app/Posts/Show.alder');
  assert.equal(form.moduleHelp(''), 'Sites.Clarity.Index → app/Sites/Clarity/Index.alder');
  assert.equal(form.moduleHelp('Sites.Clarity.'), 'Sites.Clarity.Index → app/Sites/Clarity/Index.alder');
});

test('form: moduleSuggest completes a typed prefix', () => {
  const dirs = ['Posts.', 'Sites.', 'Sites.Clarity.'];
  assert.deepEqual(form.moduleSuggest(dirs, ''), dirs);
  assert.notEqual(form.moduleSuggest(dirs, ''), dirs, 'a copy');
  assert.deepEqual(form.moduleSuggest(dirs, 'Sites.'), ['Sites.Clarity.']);
  assert.deepEqual(form.moduleSuggest(dirs, 'Si'), ['Sites.', 'Sites.Clarity.']);
  assert.deepEqual(form.moduleSuggest(dirs, 'Zzz'), []);
  assert.deepEqual(form.moduleSuggest(dirs, 'Sites.Clarity.'), []);
  assert.deepEqual(form.moduleSuggest(dirs, 'Clar'), ['Sites.Clarity.'], 'fuzzy when no prefix matches');
});
