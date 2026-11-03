import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asPreset, Flow, FlowUi, FormAnswer, FormModel, Origin, Server, TextView } from '../../src/generate/flow';
import type { PickerRow } from '../../src/generate/picker';
import type { ReviewFile, ReviewModel } from '../../src/generate/review';
import type { FieldState, Generator, PlanResult, PreviewResult, Sets } from '../../src/generate/types';

const tick = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

interface Pending { method: string; params: { id?: string; sets?: Sets }; resolve(v: unknown): void; reject(e: unknown): void }

class FakeServer implements Server {
  pending: Pending[] = [];
  up = true;
  request<T>(method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => this.pending.push({ method, params: params as Pending['params'], resolve: resolve as (v: unknown) => void, reject }));
  }
  running() { return this.up; }
  // take removes and returns the oldest pending request of method
  take(method: string): Pending {
    const i = this.pending.findIndex(p => p.method === method);
    assert.ok(i >= 0, `no pending ${method}; pending: ${this.pending.map(p => p.method).join(', ')}`);
    return this.pending.splice(i, 1)[0];
  }
}

interface FormCall { model: FormModel; answer(a: FormAnswer): void; closed: boolean }

class FakeUi implements FlowUi {
  log: string[] = [];
  forms: FormCall[] = [];
  onPick: (rows: PickerRow[]) => Generator | undefined = () => undefined;
  onPickOne: (o: { title: string; items: string[]; active?: string }) => string | undefined = () => undefined;
  onModule: (o: { value: string; suggest(t: string): { help: string; suggestions: string[] } }) => string | undefined = () => undefined;
  texts: { title: string; value: string; onChange(t: string): void; validation?: string; finish(v: string | undefined): void }[] = [];
  onReview: (m: ReviewModel, o: { onActive(f: ReviewFile): void }) => 'apply' | 'back' = () => 'back';
  confirm = async () => true;
  info(m: string) { this.log.push(`info ${m}`); }
  warn(m: string) { this.log.push(`warn ${m}`); }
  error(m: string) { this.log.push(`error ${m}`); }
  async pickGenerator(rows: PickerRow[]) { this.log.push('pick'); return this.onPick(rows); }
  form(model: FormModel, answer: (a: FormAnswer) => void) {
    const call: FormCall = { model, answer, closed: false };
    this.forms.push(call);
    return { update: (m: FormModel) => { call.model = m; }, close: () => { call.closed = true; } };
  }
  async pickOne(o: { title: string; items: string[]; active?: string }) { this.log.push(`pickOne ${o.title}`); return this.onPickOne(o); }
  async module(o: { title: string; value: string; suggest(t: string): { help: string; suggestions: string[] } }) { this.log.push(`module ${o.title}`); return this.onModule(o); }
  text(o: { title: string; value: string; onChange(t: string): void }): TextView {
    let finish!: (v: string | undefined) => void;
    const result = new Promise<string | undefined>(r => { finish = r; });
    const entry = { title: o.title, value: o.value, onChange: o.onChange, validation: undefined as string | undefined, finish };
    this.texts.push(entry);
    this.log.push(`text ${o.title}`);
    return { setValidation: m => { entry.validation = m; }, result };
  }
  async review(m: ReviewModel, o: { title: string; onActive(f: ReviewFile): void }) { this.log.push('review'); return this.onReview(m, o); }
  get form_() { const f = this.forms[this.forms.length - 1]; assert.ok(f && !f.closed, 'no open form'); return f; }
}

class FakeSink { shown: string[][] = []; disposed = false; show(lines: string[]) { this.shown.push(lines); } dispose() { this.disposed = true; } }

const origin: Origin = { uri: 'file:///w/app/Posts/Index.alder', position: { line: 3, character: 2 }, root: '/w' };
const msg: Generator = { id: 'new msg', summary: 'a message', here: true, sets: { page: 'Posts.Index' } };
const page: Generator = { id: 'new page', summary: 'a page', here: false };
const field = (o: Partial<FieldState> & { name: string }): FieldState =>
  ({ kind: 'text', flag: false, required: false, value: '', source: '', valid: true, help: '', ...o });
const nameDefault = field({ name: 'name', required: true, value: 'Archive', source: 'default', help: "the message's name", example: 'Archive' });
const nameYou = (v: string) => field({ name: 'name', required: true, value: v, source: 'you' });
const ready = (fields: FieldState[]): PreviewResult => ({ fields, files: [{ path: 'app/Posts/Index.alder', action: 'edited', added: 2, removed: 0 }], diff: '@@ -1 +1 @@\n-a\n+b\n', ready: true });

function setup() {
  const server = new FakeServer();
  const ui = new FakeUi();
  const sink = new FakeSink();
  const applied: { id: string; sets: Sets }[] = [];
  const shownFiles: string[] = [];
  const flow = new Flow({ server, ui, preview: sink, apply: async (id, sets) => { applied.push({ id, sets }); }, showPlanFile: f => shownFiles.push(f.path), debounceMs: 0 }, origin);
  return { server, ui, sink, applied, shownFiles, flow };
}

// started is a flow past the picker on `new msg`, with its first preview answered by r.
async function started(r: PreviewResult = ready([nameYou('Delete')])) {
  const s = setup();
  s.ui.onPick = rows => rows.flatMap(x => ('item' in x ? [x.item] : [])).find(g => g.id === 'new msg');
  void s.flow.start();
  await tick();
  s.server.take('alder/generators').resolve({ generators: [msg, page] });
  await tick();
  s.server.take('alder/preview').resolve(r);
  await tick();
  return s;
}

test('flow: no generators warns and ends', async () => {
  const { server, ui, flow } = setup();
  void flow.start();
  await tick();
  const p = server.take('alder/generators');
  assert.deepEqual(p.params, { textDocument: { uri: origin.uri }, position: origin.position });
  p.resolve({ generators: null });
  await flow.done;
  assert.deepEqual(ui.log, ['warn alder: no generators']);
  assert.equal(ui.forms.length, 0);
});

test('flow: the picker gets the grouped rows; picking sends a preview with the item\'s sets', async () => {
  const s = setup();
  let seen: PickerRow[] = [];
  s.ui.onPick = rows => { seen = rows; return msg; };
  void s.flow.start();
  await tick();
  s.server.take('alder/generators').resolve({ generators: [msg, page] });
  await tick();
  assert.deepEqual(seen.map(r => ('heading' in r ? r.heading : r.item.id)), ['here', 'new msg', 'all', 'new page']);
  const p = s.server.take('alder/preview');
  assert.deepEqual(p.params, { textDocument: { uri: origin.uri }, position: origin.position, id: 'new msg', sets: { page: 'Posts.Index' } });
  assert.equal(s.ui.form_.model.updating, true);
  assert.equal(s.ui.form_.model.title, 'new msg  a message  updating…');
  p.resolve(ready([nameYou('Delete')]));
  await tick();
  assert.equal(s.ui.form_.model.ready, true);
  assert.equal(s.ui.form_.model.title, 'new msg  a message');
  assert.deepEqual(s.ui.form_.model.rows.map(r => r.name), ['name']);
  assert.ok(s.sink.shown.at(-1)!.includes('+b'));
});

test('flow: picker escape ends the flow', async () => {
  const { server, flow } = setup();
  void flow.start();
  await tick();
  server.take('alder/generators').resolve({ generators: [msg] });
  await flow.done;
});

test('flow: a required field at its starting value opens its editor first', async () => {
  const s = await started(ready([nameDefault]));
  assert.equal(s.ui.texts.length, 1);
  assert.equal(s.ui.texts[0].title, 'new msg: name');
  assert.equal(s.ui.texts[0].value, 'Archive');
  assert.ok(s.ui.forms[0].closed, 'the form closes while the editor is up');
});

test('flow: typing in the text editor previews, validates, and the stale answer is dropped', async () => {
  const s = await started(ready([nameDefault]));
  const t = s.ui.texts[0];
  t.onChange('del');
  await tick();
  const first = s.server.take('alder/preview');
  assert.deepEqual(first.params.sets, { page: 'Posts.Index', name: 'del' });
  t.onChange('Delete');
  await tick();
  const second = s.server.take('alder/preview');
  // the older answer arrives late: it must not paint anything
  const before = s.sink.shown.length;
  first.resolve({ ...ready([field({ name: 'name', value: 'del', valid: false, why: 'not a message name' })]), ready: false });
  await tick();
  assert.equal(s.sink.shown.length, before, 'stale answer painted the preview');
  assert.equal(t.validation, undefined, 'stale answer set the validation');
  second.resolve({ fields: [field({ name: 'name', value: 'Delete', valid: false, why: 'Delete exists' })], ready: false });
  await tick();
  assert.equal(t.validation, 'Delete exists');
  t.finish('Delete');
  await tick();
  assert.equal(s.ui.form_.model.rows[0].value, 'Delete');
});

test('flow: escape in the text editor restores the previous value', async () => {
  const s = await started(ready([nameDefault]));
  const t = s.ui.texts[0];
  t.onChange('Half');
  await tick();
  s.server.take('alder/preview').resolve(ready([nameYou('Half')]));
  await tick();
  t.finish(undefined);
  await tick();
  const p = s.server.take('alder/preview');
  assert.deepEqual(p.params.sets, { page: 'Posts.Index' }, 'the typed text is gone');
});

test('flow: apply while a preview is in flight does nothing; not ready opens the first invalid field; ready applies', async () => {
  const s = await started({ fields: [field({ name: 'name', required: true, valid: false, why: 'required' })], ready: false });
  // fillFirst opened the invalid field's editor; leave it
  assert.equal(s.ui.texts.length, 1);
  s.ui.texts[0].finish(undefined);
  await tick();
  // Escape re-requested nothing (nothing was typed), so no preview is in flight
  assert.equal(s.server.pending.length, 0);
  await s.flow.answer({ kind: 'apply' });
  await tick();
  assert.equal(s.ui.texts.length, 2, 'not ready: the first invalid field opens');
  s.ui.texts[1].onChange('Delete');
  await tick();
  // in flight: apply does nothing
  await s.flow.answer({ kind: 'apply' });
  assert.equal(s.applied.length, 0);
  s.server.take('alder/preview').resolve(ready([nameYou('Delete')]));
  await tick();
  s.ui.texts[1].finish('Delete');
  await tick();
  await s.flow.answer({ kind: 'apply' });
  await s.flow.done;
  assert.deepEqual(s.applied, [{ id: 'new msg', sets: { page: 'Posts.Index', name: 'Delete' } }]);
  assert.ok(s.sink.disposed);
});

test('flow: a preset skips the picker and overlays the item\'s sets', async () => {
  const s = setup();
  void s.flow.start({ id: 'new msg', sets: { name: 'Archive' } });
  await tick();
  s.server.take('alder/generators').resolve({ generators: [page, msg] });
  await tick();
  assert.ok(!s.ui.log.includes('pick'));
  assert.deepEqual(s.server.take('alder/preview').params.sets, { page: 'Posts.Index', name: 'Archive' });
});

test('flow: unknown preset shows the picker', async () => {
  const s = setup();
  void s.flow.start({ id: 'new widget' });
  await tick();
  s.server.take('alder/generators').resolve({ generators: [msg] });
  await s.flow.done;
  assert.deepEqual(s.ui.log, ['pick']);
});

test('flow: back to the picker drops the in-flight answer', async () => {
  const s = await started();
  s.ui.onPick = () => page;
  // a field change puts a preview in flight
  s.flow['setField']('name', 'X');
  await tick();
  const late = s.server.take('alder/preview');
  await s.flow.answer({ kind: 'back' });
  await tick();
  const fresh = s.server.take('alder/preview');
  assert.equal(fresh.params.id, 'new page');
  const shown = s.sink.shown.length;
  late.resolve(ready([nameYou('X')]));
  await tick();
  assert.equal(s.sink.shown.length, shown);
  assert.equal(s.ui.form_.model.ready, false);
});

test('flow: a bool field picks on/off into "true"/"false"', async () => {
  const s = await started(ready([field({ name: 'example', kind: 'bool', value: 'true', source: 'default' })]));
  s.ui.onPickOne = o => { assert.deepEqual(o.items, ['on', 'off']); assert.equal(o.active, 'on'); return 'off'; };
  await s.flow.answer({ kind: 'field', name: 'example' });
  await tick();
  assert.deepEqual(s.server.take('alder/preview').params.sets, { page: 'Posts.Index', example: 'false' });
});

test('flow: a module field suggests the app\'s folders', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alder-flow-')));
  mkdirSync(join(root, 'app/Sites/Clarity'), { recursive: true });
  const s = setup();
  const flow = new Flow({ server: s.server, ui: s.ui, preview: s.sink, apply: async () => {}, showPlanFile: () => {}, debounceMs: 0 }, { ...origin, root });
  s.ui.onPick = () => page;
  let got: { help: string; suggestions: string[] } | undefined;
  s.ui.onModule = o => { assert.equal(o.value, ''); got = o.suggest('Sites.'); return 'Sites.Clarity.Index'; };
  void flow.start();
  await tick();
  s.server.take('alder/generators').resolve({ generators: [page] });
  await tick();
  s.server.take('alder/preview').resolve(ready([field({ name: 'module', kind: 'module', value: '<Module>', source: 'you' })]));
  await tick();
  await flow.answer({ kind: 'field', name: 'module' });
  await tick();
  assert.deepEqual(got, { help: 'Sites.Index → app/Sites/Index.alder', suggestions: ['Sites.Clarity.'] });
  assert.deepEqual(s.server.take('alder/preview').params.sets, { module: 'Sites.Clarity.Index' });
});

test('flow: review shows the plan, applies with the planned sets; back keeps the form', async () => {
  const s = await started();
  const plan: PlanResult = { files: [{ path: 'app/Posts/Index.alder', action: 'edited', before: 'a', after: 'b' }], holes: [], error: '' };
  s.ui.onReview = (m, o) => { o.onActive(m.files[0]); return 'back'; };
  void s.flow.answer({ kind: 'review' });
  await tick();
  const p = s.server.take('alder/plan');
  assert.deepEqual(p.params.sets, { page: 'Posts.Index' });
  p.resolve(plan);
  await tick();
  assert.deepEqual(s.shownFiles, ['app/Posts/Index.alder']);
  assert.ok(!s.ui.forms.at(-1)!.closed, 'back reopened the form');
  s.ui.onReview = () => 'apply';
  void s.flow.answer({ kind: 'review' });
  await tick();
  s.server.take('alder/plan').resolve(plan);
  await s.flow.done;
  assert.deepEqual(s.applied, [{ id: 'new msg', sets: { page: 'Posts.Index' } }]);
});

test('flow: a plan answer for sets that changed meanwhile is dropped; an empty plan says so', async () => {
  const s = await started();
  void s.flow.answer({ kind: 'review' });
  await tick();
  const p = s.server.take('alder/plan');
  s.flow['setField']('name', 'Other');
  p.resolve({ files: [{ path: 'a', action: 'edited', before: 'a', after: 'b' }] });
  await tick();
  assert.ok(!s.ui.log.includes('review'));
  s.server.take('alder/preview').resolve(ready([nameYou('Other')]));
  await tick();
  void s.flow.answer({ kind: 'review' });
  await tick();
  s.server.take('alder/plan').resolve({ files: [], error: '' });
  await tick();
  assert.ok(s.ui.log.includes('info alder: nothing to change'));
  assert.ok(!s.ui.log.includes('review'));
});

test('flow: a failed preview shows the error; with the server gone the flow closes', async () => {
  const s = await started();
  s.flow['setField']('name', 'X');
  await tick();
  s.server.take('alder/preview').reject(new Error('boom'));
  await tick();
  assert.deepEqual(s.sink.shown.at(-1), ['the preview failed: boom']);
  assert.equal(s.ui.form_.model.updating, false);
  s.flow['setField']('name', 'Y');
  await tick();
  s.server.take('alder/preview').reject(Object.assign(new Error('cancelled'), { code: -32800 }));
  await tick();
  assert.deepEqual(s.sink.shown.at(-1), ['the preview failed: boom'], 'a cancelled preview is swallowed');
  s.server.up = false;
  s.flow['setField']('name', 'Z');
  await tick();
  s.server.take('alder/preview').reject(new Error('connection closed'));
  await s.flow.done;
  assert.ok(s.ui.log.includes('error alder: connection closed'));
  assert.ok(s.sink.disposed);
});

test('flow: closed flow ignores answers; escape closes; close is idempotent', async () => {
  const s = await started();
  s.flow['setField']('name', 'X');
  await tick();
  const late = s.server.take('alder/preview');
  await s.flow.answer({ kind: 'escape' });
  await s.flow.done;
  const shown = s.sink.shown.length;
  late.resolve(ready([nameYou('X')]));
  await tick();
  assert.equal(s.sink.shown.length, shown);
  s.flow.close();
});

test('flow: asPreset', () => {
  assert.deepEqual(asPreset('new msg'), { id: 'new msg' });
  assert.deepEqual(asPreset({ id: 'new msg', sets: { page: 'P', n: 3 }, why: 'x' }), { id: 'new msg', sets: { page: 'P' } });
  assert.equal(asPreset(undefined), undefined);
  assert.equal(asPreset({ sets: {} }), undefined);
  assert.equal(asPreset(42), undefined);
});
