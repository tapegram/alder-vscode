import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { bugText, CliResult, reportOf, run } from './cli';
import { cliEnv, Deps } from './deps';

// showReport shows a failed CLI run without rewording it (cli.lua's report): an error
// notification, or for exit 2 the bug report document beside the editor.
export async function showReport(deps: Deps, args: string[], res: CliResult, o: { bugOn2?: boolean } = {}): Promise<void> {
  const r = reportOf(args, res, o);
  if (r.kind === 'error') {
    void vscode.window.showErrorMessage(r.message);
    return;
  }
  const bin = await deps.clients.binary();
  const version = bin ? (await run(bin, ['version'], { cwd: homedir(), env: cliEnv() })).stdout : '';
  const uri = deps.docs.set('error.txt', bugText(args, res, version));
  await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}
