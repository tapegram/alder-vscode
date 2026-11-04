import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { Deps } from './deps';
import { NO_ROOT, requireRoot } from './project';
import { findRoot } from './root';
import { docLines, FileLine, fileLine, needsHover, watchAt, watchText, type ScratchWatch } from './scratch';
import { inHeaderWarning, isScratchPath, lineSpan, moduleName, SCRATCH_FILE, scratchInsert, TEMPLATE } from './scratchText';

export const NO_EDITOR = 'alder: open a file to send from';
export const NO_VALUE = 'alder: no scratch value here';

// ScratchUi is scratch.lua's editor side: Open Scratch, Send to Scratch, Open Scratch Value, the
// hover and the file-level line. The values themselves are the server's inlay hints.
export class ScratchUi {
  private warnedIn = false; // the `in Module` warning, once per session
  // shown is the file-level line of each scratch document, computed once per notification
  private shown = new Map<string, FileLine>();
  // warnedAt is the version of the run that first showed a document's warning (nvim's warned[buf])
  private warnedAt = new Map<string, number>();
  private readonly deco = vscode.window.createTextEditorDecorationType({});

  constructor(private readonly deps: Deps) {}

  register(context: vscode.ExtensionContext): void {
    const store = this.deps.clients.scratch;
    const off = store.onChange(uri => this.recorded(uri));
    context.subscriptions.push(
      { dispose: off },
      this.deco,
      vscode.commands.registerCommand('alder.scratch.open', () => this.open()),
      vscode.commands.registerCommand('alder.scratch.send', () => this.send()),
      vscode.commands.registerCommand('alder.scratch.openValue', () => this.openValue()),
      vscode.languages.registerHoverProvider({ scheme: 'file', language: 'alder', pattern: '**/*scratch.alder' }, {
        provideHover: (doc, pos) => {
          const w = this.watchAt(doc, pos.line + 1);
          if (!w || !needsHover(w)) return undefined;
          return new vscode.Hover(new vscode.MarkdownString().appendCodeblock(watchText(w), 'text'));
        },
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (this.shown.has(e.document.uri.toString())) this.paint(e.document.uri.toString());
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => {
        for (const uri of this.shown.keys()) this.paint(uri);
      }),
      vscode.workspace.onDidCloseTextDocument(doc => {
        if (!isScratchPath(doc.uri.fsPath)) return;
        this.warnedAt.delete(doc.uri.toString());
        store.forget(doc.uri.toString());
      }),
    );
  }

  // openValue opens the full result of the watch under the cursor in a read-only document beside.
  async openValue(): Promise<vscode.TextDocument | undefined> {
    const editor = vscode.window.activeTextEditor;
    const w = editor && this.watchAt(editor.document, editor.selection.active.line + 1);
    if (!w) {
      void vscode.window.showInformationMessage(NO_VALUE);
      return undefined;
    }
    const uri = this.deps.docs.set('scratch/value.txt', watchText(w));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: true });
    return doc;
  }

  // line is what line 1 of the scratch document uri shows, for the tests.
  line(uri: string): { text: string; kind: 'error' | 'note'; stale: boolean } | undefined {
    const l = this.shown.get(uri);
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
    if (!l || !doc) return undefined;
    return { text: l.text, kind: l.kind, stale: this.stale(uri, doc) };
  }

  private watchAt(doc: vscode.TextDocument, line: number): ScratchWatch | undefined {
    const e = this.deps.clients.scratch.entry(doc.uri.toString());
    return e && watchAt(e, docLines(doc.getText()), line);
  }

  private stale(uri: string, doc: vscode.TextDocument): boolean {
    return this.deps.clients.scratch.last(uri)?.version !== doc.version;
  }

  // recorded computes the file-level line of a new notification (or its absence) and paints it.
  private recorded(uri: string): void {
    const p = this.deps.clients.scratch.last(uri);
    const l = p && fileLine(p, this.warnedAt.get(uri));
    if (l?.warning && !this.warnedAt.has(uri) && p?.version !== undefined) this.warnedAt.set(uri, p.version);
    if (l) this.shown.set(uri, l);
    else this.shown.delete(uri);
    this.paint(uri);
  }

  // paint puts the file-level line at the end of line 1 in every editor showing uri, dimmed when
  // the document has changed since the run.
  private paint(uri: string): void {
    const l = this.shown.get(uri);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() !== uri) continue;
      if (!l) {
        editor.setDecorations(this.deco, []);
        continue;
      }
      const color = this.stale(uri, editor.document) ? 'disabledForeground' : l.kind === 'error' ? 'errorForeground' : 'editorInlayHint.foreground';
      const end = editor.document.lineAt(0).range.end;
      editor.setDecorations(this.deco, [{
        range: new vscode.Range(end, end),
        renderOptions: { after: { contentText: '  ' + l.text, color: new vscode.ThemeColor(color) } },
      }]);
    }
  }

  // open shows <root>/scratch.alder of the project, creating it from TEMPLATE when missing.
  async open(): Promise<vscode.TextEditor | undefined> {
    const root = await requireRoot(this.deps.clients);
    if (!root) return undefined;
    const path = await ensure(root);
    return path ? vscode.window.showTextDocument(vscode.Uri.file(path)) : undefined;
  }

  // send appends the selected lines (or the cursor's line) of the active editor to its app's
  // scratch.alder and saves it, which runs it; a definition goes in as written, an expression as
  // a watch, and lines in a scratch file that already hold watches as they are.
  async send(): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage(NO_EDITOR);
      return false;
    }
    const from = editor.document;
    const root = from.uri.scheme === 'file' ? await findRoot(from.uri.fsPath) : undefined;
    if (!root) {
      void vscode.window.showErrorMessage(NO_ROOT);
      return false;
    }
    const [first, last] = lineSpan(editor.selection.start, editor.selection.end);
    const lines: string[] = [];
    for (let i = first; i <= last; i++) lines.push(from.lineAt(i).text);
    const fromScratch = isScratchPath(from.uri.fsPath);
    const raw = fromScratch && lines.some(l => l.startsWith('>'));
    const module = !fromScratch && from.languageId === 'alder' ? moduleName(from.getText()) : undefined;
    const path = await ensure(root);
    if (!path) return false;
    const target = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
    const insert = scratchInsert(target.getText(), lines, raw);
    if (insert === undefined) return false;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(target.uri, target.lineAt(target.lineCount - 1).range.end, insert);
    if (!(await vscode.workspace.applyEdit(edit))) {
      void vscode.window.showErrorMessage(`alder: could not edit ${path}`);
      return false;
    }
    if (!(await target.save())) {
      void vscode.window.showErrorMessage(`alder: could not save ${path}`);
      return false;
    }
    if (!vscode.window.visibleTextEditors.some(e => e.document === target)) {
      await vscode.window.showTextDocument(target, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    }
    const warning = this.warnedIn ? undefined : inHeaderWarning(module, target.getText());
    if (warning) {
      this.warnedIn = true;
      void vscode.window.showWarningMessage(warning);
    }
    return true;
  }
}

// ensure is <root>/scratch.alder, written from TEMPLATE first when it is missing; undefined
// (reported) when it cannot be written.
async function ensure(root: string): Promise<string | undefined> {
  const path = join(root, SCRATCH_FILE);
  try {
    await writeFile(path, TEMPLATE, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      void vscode.window.showErrorMessage(`alder: could not create ${path}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }
  return path;
}
