import * as os from 'node:os';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import {
  CloseAction, ErrorAction, ExecuteCommandRequest, LanguageClient, LanguageClientOptions, ServerOptions, State,
} from 'vscode-languageclient/node';
import { findRoot, realRoot } from './root';
import { checkBinary, Gate, MISSING_SCRATCH, MISSING_TOKENS, RootStatus } from './health';
import { commandUri, selectorPatterns, serverEnv } from './clientConfig';
import { ScratchStore, ScratchParams } from './scratch';

// stopping marks a stop the extension asked for, which errorHandler.closed must not treat as a crash.
// starting settles to whether the client started.
interface Entry { root: string; real: string; client: LanguageClient; starting: Promise<boolean>; stopping: boolean }

// AlderClient keeps the library's forced notifications out of a first start: the extension
// reports a failed start itself, once (see Clients.create). They still reach the output channel.
class AlderClient extends LanguageClient {
  quiet = true;
  override error(message: string, data?: unknown, showNotification: boolean | 'force' = true): void {
    super.error(message, data, this.quiet ? false : showNotification);
  }
}

// Clients is one LanguageClient per app root, as alder.nvim has one client per root. Roots are
// compared by real path; the selector covers the path the documents use and the real one.
export class Clients {
  readonly scratch = new ScratchStore();
  private byReal = new Map<string, Entry>();
  private gate: Gate | undefined;
  private gateReported = false;
  private warned = new Set<string>();
  // failed holds the real roots whose client failed to start; they are not retried until restart()
  private failed = new Set<string>();

  constructor(private readonly output: vscode.LogOutputChannel) {}

  async checkGate(): Promise<Gate> {
    if (!this.gate) {
      const setting = vscode.workspace.getConfiguration('alder').get<string>('path', 'alder');
      this.gate = await checkBinary(setting, process.env, os.homedir());
    }
    return this.gate;
  }

  // ensure starts (or reuses) the client of the document's root; undefined when the document
  // is not an alder file under an app root, the binary failed the gate, or the root's client
  // failed to start (reported once; retried only by restart()).
  async ensure(doc: vscode.TextDocument): Promise<LanguageClient | undefined> {
    if (doc.languageId !== 'alder' || doc.uri.scheme !== 'file') return undefined;
    const root = await findRoot(doc.uri.fsPath);
    if (!root) return undefined;
    const real = await realRoot(root);
    if (this.failed.has(real)) return undefined;
    const gate = await this.checkGate();
    // no await between the lookup and the set: two documents opening at once share one client
    const have = this.byReal.get(real);
    if (have) {
      return (await have.starting) ? have.client : undefined;
    }
    if (!gate.ok || !gate.path) {
      this.reportGate(gate);
      return undefined;
    }
    const entry = this.create(root, real, gate.path);
    this.byReal.set(real, entry);
    return (await entry.starting) ? entry.client : undefined;
  }

  private reportGate(gate: Gate): void {
    if (this.gateReported) return;
    this.gateReported = true;
    void vscode.window.showErrorMessage(gate.problem ?? 'alder: the binary failed its check', 'Open Settings').then(pick => {
      if (pick) void vscode.commands.executeCommand('workbench.action.openSettings', 'alder.path');
    });
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    void vscode.window.showWarningMessage(message);
  }

  private create(root: string, real: string, alderPath: string): Entry {
    const config = vscode.workspace.getConfiguration('alder');
    const serverOptions: ServerOptions = {
      command: alderPath,
      args: ['lsp'],
      options: { cwd: real, env: serverEnv(process.env, config.get('serverEnv')) },
    };
    let closes = 0;
    let started = false;
    const clientOptions: LanguageClientOptions = {
      documentSelector: selectorPatterns([root, real]).map(pattern => ({ scheme: 'file', language: 'alder', pattern })),
      workspaceFolder: { uri: vscode.Uri.file(real), name: basename(real), index: 0 },
      outputChannel: this.output,
      // a failed initialize is reported by the start failure below, not by the library
      initializationFailedHandler: () => false,
      errorHandler: {
        error: err => {
          this.output.error(`alder lsp for ${real}: connection error: ${err.message}`);
          return { action: ErrorAction.Continue, handled: true };
        },
        closed: () => {
          // e is declared below; closed only runs once start() has been called
          // a close during the first start is that start failing: no restart, reported below
          if (e.stopping || !started) return { action: CloseAction.DoNotRestart, handled: true };
          closes++;
          this.warnOnce(`closed:${real}:${closes > 1 ? 'final' : 'first'}`, 'alder lsp stopped — Alder: Show Health');
          return { action: closes === 1 ? CloseAction.Restart : CloseAction.DoNotRestart, handled: true };
        },
      },
    };
    const client = new AlderClient('alder', `Alder (${basename(real)})`, serverOptions, clientOptions);
    // The extension registers the server's commands once for all clients (see SERVER_COMMANDS).
    const exec = client.getFeature(ExecuteCommandRequest.method) as unknown as { initialize: (c: unknown) => void };
    exec.initialize = () => {};
    client.onNotification('alder/scratch', (p: ScratchParams) => this.scratch.record(p));
    const e: Entry = { root, real, client, starting: Promise.resolve(false), stopping: false };
    e.starting = client.start().then(() => {
      started = true;
      client.quiet = false;
      const caps = client.initializeResult?.capabilities;
      if (!caps?.semanticTokensProvider) this.warnOnce('tokens', `alder: ${MISSING_TOKENS}`);
      if (!(caps?.experimental as { alderScratch?: boolean } | undefined)?.alderScratch) this.warnOnce('scratch', `alder: ${MISSING_SCRATCH}`);
      return true;
    }, err => {
      client.quiet = false;
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`alder lsp for ${real} failed to start: ${message}`);
      // forget the dead client and mark the root failed: no retry, and no further notification,
      // until Alder: Restart Server
      if (this.byReal.get(real) === e) this.byReal.delete(real);
      if (!e.stopping && !this.failed.has(real)) {
        this.failed.add(real);
        void vscode.window.showErrorMessage(`alder lsp for ${real} failed to start: ${message} — Alder: Show Health`);
      }
      return false;
    });
    return e;
  }

  async forUri(uri: vscode.Uri | string): Promise<LanguageClient | undefined> {
    const u = typeof uri === 'string' ? vscode.Uri.parse(uri) : uri;
    const root = await findRoot(u.fsPath);
    if (!root) return undefined;
    return this.byReal.get(await realRoot(root))?.client;
  }

  // execute sends a server command to the server of the document it names; a command that
  // names no document goes to the active editor's server, else the only one running.
  async execute(command: string, args: unknown[]): Promise<unknown> {
    const named = commandUri(args);
    let client: LanguageClient | undefined;
    if (named !== undefined) {
      client = await this.forUri(named);
    } else {
      const active = vscode.window.activeTextEditor?.document.uri;
      client = active ? await this.forUri(active) : undefined;
      if (!client && this.byReal.size === 1) client = [...this.byReal.values()][0].client;
    }
    if (!client) {
      void vscode.window.showErrorMessage('alder: no alder lsp running for this file');
      return undefined;
    }
    try {
      return await client.sendRequest(ExecuteCommandRequest.type, { command, arguments: args });
    } catch (err) {
      void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  roots(): string[] {
    return [...this.byReal.keys()];
  }

  statuses(): RootStatus[] {
    return [...this.byReal.values()].map(e => {
      const caps = e.client.initializeResult?.capabilities;
      return {
        root: e.real,
        running: e.client.state === State.Running,
        tokens: !!caps?.semanticTokensProvider,
        scratch: !!(caps?.experimental as { alderScratch?: boolean } | undefined)?.alderScratch,
      };
    });
  }

  async stopAll(): Promise<void> {
    const entries = [...this.byReal.values()];
    this.byReal.clear();
    for (const e of entries) e.stopping = true;
    // a client still starting cannot shut down (v11 stop() throws unless Running), and would
    // be orphaned and restarted; wait for its start to settle first
    await Promise.all(entries.map(async e => {
      await e.starting;
      await e.client.stop().catch(() => undefined);
    }));
  }

  // restart forgets the gate and the warnings, stops every client, and starts one per root
  // of the open alder documents.
  async restart(): Promise<void> {
    await this.stopAll();
    this.gate = undefined;
    this.gateReported = false;
    this.warned.clear();
    this.failed.clear();
    this.scratch.clear();
    for (const doc of vscode.workspace.textDocuments) await this.ensure(doc);
  }
}
