import * as vscode from 'vscode';
import type { VirtualDocs } from '../virtualDocs';
import type { PreviewSink } from './flow';

// PreviewDoc is a flow's live preview: a read-only diff document opened once beside the origin
// without taking focus; each answer replaces its text and scrolls to the first hunk. dispose
// closes its tab.
export class PreviewDoc implements PreviewSink {
  private readonly path: string;
  private readonly uri: vscode.Uri;
  private opened: Thenable<vscode.TextEditor> | undefined;
  private hunk = 0;
  private readonly sub: vscode.Disposable;
  private disposed = false;

  constructor(private readonly docs: VirtualDocs, n: number) {
    this.path = `generate/${n}/Generate Preview.diff`;
    this.uri = docs.set(this.path, '');
    // the provider's onDidChange reloads the document after show: scroll once the new text is in
    this.sub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === this.uri.toString()) this.reveal();
    });
  }

  show(lines: string[], firstHunk: number): void {
    if (this.disposed) return;
    this.hunk = firstHunk;
    this.docs.set(this.path, lines.join('\n'));
    if (!this.opened) {
      this.opened = vscode.window.showTextDocument(this.uri, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: true });
      this.opened.then(() => this.reveal(), () => undefined);
    }
  }

  private reveal(): void {
    const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === this.uri.toString());
    if (ed) ed.revealRange(new vscode.Range(this.hunk, 0, this.hunk, 0), vscode.TextEditorRevealType.AtTop);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sub.dispose();
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs)
      .filter(t => t.input instanceof vscode.TabInputText && t.input.uri.toString() === this.uri.toString());
    if (tabs.length > 0) void vscode.window.tabGroups.close(tabs);
  }
}
