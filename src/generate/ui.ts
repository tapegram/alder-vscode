import * as vscode from 'vscode';
import type { FlowUi, FormAnswer, FormModel, TextView } from './flow';
import type { PickerRow } from './picker';
import type { ReviewFile, ReviewModel } from './review';
import type { Generator } from './types';

// ui: the flow's steps as VS Code quick inputs. Every one keeps ignoreFocusOut, so the preview
// and the review's diff can update beside it without closing it. A hide the flow did not ask
// for (Escape) is the step's "nothing".

const reviewButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('diff'), tooltip: 'Review the plan' };
const applyButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('check'), tooltip: 'Apply (Ctrl+Enter)' };

const setFormOpen = (on: boolean) => void vscode.commands.executeCommand('setContext', 'alder.formOpen', on);

// once runs a quick input until it accepts (resolve with a value) or hides (resolve with none).
function once<T, I extends vscode.QuickPickItem>(qp: vscode.QuickPick<I>, accept: (resolve: (v: T) => void) => void, none: T): Promise<T> {
  return new Promise<T>(resolve => {
    let done = false;
    const finish = (v: T) => {
      if (done) return;
      done = true;
      qp.dispose();
      resolve(v);
    };
    qp.onDidAccept(() => accept(finish));
    qp.onDidHide(() => finish(none));
    qp.show();
  });
}

interface FieldItem extends vscode.QuickPickItem { name?: string; apply?: boolean }

export function quickInputUi(): FlowUi {
  return {
    info: m => void vscode.window.showInformationMessage(m),
    warn: m => void vscode.window.showWarningMessage(m),
    error: m => void vscode.window.showErrorMessage(m),
    confirm: async (message, action) => (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action,

    pickGenerator(rows: PickerRow[]) {
      const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { g?: Generator }>();
      qp.title = 'Alder: Generate';
      qp.placeholder = 'a generator';
      qp.matchOnDescription = true;
      qp.ignoreFocusOut = true;
      qp.items = rows.map(r => ('heading' in r
        ? { label: r.heading, kind: vscode.QuickPickItemKind.Separator }
        : { label: r.item.id, description: r.item.summary, detail: r.item.why, g: r.item }));
      return once<Generator | undefined, vscode.QuickPickItem & { g?: Generator }>(qp, done => {
        const g = qp.activeItems[0]?.g;
        if (g) done(g);
      }, undefined);
    },

    form(m: FormModel, answer: (a: FormAnswer) => void) {
      const qp = vscode.window.createQuickPick<FieldItem>();
      qp.ignoreFocusOut = true;
      qp.matchOnDescription = true;
      let closing = false;
      const paint = (model: FormModel) => {
        const keep = qp.activeItems[0];
        const want = keep ? (keep.apply ? '\0apply' : keep.name) : model.active;
        qp.title = model.title;
        qp.busy = model.updating;
        qp.buttons = [vscode.QuickInputButtons.Back, reviewButton, ...(model.ready ? [applyButton] : [])];
        const items: FieldItem[] = model.rows.map(r => ({
          label: r.name,
          description: r.value,
          detail: r.note === undefined ? undefined : r.error ? `$(error) ${r.note}` : r.note,
          name: r.name,
        }));
        items.push({ label: '$(check) Apply', description: model.ready ? '' : 'not ready', apply: true, alwaysShow: true });
        qp.items = items;
        const a = items.find(i => (want === '\0apply' ? i.apply : i.name === want));
        if (a) qp.activeItems = [a];
      };
      paint(m);
      qp.onDidAccept(() => {
        const item = qp.activeItems[0];
        if (!item) return;
        answer(item.apply ? { kind: 'apply' } : { kind: 'field', name: item.name! });
      });
      qp.onDidTriggerButton(b => {
        if (b === vscode.QuickInputButtons.Back) answer({ kind: 'back' });
        else if (b === reviewButton) answer({ kind: 'review' });
        else if (b === applyButton) answer({ kind: 'apply' });
      });
      qp.onDidHide(() => {
        // a hide after close() is the flow's own: close() already cleared the key, and clearing it
        // again here could land after the next form set it
        if (closing) return;
        closing = true;
        setFormOpen(false);
        qp.dispose();
        answer({ kind: 'escape' });
      });
      qp.show();
      setFormOpen(true);
      return {
        update: paint,
        close: () => {
          if (closing) return;
          closing = true;
          setFormOpen(false);
          qp.dispose();
        },
      };
    },

    pickOne(o) {
      const qp = vscode.window.createQuickPick();
      qp.title = o.title;
      qp.placeholder = o.placeholder;
      qp.ignoreFocusOut = true;
      qp.items = o.items.map(label => ({ label }));
      const a = qp.items.find(i => i.label === o.active);
      if (a) qp.activeItems = [a];
      return once<string | undefined, vscode.QuickPickItem>(qp, done => {
        const item = qp.activeItems[0];
        if (item) done(item.label);
      }, undefined);
    },

    module(o) {
      type Item = vscode.QuickPickItem & { typed?: boolean };
      const qp = vscode.window.createQuickPick<Item>();
      qp.title = o.title;
      qp.ignoreFocusOut = true;
      qp.value = o.value;
      const paint = () => {
        const s = o.suggest(qp.value);
        qp.items = [
          { label: s.help, description: 'Enter uses this name', alwaysShow: true, typed: true },
          ...s.suggestions.map(x => ({ label: x, description: 'Enter completes', alwaysShow: true })),
        ];
      };
      paint();
      qp.onDidChangeValue(paint);
      return once<string | undefined, Item>(qp, done => {
        const item = qp.activeItems[0];
        if (!item || item.typed) return done(qp.value);
        // a folder prefix goes into the input and the picker stays open
        qp.value = item.label;
        paint();
      }, undefined);
    },

    text(o): TextView {
      const ib = vscode.window.createInputBox();
      ib.title = o.title;
      ib.value = o.value;
      ib.prompt = o.prompt;
      ib.placeholder = o.placeholder;
      ib.ignoreFocusOut = true;
      const result = new Promise<string | undefined>(resolve => {
        let done = false;
        const finish = (v: string | undefined) => {
          if (done) return;
          done = true;
          ib.dispose();
          resolve(v);
        };
        ib.onDidChangeValue(t => o.onChange(t));
        ib.onDidAccept(() => finish(ib.value));
        ib.onDidHide(() => finish(undefined));
      });
      ib.show();
      return { setValidation: m => { ib.validationMessage = m; }, result };
    },

    review(m: ReviewModel, o: { title: string; onActive(f: ReviewFile): void }) {
      type Item = vscode.QuickPickItem & { file?: ReviewFile };
      const qp = vscode.window.createQuickPick<Item>();
      qp.title = `${o.title}: review`;
      qp.placeholder = m.canApply ? 'Enter applies · Escape goes back' : 'cannot apply · Escape goes back';
      qp.ignoreFocusOut = true;
      const applyNow: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('check'), tooltip: 'Apply' };
      qp.buttons = [vscode.QuickInputButtons.Back, ...(m.canApply ? [applyNow] : [])];
      qp.items = [
        { label: 'plan', kind: vscode.QuickPickItemKind.Separator },
        ...(m.notes.length > 0 ? m.notes : ['no holes, no warnings']).map(n => ({ label: n })),
        { label: 'files', kind: vscode.QuickPickItemKind.Separator },
        ...m.files.map(f => ({ label: `${f.mark} ${f.path}`, file: f })),
      ];
      const first = qp.items.find(i => i.file);
      if (first) {
        qp.activeItems = [first];
        o.onActive(first.file!);
      }
      qp.onDidChangeActive(items => { if (items[0]?.file) o.onActive(items[0].file); });
      return new Promise<'apply' | 'back'>(resolve => {
        let done = false;
        const finish = (v: 'apply' | 'back') => {
          if (done) return;
          done = true;
          qp.dispose();
          resolve(v);
        };
        qp.onDidAccept(() => { if (m.canApply) finish('apply'); });
        qp.onDidTriggerButton(b => finish(b === applyNow ? 'apply' : 'back'));
        qp.onDidHide(() => finish('back'));
        qp.show();
      });
    },
  };
}
