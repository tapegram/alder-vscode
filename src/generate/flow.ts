import { current, editorKind, exampleLine, FieldRow, firstInvalid, firstToFill, moduleDirs, moduleHelp, moduleSuggest, moduleText, rows, sets, Typed, visible } from './form';
import { PickerRow, pickerRows } from './picker';
import { firstHunk, render } from './preview';
import { ReviewFile, ReviewModel, reviewModel } from './review';
import type { FieldState, Generator, PlanResult, Preset, PreviewResult, Sets } from './types';

// flow: the generator flow's state, ported from alder.nvim's modal.lua: the picker, the form,
// one preview request per burst of typing with a sequence number so a late answer never
// counts, the enter rules and the review. No vscode here: the UI, the server and the preview
// document come in through FlowEnv, so the unit tests drive it with fakes.

export const DEBOUNCE_MS = 80;

export interface Position { line: number; character: number }
export interface Origin { uri: string; position: Position; root: string }
export interface Server { request<T>(method: string, params: unknown): Promise<T>; running(): boolean }

export interface FormModel { title: string; rows: FieldRow[]; ready: boolean; updating: boolean; active?: string }
export type FormAnswer = { kind: 'field'; name: string } | { kind: 'apply' } | { kind: 'review' } | { kind: 'back' } | { kind: 'escape' };
export interface FormView { update(m: FormModel): void; close(): void }
export interface TextView { setValidation(message: string | undefined): void; result: Promise<string | undefined> }

export interface ApplyUi {
  confirm(message: string, action: string): Promise<boolean>;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface FlowUi extends ApplyUi {
  pickGenerator(rows: PickerRow[]): Promise<Generator | undefined>;
  form(m: FormModel, answer: (a: FormAnswer) => void): FormView;
  pickOne(o: { title: string; items: string[]; active?: string; placeholder?: string }): Promise<string | undefined>;
  module(o: { title: string; value: string; suggest(text: string): { help: string; suggestions: string[] } }): Promise<string | undefined>;
  text(o: { title: string; value: string; prompt?: string; placeholder?: string; onChange(text: string): void }): TextView;
  review(m: ReviewModel, o: { title: string; onActive(f: ReviewFile): void }): Promise<'apply' | 'back'>;
}

export interface PreviewSink { show(lines: string[], firstHunk: number): void; dispose(): void }

export interface FlowEnv {
  server: Server;
  ui: FlowUi;
  preview: PreviewSink;
  apply(id: string, sets: Sets): Promise<unknown>;
  showPlanFile(f: ReviewFile): void;
  debounceMs?: number;
}

// asPreset reads alder.generate's argument: a generator id, or a code action's {id, sets, why}.
export function asPreset(a: unknown): Preset | undefined {
  if (typeof a === 'string') return { id: a };
  if (!a || typeof a !== 'object') return undefined;
  const o = a as { id?: unknown; sets?: unknown };
  if (typeof o.id !== 'string') return undefined;
  const out: Sets = {};
  if (o.sets && typeof o.sets === 'object') {
    for (const [k, v] of Object.entries(o.sets)) if (typeof v === 'string') out[k] = v;
  }
  return { id: o.id, sets: out };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const cancelled = (err: unknown) => !!err && typeof err === 'object' && (err as { code?: unknown }).code === -32800;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function sameSets(a: Sets, b: Sets): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every(k => has(b, k) && a[k] === b[k]);
}

// shared by every flow, so a closed flow's answer never matches a new one's number
let seqCounter = 0;

export class Flow {
  readonly done: Promise<void>;
  private finish!: () => void;
  private closed = false;
  private items: Generator[] = [];
  private sel: Generator | undefined;
  private preset: Sets = {};
  private typed: Typed = {};
  private fields: FieldState[] = [];
  private active: string | undefined;
  private seq = 0;
  private ready = false;
  private updating = false;
  private fillFirst = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private view: FormView | undefined;
  private textView: { name: string; view: TextView } | undefined;
  private dirs: string[] | undefined;

  constructor(private readonly env: FlowEnv, private readonly origin: Origin) {
    this.done = new Promise(r => { this.finish = r; });
  }

  private params(extra: object = {}) {
    return { textDocument: { uri: this.origin.uri }, position: this.origin.position, ...extra };
  }

  private sets(): Sets {
    return sets(this.preset, this.typed);
  }

  async start(preset?: Preset): Promise<void> {
    let res: { generators?: Generator[] | null } | null;
    try {
      res = await this.env.server.request('alder/generators', this.params());
    } catch (err) {
      if (!this.closed) {
        this.env.ui.error(`alder: ${message(err)}`);
        this.close();
      }
      return;
    }
    if (this.closed) return;
    this.items = res?.generators ?? [];
    if (this.items.length === 0) {
      this.env.ui.warn('alder: no generators');
      return this.close();
    }
    const found = preset && this.items.find(i => i.id === preset.id);
    if (found) return this.select(found, preset.sets);
    await this.pick();
  }

  private async pick(): Promise<void> {
    const g = await this.env.ui.pickGenerator(pickerRows(this.items));
    if (this.closed) return;
    if (!g) return this.close();
    this.select(g);
  }

  private select(g: Generator, presetSets?: Sets): void {
    this.sel = g;
    this.preset = { ...(g.sets ?? {}), ...(presetSets ?? {}) };
    this.typed = {};
    this.fields = [];
    this.active = undefined;
    this.fillFirst = true;
    this.env.preview.show([], 0);
    this.openForm();
    void this.sendPreview();
  }

  private model(): FormModel {
    const sel = this.sel!;
    return {
      title: `${sel.id}  ${sel.summary}${this.updating ? '  updating…' : ''}`,
      rows: rows(this.fields, this.typed),
      ready: this.ready,
      updating: this.updating,
      active: this.active,
    };
  }

  private openForm(): void {
    if (this.closed || !this.sel) return;
    this.view = this.env.ui.form(this.model(), a => void this.answer(a));
  }

  private closeForm(): void {
    this.view?.close();
    this.view = undefined;
  }

  private render(): void {
    if (this.sel) this.view?.update(this.model());
  }

  // invalidate makes every preview in flight or waiting stale: the form is not ready until a newer answer.
  private invalidate(): void {
    seqCounter++;
    this.seq = seqCounter;
    this.ready = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private setField(name: string, text: string): void {
    this.typed[name] = text;
    this.requestPreview();
  }

  // requestPreview asks after a pause (one request per burst of typing).
  private requestPreview(): void {
    if (this.closed) return;
    this.invalidate();
    this.updating = true;
    this.render();
    const ms = this.env.debounceMs ?? DEBOUNCE_MS;
    // no debounce asks at once: a 0 ms timer still waits for the timers phase, after setImmediate
    if (ms <= 0) {
      void this.sendPreview();
      return;
    }
    this.timer = setTimeout(() => void this.sendPreview(), ms);
  }

  private async sendPreview(): Promise<void> {
    const sel = this.sel;
    if (this.closed || !sel) return;
    this.invalidate();
    const n = this.seq;
    this.updating = true;
    this.render();
    let r: PreviewResult;
    try {
      r = (await this.env.server.request<PreviewResult | null>('alder/preview', this.params({ id: sel.id, sets: this.sets() }))) ?? {};
    } catch (err) {
      if (this.closed || n !== this.seq || cancelled(err)) return;
      if (!this.env.server.running()) {
        this.env.ui.error(`alder: ${message(err)}`);
        return this.close();
      }
      r = { error: `the preview failed: ${message(err)}`, files: [] };
    }
    this.onPreview(n, r);
  }

  private whyOf(name: string): string | undefined {
    const f = this.fields.find(x => x.name === name);
    return f?.why && f.why !== 'required' ? f.why : undefined;
  }

  private onPreview(n: number, r: PreviewResult): void {
    if (this.closed || n !== this.seq) return;
    this.updating = false;
    if (r.fields) this.fields = visible(r.fields);
    this.ready = r.ready === true;
    const lines = render(r);
    this.env.preview.show(lines, firstHunk(lines));
    if (this.textView) this.textView.view.setValidation(this.whyOf(this.textView.name));
    this.render();
    if (this.fillFirst) {
      this.fillFirst = false;
      const i = firstToFill(this.fields, this.typed);
      if (i !== undefined) void this.edit(this.fields[i].name);
    }
  }

  async answer(a: FormAnswer): Promise<void> {
    if (this.closed) return;
    switch (a.kind) {
      case 'escape':
        return this.close();
      case 'back':
        this.closeForm();
        this.invalidate();
        this.updating = false;
        this.sel = undefined;
        return this.pick();
      case 'field':
        return this.edit(a.name);
      case 'apply':
        return this.enter();
      case 'review':
        return this.review();
    }
  }

  private async edit(name: string): Promise<void> {
    const sel = this.sel;
    const f = this.fields.find(x => x.name === name);
    if (this.closed || !sel || !f) return;
    this.active = name;
    this.closeForm();
    const ui = this.env.ui;
    const title = `${sel.id}: ${name}`;
    const now = current(f, this.typed);
    switch (editorKind(f)) {
      case 'bool': {
        const v = await ui.pickOne({ title, items: ['on', 'off'], active: now === 'true' ? 'on' : 'off' });
        if (v !== undefined && !this.closed) this.setField(name, v === 'on' ? 'true' : 'false');
        break;
      }
      case 'choice': {
        const v = await ui.pickOne({ title, items: f.choices ?? [], active: now, placeholder: f.help });
        if (v !== undefined && !this.closed) this.setField(name, v);
        break;
      }
      case 'module': {
        const dirs = (this.dirs ??= moduleDirs(this.origin.root));
        const v = await ui.module({ title, value: moduleText(f, this.typed), suggest: t => ({ help: moduleHelp(t), suggestions: moduleSuggest(dirs, t) }) });
        if (v !== undefined && !this.closed) this.setField(name, v);
        break;
      }
      case 'text': {
        const had = has(this.typed, name);
        const before = this.typed[name];
        const view = ui.text({ title, value: now, prompt: f.help || undefined, placeholder: exampleLine(f), onChange: t => this.setField(name, t) });
        this.textView = { name, view };
        view.setValidation(this.whyOf(name));
        const v = await view.result;
        this.textView = undefined;
        if (this.closed) return;
        if (v === undefined) {
          if (had ? this.typed[name] !== before : has(this.typed, name)) {
            if (had) this.typed[name] = before;
            else delete this.typed[name];
            this.requestPreview();
          }
        } else if (this.typed[name] !== v) {
          this.setField(name, v);
        }
        break;
      }
    }
    if (!this.closed && this.sel === sel) this.openForm();
  }

  // enter is modal.lua's enter: nothing while a preview is in flight (the sets on screen are not
  // the previewed ones); not ready → the first invalid field; else apply.
  private async enter(): Promise<void> {
    if (!this.sel || this.updating) return;
    if (!this.ready) {
      const i = firstInvalid(this.fields);
      // not awaited: the editor stays up until it answers, and the caller should not wait on it
      if (i !== undefined) void this.edit(this.fields[i].name);
      return;
    }
    await this.applyWith(this.sel.id, this.sets());
  }

  private async applyWith(id: string, s: Sets): Promise<void> {
    this.teardown();
    try {
      await this.env.apply(id, s);
    } finally {
      this.finish();
    }
  }

  private async review(): Promise<void> {
    const sel = this.sel;
    if (!sel) return;
    const planned = this.sets();
    let plan: PlanResult | null;
    try {
      plan = await this.env.server.request<PlanResult | null>('alder/plan', this.params({ id: sel.id, sets: planned }));
    } catch (err) {
      if (this.closed) return;
      this.env.ui.error(`alder: ${message(err)}`);
      if (!this.env.server.running()) this.close();
      return;
    }
    // the form changed while the plan was in flight: it is not the plan of what is on screen
    if (this.closed || this.sel !== sel || !sameSets(planned, this.sets())) return;
    const m = reviewModel(plan);
    if (m.files.length === 0 && m.canApply) {
      this.env.ui.info('alder: nothing to change');
      return;
    }
    this.closeForm();
    const choice = await this.env.ui.review(m, { title: sel.id, onActive: f => this.env.showPlanFile(f) });
    if (this.closed) return;
    if (choice === 'apply' && m.canApply) return this.applyWith(sel.id, planned);
    this.openForm();
  }

  private teardown(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.closeForm();
    this.env.preview.dispose();
  }

  close(): void {
    this.teardown();
    this.finish();
  }
}
