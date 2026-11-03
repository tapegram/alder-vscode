import * as vscode from 'vscode';
import { State } from 'vscode-languageclient/node';
import { run } from './cli';
import { cliEnv, Deps } from './deps';
import { requireRoot } from './project';
import { normalizeCli, normalizeLsp, pickItem, LspRoute, Route } from './routeItems';

export type Fetched = { routes: Route[] } | { error: string };

export interface RouteItem extends vscode.QuickPickItem { route: Route }

// RouteUi is the picker; a test passes its own to answer it.
export interface RouteUi { pick(items: RouteItem[]): Promise<RouteItem | undefined> }

const quickPick: RouteUi = {
  pick: items => Promise.resolve(vscode.window.showQuickPick(items, {
    title: 'Alder: Routes', placeHolder: 'GET /path  Module.name', matchOnDescription: true,
  })),
};

export const UPDATE_ROUTES = (lspError: string) =>
  `this alder has no routes command (${lspError}): update alder (go install ./cmd/alder in the alder repo), then Alder: Restart Server`;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// fetchRoutes asks the root's server (alder/routes); with no running server, or an error from
// it (an alder older than alder/routes), it asks the CLI.
export async function fetchRoutes(deps: Deps, root: string): Promise<Fetched> {
  const client = await deps.clients.forUri(vscode.Uri.file(root));
  let lspError: string | undefined;
  if (client && client.state === State.Running) {
    try {
      return { routes: normalizeLsp(await client.sendRequest<LspRoute[] | null>('alder/routes', {})) };
    } catch (err) {
      lspError = message(err);
    }
  }
  return fetchCli(deps, root, lspError);
}

// fetchCli runs `alder routes --json` from the root. lspError is the server's error when it
// was asked first: if both fail, the server and the binary predate routes.
export async function fetchCli(deps: Deps, root: string, lspError?: string): Promise<Fetched> {
  const bin = await deps.clients.binary();
  if (!bin) return { error: 'the alder binary failed its check — Alder: Show Health' };
  const res = await run(bin, ['routes', '--json'], { cwd: root, env: cliEnv() });
  if (res.code !== 0) {
    if (lspError !== undefined) return { error: UPDATE_ROUTES(lspError) };
    const text = (res.stderr.trim() !== '' ? res.stderr : res.stdout).trim();
    return { error: text !== '' ? text : `alder routes exited ${res.code}` };
  }
  return { routes: normalizeCli(res.stdout, root) };
}

// jump opens the route's declaration with the cursor on it.
export async function jump(r: Route): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(r.file));
  const p = new vscode.Position(r.line, r.character);
  return vscode.window.showTextDocument(doc, { selection: new vscode.Range(p, p) });
}

// pickRoutes is Alder: Routes: the project's routes in a QuickPick, filtered on the path and the
// declaration; the chosen one is opened. Returns it.
export async function pickRoutes(deps: Deps, ui: RouteUi = quickPick): Promise<Route | undefined> {
  const root = await requireRoot(deps.clients);
  if (!root) return undefined;
  const got = await fetchRoutes(deps, root);
  if ('error' in got) {
    void vscode.window.showErrorMessage(`alder routes: ${got.error}`);
    return undefined;
  }
  if (got.routes.length === 0) {
    void vscode.window.showInformationMessage('alder: no routes');
    return undefined;
  }
  const picked = await ui.pick(got.routes.map(r => ({ ...pickItem(r), route: r })));
  if (!picked) return undefined;
  await jump(picked.route);
  return picked.route;
}
