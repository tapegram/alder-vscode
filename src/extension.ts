import * as vscode from 'vscode';
import { Clients } from './client';
import { SERVER_COMMANDS, serverEnv } from './clientConfig';
import { registerNotYet, trackProject } from './commands';
import { Deps } from './deps';
import { explainDiagnostic } from './explain';
import { Generate } from './generate/command';
import type { ApplyUi, FlowUi, Origin } from './generate/flow';
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
    run(preset?: unknown, ui?: FlowUi): Promise<void>;
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
  const generate = new Generate(deps);
  generate.register(context);

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
  return {
    clients: cs,
    docs,
    routes: { fetch: root => fetchRoutes(deps, root), fetchCli: (root, e) => fetchCli(deps, root, e) },
    tests,
    health,
    generate: { run: (p, ui) => generate.run(p, ui), apply: (o, id, s, ui) => generate.apply(o, id, s, ui), diagnostics: generate.diagnostics },
  };
}

export async function deactivate(): Promise<void> {
  await clients?.stopAll();
}
