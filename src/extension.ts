import * as vscode from 'vscode';
import { State } from 'vscode-languageclient/node';
import { Clients } from './client';
import { SERVER_COMMANDS, serverEnv } from './clientConfig';
import { registerNotYet, trackProject } from './commands';
import { Deps } from './deps';
import { explainDiagnostic } from './explain';
import { applyGenerator } from './generate/apply';
import type { ApplyUi, Origin } from './generate/flow';
import type { Sets } from './generate/types';
import { report } from './health';
import { AppTerminals } from './run';
import { fetchCli, fetchRoutes, Fetched, pickRoutes, RouteUi } from './routes';
import { AlderTests } from './tests';
import { VirtualDocs } from './virtualDocs';

export interface Api {
  clients: Clients;
  docs: VirtualDocs;
  routes: {
    fetch(root: string): Promise<Fetched>;
    fetchCli(root: string, lspError?: string): Promise<Fetched>;
  };
  tests: AlderTests;
  health(): Promise<string[]>;
  generate: {
    apply(origin: Origin, id: string, s: Sets, ui: ApplyUi): Promise<boolean>;
    diagnostics: vscode.DiagnosticCollection;
  };
}

let clients: Clients | undefined;

export function activate(context: vscode.ExtensionContext): Api {
  const output = vscode.window.createOutputChannel('Alder', { log: true });
  context.subscriptions.push(output);
  const cs = new Clients(output);
  clients = cs;
  const docs = new VirtualDocs();
  docs.register(context);
  const deps: Deps = { clients: cs, docs, output };
  const terminals = new AppTerminals(deps);
  terminals.register(context);
  const tests = new AlderTests(deps);
  tests.register(context);

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
    vscode.commands.registerCommand('alder.explainDiagnostic', (code?: unknown) => explainDiagnostic(deps, typeof code === 'string' ? code : undefined)),
    vscode.commands.registerCommand('alder.routes', (ui?: RouteUi) => pickRoutes(deps, ui && typeof ui.pick === 'function' ? ui : undefined)),
    vscode.commands.registerCommand('alder.run', () => terminals.run()),
    vscode.commands.registerCommand('alder.test.run', () => tests.runActive('test')),
    vscode.commands.registerCommand('alder.test.runAtCursor', () => tests.runAtCursor()),
    vscode.commands.registerCommand('alder.test.mutate', () => tests.runActive('mutate')),
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
  const genDiagnostics = vscode.languages.createDiagnosticCollection('alder generate');
  context.subscriptions.push(genDiagnostics);
  const generateApply = async (origin: Origin, id: string, s: Sets, ui: ApplyUi) => {
    const client = await cs.forUri(origin.uri);
    if (!client) {
      ui.error('alder: no alder lsp running for this file');
      return false;
    }
    const server = { request: <T>(m: string, p: unknown) => client.sendRequest<T>(m, p), running: () => client.state === State.Running };
    return applyGenerator({ server, root: origin.root, ui, diagnostics: genDiagnostics }, origin, id, s);
  };
  return {
    clients: cs,
    docs,
    routes: { fetch: root => fetchRoutes(deps, root), fetchCli: (root, e) => fetchCli(deps, root, e) },
    tests,
    health,
    generate: { apply: generateApply, diagnostics: genDiagnostics },
  };
}

export async function deactivate(): Promise<void> {
  await clients?.stopAll();
}
