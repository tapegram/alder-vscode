import * as vscode from 'vscode';
import { Clients } from './client';
import { SERVER_COMMANDS, serverEnv } from './clientConfig';
import { registerNotYet, trackProject } from './commands';
import { report } from './health';

export interface Api {
  clients: Clients;
  health(): Promise<string[]>;
}

let clients: Clients | undefined;

export function activate(context: vscode.ExtensionContext): Api {
  const output = vscode.window.createOutputChannel('Alder', { log: true });
  context.subscriptions.push(output);
  const cs = new Clients(output);
  clients = cs;

  const health = async () => {
    const env = serverEnv(process.env, vscode.workspace.getConfiguration('alder').get('serverEnv'));
    return report(await cs.checkGate(), cs.statuses(), env);
  };

  for (const command of SERVER_COMMANDS) {
    context.subscriptions.push(vscode.commands.registerCommand(command, (...args: unknown[]) => cs.execute(command, args)));
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('alder.showHealth', async () => {
      output.appendLine(`--- Alder health ${new Date().toISOString()}`);
      for (const line of await health()) output.appendLine(line);
      output.show(true);
    }),
    vscode.commands.registerCommand('alder.restartServer', () => cs.restart()),
    vscode.workspace.onDidOpenTextDocument(doc => void cs.ensure(doc)),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('alder.path') || e.affectsConfiguration('alder.serverEnv')) {
        void vscode.window.showInformationMessage('alder: run Alder: Restart Server to apply the new setting');
      }
    }),
  );
  registerNotYet(context);
  trackProject(context);
  for (const doc of vscode.workspace.textDocuments) void cs.ensure(doc);
  return { clients: cs, health };
}

export async function deactivate(): Promise<void> {
  await clients?.stopAll();
}
