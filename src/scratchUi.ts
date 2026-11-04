import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { Deps } from './deps';
import { NO_ROOT, requireRoot } from './project';
import { findRoot } from './root';
import { inHeaderWarning, isScratchPath, lineSpan, moduleName, SCRATCH_FILE, scratchInsert, TEMPLATE } from './scratchText';

export const NO_EDITOR = 'alder: open a file to send from';

// ScratchUi is scratch.lua's editor side: Open Scratch, Send to Scratch, Open Scratch Value, the
// hover and the file-level line. The values themselves are the server's inlay hints.
export class ScratchUi {
  private warnedIn = false; // the `in Module` warning, once per session

  constructor(private readonly deps: Deps) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('alder.scratch.open', () => this.open()),
      vscode.commands.registerCommand('alder.scratch.send', () => this.send()),
    );
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
