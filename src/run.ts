import { basename } from 'node:path';
import * as vscode from 'vscode';
import { shellQuote } from './cli';
import { Deps, settingEnv } from './deps';
import { requireRoot } from './project';
import { realRoot } from './root';

// AppTerminals is Alder: Run the App: `alder run` in a terminal at the project's root, one
// terminal per root, reused (shown again, not re-run) while it is open. It runs the binary the
// gate resolved, so a VS Code started from the Dock with a short PATH still finds it.
export class AppTerminals {
  private byReal = new Map<string, vscode.Terminal>();

  constructor(private readonly deps: Deps) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.window.onDidCloseTerminal(t => {
      for (const [k, v] of this.byReal) if (v === t) this.byReal.delete(k);
    }));
  }

  async run(): Promise<vscode.Terminal | undefined> {
    const root = await requireRoot(this.deps.clients);
    if (!root) return undefined;
    const bin = await this.deps.clients.binary();
    if (!bin) return undefined;
    const real = await realRoot(root);
    let t = this.byReal.get(real);
    if (!t || t.exitStatus !== undefined) {
      t = vscode.window.createTerminal({ name: `alder run (${basename(real)})`, cwd: real, env: settingEnv() });
      this.byReal.set(real, t);
      t.sendText(`${shellQuote(bin)} run`);
    }
    t.show();
    return t;
  }
}
