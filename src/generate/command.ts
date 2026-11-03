import * as vscode from 'vscode';
import { State } from 'vscode-languageclient/node';
import type { Deps } from '../deps';
import { applyGenerator } from './apply';
import { ApplyUi, asPreset, Flow, FlowUi, Origin, Server } from './flow';
import { findOrigin } from './origin';
import { PreviewDoc } from './previewDoc';
import type { ReviewFile } from './review';
import type { Sets } from './types';
import { quickInputUi } from './ui';

// Generate owns alder.generate (the flow; a code action's argument presets it) and
// alder.generate.apply (Ctrl+Enter in the form). One flow at a time: a new one closes the old.
export class Generate {
  readonly diagnostics = vscode.languages.createDiagnosticCollection('alder generate');
  private active: Flow | undefined;
  private count = 0;

  constructor(private readonly deps: Deps) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this.diagnostics,
      vscode.commands.registerCommand('alder.generate', (preset?: unknown, ui?: FlowUi) =>
        this.run(preset, ui && typeof ui.form === 'function' ? ui : undefined)),
      vscode.commands.registerCommand('alder.generate.apply', () => this.active?.answer({ kind: 'apply' })),
    );
  }

  private server(origin: Origin): Promise<Server | undefined> {
    return this.deps.clients.forUri(origin.uri).then(client => client && {
      request: <T>(m: string, p: unknown) => client.sendRequest<T>(m, p),
      running: () => client.state === State.Running,
    });
  }

  async apply(origin: Origin, id: string, s: Sets, ui: ApplyUi): Promise<boolean> {
    const server = await this.server(origin);
    if (!server) {
      ui.error('alder: no alder lsp running for this file');
      return false;
    }
    return applyGenerator({ server, root: origin.root, ui, diagnostics: this.diagnostics }, origin, id, s);
  }

  private showPlanFile(n: number, f: ReviewFile): void {
    const before = this.deps.docs.set(`plan/${n}/before/${f.path}`, f.before);
    const after = this.deps.docs.set(`plan/${n}/after/${f.path}`, f.after);
    void vscode.commands.executeCommand('vscode.diff', before, after, `${f.path} (plan)`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: true });
  }

  async run(arg?: unknown, ui: FlowUi = quickInputUi()): Promise<void> {
    this.active?.close();
    const found = await findOrigin(this.deps.clients);
    if (!found) return;
    const n = ++this.count;
    const { origin, client } = found;
    const server: Server = { request: (m, p) => client.sendRequest(m, p), running: () => client.state === State.Running };
    const flow = new Flow({
      server,
      ui,
      preview: new PreviewDoc(this.deps.docs, n),
      apply: (id, s) => applyGenerator({ server, root: origin.root, ui, diagnostics: this.diagnostics }, origin, id, s),
      showPlanFile: f => this.showPlanFile(n, f),
    }, origin);
    this.active = flow;
    try {
      await flow.start(asPreset(arg));
      await flow.done;
    } finally {
      if (this.active === flow) this.active = undefined;
    }
  }
}
