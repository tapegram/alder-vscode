import * as vscode from 'vscode';

export const DOC_SCHEME = 'alder-doc';

// VirtualDocs are read-only documents the extension writes: the CLI's bug report and the
// explanations. A path's extension picks the language (explain/E0003.md is markdown).
export class VirtualDocs implements vscode.TextDocumentContentProvider {
  private texts = new Map<string, string>();
  private changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DOC_SCHEME, this), this.changed);
  }

  set(path: string, text: string): vscode.Uri {
    const uri = vscode.Uri.from({ scheme: DOC_SCHEME, path: '/' + path });
    this.texts.set(uri.path, text);
    this.changed.fire(uri);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.texts.get(uri.path) ?? '';
  }
}
