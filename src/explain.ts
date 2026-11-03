import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { ExecuteCommandRequest, State } from 'vscode-languageclient/node';
import { run } from './cli';
import { cliEnv, Deps } from './deps';
import { codeAt } from './explainAt';
import { projectRoot } from './project';
import { showReport } from './report';

// explainDiagnostic shows the explanation of code, else of the alder diagnostic at the cursor,
// else of a code the user types, in a markdown preview beside the editor. The text comes from
// the server (alder.explain) when one runs for the file, else from `alder explain <code>`.
// Returns the explanation document's uri, or undefined when nothing was shown.
export async function explainDiagnostic(deps: Deps, code?: string): Promise<vscode.Uri | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!code && editor) code = codeAt(vscode.languages.getDiagnostics(editor.document.uri), editor.selection.active);
  if (!code) {
    code = (await vscode.window.showInputBox({
      prompt: 'alder: no diagnostic under the cursor; explain which code?',
      placeHolder: 'E0003',
    }))?.trim();
  }
  if (!code) return undefined;
  const text = await explainText(deps, code, editor?.document.uri);
  if (text === undefined) return undefined;
  const uri = deps.docs.set(`explain/${code}.md`, text);
  try {
    await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
  } catch {
    // the built-in markdown extension is disabled: show the text itself
    await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }
  return uri;
}

async function explainText(deps: Deps, code: string, uri: vscode.Uri | undefined): Promise<string | undefined> {
  const client = await deps.clients.clientFor(uri);
  if (client && client.state === State.Running) {
    try {
      return await client.sendRequest(ExecuteCommandRequest.type, { command: 'alder.explain', arguments: [code] }) as string;
    } catch (err) {
      void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }
  const bin = await deps.clients.binary();
  if (!bin) return undefined;
  const args = ['explain', code];
  const res = await run(bin, args, { cwd: (await projectRoot(deps.clients)) ?? homedir(), env: cliEnv() });
  if (res.code !== 0) {
    await showReport(deps, args, res, { bugOn2: false });
    return undefined;
  }
  return res.stdout;
}
