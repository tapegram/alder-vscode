import * as vscode from 'vscode';
import type { VirtualDocs } from '../virtualDocs';
import type { PreviewSink } from './flow';

// PreviewDoc is a flow's live preview: a read-only diff document opened beside the origin
// without taking focus; each answer replaces its text and scrolls to the first hunk. It is
// opened as a pinned tab (not preview mode), so the review's preview-mode diff never replaces
// it; when no editor shows it (the diff covers it, or the user moved it away) the next show
// brings it back. dispose closes its tab and frees its text.
export class PreviewDoc implements PreviewSink {
  private readonly path: string;
  private readonly uri: vscode.Uri;
  private opening = false;
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

  private editor(): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === this.uri.toString());
  }

  show(lines: string[], firstHunk: number): void {
    if (this.disposed) return;
    this.hunk = firstHunk;
    this.docs.set(this.path, lines.join('\n'));
    if (this.opening || this.editor()) return;
    this.opening = true;
    vscode.window.showTextDocument(this.uri, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: false }).then(() => {
      this.opening = false;
      // disposed while it was opening: the tab opened after dispose closed the others
      if (this.disposed) this.closeTabs();
      else this.reveal();
    }, () => { this.opening = false; });
  }

  private reveal(): void {
    this.editor()?.revealRange(new vscode.Range(this.hunk, 0, this.hunk, 0), vscode.TextEditorRevealType.AtTop);
  }

  private closeTabs(): void {
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs)
      .filter(t => t.input instanceof vscode.TabInputText && t.input.uri.toString() === this.uri.toString());
    if (tabs.length > 0) void vscode.window.tabGroups.close(tabs);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sub.dispose();
    this.closeTabs();
    this.docs.delete(this.path);
  }
}
