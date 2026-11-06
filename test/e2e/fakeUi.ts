import type { ApplyUi, FlowUi, FormAnswer, FormModel, TextView } from '../../src/generate/flow';
import type { PickerRow } from '../../src/generate/picker';
import type { ReviewFile, ReviewModel } from '../../src/generate/review';
import type { Generator } from '../../src/generate/types';

// FakeUi answers the generator flow in a test: each step calls the matching handler; the
// messages land in log. The handlers default to Escape.
export class FakeUi implements FlowUi, ApplyUi {
  log: string[] = [];
  forms: { model: FormModel; answer(a: FormAnswer): void; closed: boolean }[] = [];
  texts: { title: string; value: string; onChange(t: string): void; validation?: string; finish(v: string | undefined): void }[] = [];
  onPick: (rows: PickerRow[]) => Generator | undefined = () => undefined;
  onPickOne: (o: { title: string; items: string[]; active?: string }) => string | undefined = () => undefined;
  onModule: (o: { value: string }) => string | undefined = () => undefined;
  onReview: (m: ReviewModel, o: { onActive(f: ReviewFile): void }) => 'apply' | 'back' | Promise<'apply' | 'back'> = () => 'back';
  onConfirm: (message: string, action: string) => Promise<boolean> | boolean = () => false;

  info(m: string) { this.log.push(`info ${m}`); }
  warn(m: string) { this.log.push(`warn ${m}`); }
  error(m: string) { this.log.push(`error ${m}`); }
  async confirm(message: string, action: string) { this.log.push(`confirm ${message} [${action}]`); return this.onConfirm(message, action); }
  async pickGenerator(rows: PickerRow[]) { return this.onPick(rows); }
  form(model: FormModel, answer: (a: FormAnswer) => void) {
    const call = { model, answer, closed: false };
    this.forms.push(call);
    return { update: (m: FormModel) => { call.model = m; }, close: () => { call.closed = true; } };
  }
  async pickOne(o: { title: string; items: string[]; active?: string }) { return this.onPickOne(o); }
  async module(o: { title: string; value: string }) { return this.onModule(o); }
  text(o: { title: string; value: string; onChange(t: string): void }): TextView {
    let finish!: (v: string | undefined) => void;
    const result = new Promise<string | undefined>(r => { finish = r; });
    const entry = { title: o.title, value: o.value, onChange: o.onChange, validation: undefined as string | undefined, finish };
    this.texts.push(entry);
    return { setValidation: m => { entry.validation = m; }, result };
  }
  async review(m: ReviewModel, o: { title: string; onActive(f: ReviewFile): void }) { return this.onReview(m, o); }
  stepsClosed = 0;
  closeSteps() {
    this.stepsClosed++;
    for (const t of this.texts) t.finish(undefined);
  }
  // form is the open form, if any
  get openForm() { const f = this.forms[this.forms.length - 1]; return f && !f.closed ? f : undefined; }
}
