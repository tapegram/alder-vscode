import * as vscode from 'vscode';
import { State, type LanguageClient } from 'vscode-languageclient/node';
import { run } from './cli';
import { cliEnv, Deps } from './deps';
import { requireRoot } from './project';
import { findRoot } from './root';
import {
  checkEditReply, editParams, isOldServer, normalizeCli, searchCliError, searchLabel, toItem, OLD_ALDER,
  type SearchItem, type SearchReply, type SearchResult,
} from './searchItems';

// search is Alder: Search: a quick pick over the server's alder/search, the server's results in
// its order (the quick pick's own matching is off: a type query matches no label). Enter writes
// the result with the server's alder/searchEdit, or inserts its label with no server; the item
// button opens an app result's declaration.

export const DEBOUNCE_MS = 80;
export const HINT = 'Search by name or type — e.g. split, Text., Text -> Int, : List Text';
const TITLE = 'Alder: Search';

export interface SearchSession {
  onChange(fn: (q: string) => void): void;
  setItems(items: SearchItem[], note: string): void;
  setBusy(b: boolean): void;
  picked(): Promise<{ item: SearchItem; button?: 'definition' } | undefined>;
}

// SearchUi is the picker; a test passes its own to drive it.
export interface SearchUi { open(init: { value: string; placeholder: string; items: SearchItem[] }): SearchSession }

// SearchHooks: a test's picker and debounce, used when the command is given no picker
export interface SearchHooks { ui?: SearchUi; debounceMs?: number }

export interface WirePosition { line: number; character: number }
export interface SearchAt { uri: string; position: WirePosition }

const definitionButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('go-to-file'), tooltip: 'Go to definition' };

// quickPickUi is the default picker. It never sets alder.formOpen: ctrl+enter stays the
// generator's only.
export const quickPickUi: SearchUi = {
  open(init) {
    const qp = vscode.window.createQuickPick<SearchItem>();
    qp.title = TITLE;
    qp.placeholder = init.placeholder;
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;
    qp.ignoreFocusOut = true;
    qp.value = init.value;
    qp.items = init.items;
    // VS Code sorts by its own match unless told not to (1.94+; ignored before, alwaysShow keeps every item)
    (qp as unknown as { sortByLabel: boolean }).sortByLabel = false;
    let last = init.value;
    let change: ((q: string) => void) | undefined;
    qp.onDidChangeValue(v => {
      if (v === last) return;
      last = v;
      change?.(v);
    });
    const picked = new Promise<{ item: SearchItem; button?: 'definition' } | undefined>(resolve => {
      let done = false;
      const finish = (v: { item: SearchItem; button?: 'definition' } | undefined) => {
        if (done) return;
        done = true;
        qp.dispose();
        resolve(v);
      };
      qp.onDidAccept(() => {
        const item = qp.activeItems[0];
        if (item) finish({ item });
      });
      qp.onDidTriggerItemButton(e => finish({ item: e.item, button: 'definition' }));
      qp.onDidHide(() => finish(undefined));
    });
    qp.show();
    return {
      onChange: fn => { change = fn; },
      setItems: (items, note) => {
        qp.title = note === '' ? TITLE : `${TITLE} — ${note}`;
        qp.items = items;
      },
      setBusy: b => { qp.busy = b; },
      picked: () => picked,
    };
  },
};

function message(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') return (err as { message: string }).message;
  return String(err);
}

// a reply as the picker shows it: from the server or the CLI (Enter then inserts the label)
interface Answer { query: string; results: SearchResult[]; note: string; server: boolean }

// isAt is the code action's argument: { uri, position }
function isAt(v: unknown): v is SearchAt {
  const a = v as { uri?: unknown; position?: { line?: unknown; character?: unknown } } | null;
  return !!a && typeof a === 'object' && typeof a.uri === 'string' && !!a.position
    && typeof a.position.line === 'number' && typeof a.position.character === 'number';
}

function isUi(v: unknown): v is SearchUi {
  return !!v && typeof v === 'object' && typeof (v as { open?: unknown }).open === 'function';
}

// searchArgs reads alder.search's argument: a test's picker or the code action's { uri, position }
export function searchArgs(arg: unknown): { ui?: SearchUi; at?: SearchAt } {
  if (isUi(arg)) return { ui: arg };
  if (isAt(arg)) return { at: arg };
  return {};
}

export async function searchCommand(deps: Deps, ui: SearchUi = quickPickUi, at?: SearchAt, opts: { debounceMs?: number } = {}): Promise<void> {
  const root = at ? await findRoot(vscode.Uri.parse(at.uri).fsPath) : await requireRoot(deps.clients);
  if (!root) {
    if (at) void vscode.window.showErrorMessage('alder: no app here');
    return;
  }
  const found = await deps.clients.forUri(vscode.Uri.file(root));
  const client = found && found.state === State.Running ? found : undefined;

  // the document the picker writes to, and the position it was opened at
  const editor = vscode.window.activeTextEditor;
  let doc: { uri: string; position: WirePosition; open: boolean } | undefined;
  if (at) {
    doc = { uri: at.uri, position: at.position, open: true };
  } else if (client && editor && editor.document.languageId === 'alder' && editor.document.uri.scheme === 'file'
    && (await deps.clients.forUri(editor.document.uri)) === client) {
    // the client negotiates UTF-16, VS Code's own columns
    const { line, character } = editor.selection.active;
    doc = { uri: editor.document.uri.toString(), position: { line, character }, open: editor.selection.isEmpty };
  }

  const ask = async (query: string, withPosition: boolean): Promise<Answer> => {
    let lspError: unknown;
    if (client) {
      try {
        const params = {
          query,
          ...(doc ? { uri: doc.uri } : {}),
          ...(doc && withPosition && doc.open ? { position: doc.position } : {}),
        };
        const r = await client.sendRequest<SearchReply>('alder/search', params);
        return { query: r.query ?? query, results: r.results ?? [], note: r.note ?? '', server: true };
      } catch (err) {
        lspError = err;
      }
    }
    return askCli(deps, root, query, lspError);
  };

  const first = await ask('', true);
  const session = ui.open({ value: first.query, placeholder: HINT, items: first.results.map(r => toItem(r, definitionButton)) });
  let shown = first;
  let seq = 0;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  const fetch = async (n: number, q: string) => {
    session.setBusy(true);
    const got = await ask(q, false);
    if (closed || n !== seq) return;
    shown = got;
    session.setItems(got.results.map(r => toItem(r, definitionButton)), got.note);
    session.setBusy(false);
  };
  session.onChange(q => {
    const n = ++seq;
    if (timer) clearTimeout(timer);
    timer = undefined;
    const ms = opts.debounceMs ?? DEBOUNCE_MS;
    if (ms <= 0) void fetch(n, q);
    else timer = setTimeout(() => void fetch(n, q), ms);
  });
  if (first.note !== '') session.setItems(first.results.map(r => toItem(r, definitionButton)), first.note);

  const picked = await session.picked();
  closed = true;
  if (timer) clearTimeout(timer);
  if (!picked) return;
  const r = picked.item.result;
  if (picked.button === 'definition') {
    await jump(r);
    return;
  }
  // the list's source decides: a server answer is written by the server, a CLI one is the label
  if (client && doc && shown.server) {
    await writeWithServer(client, doc, r);
    return;
  }
  await insertLabel(r);
}

// askCli runs `alder search --json <query>` from the root. lspError is the server's error when
// it was asked first.
async function askCli(deps: Deps, root: string, query: string, lspError?: unknown): Promise<Answer> {
  const none = (note: string): Answer => ({ query, results: [], note, server: false });
  const bin = await deps.clients.binary();
  if (!bin) return none('the alder binary failed its check — Alder: Show Health');
  const res = await run(bin, ['search', '--json', query], { cwd: root, env: cliEnv() });
  if (res.code !== 0) {
    const e = searchCliError(res, lspError === undefined ? undefined : message(lspError));
    if ('note' in e) return none(e.note);
    return none(isOldServer(lspError) ? OLD_ALDER : e.error);
  }
  try {
    const r = normalizeCli(res.stdout, root);
    return { query: r.query || query, results: r.results, note: r.note, server: false };
  } catch (err) {
    return none(`alder search: ${message(err)}`);
  }
}

// writeWithServer applies the server's edit for the result at the open position and puts the
// caret where the server says.
async function writeWithServer(client: LanguageClient, doc: { uri: string; position: WirePosition }, r: SearchResult): Promise<void> {
  let reply: unknown;
  try {
    reply = await client.sendRequest('alder/searchEdit', editParams(doc.uri, doc.position, r));
  } catch (err) {
    void vscode.window.showErrorMessage(`alder search: ${isOldServer(err) ? OLD_ALDER : message(err)}`);
    return;
  }
  const got = checkEditReply(reply);
  if ('error' in got) {
    void vscode.window.showErrorMessage(`alder search: ${got.error}`);
    return;
  }
  const edit = await client.protocol2CodeConverter.asWorkspaceEdit(got.edit as Parameters<typeof client.protocol2CodeConverter.asWorkspaceEdit>[0]);
  if (!edit || !(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showErrorMessage('alder search: the edit did not apply');
    return;
  }
  const ed = await vscode.window.showTextDocument(vscode.Uri.parse(doc.uri));
  const c = client.protocol2CodeConverter.asPosition(got.cursor);
  ed.selection = new vscode.Selection(c, c);
  ed.revealRange(new vscode.Range(c, c));
}

// insertLabel puts the result's label at the caret of the active editor (a selection is kept as
// text, not replaced) and the caret after it.
async function insertLabel(r: SearchResult): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  const label = searchLabel(r);
  if (!ed) {
    void vscode.window.showInformationMessage(`alder: no editor to insert ${label} into`);
    return;
  }
  const p = ed.selection.active;
  if (!(await ed.edit(b => b.insert(p, label)))) return;
  const after = ed.document.positionAt(ed.document.offsetAt(p) + label.length);
  ed.selection = new vscode.Selection(after, after);
}

// jump opens the result's declaration: the server's uri and range, else the CLI's 1-based file,
// line and col. A stdlib result has neither.
async function jump(r: SearchResult): Promise<void> {
  let uri: vscode.Uri;
  let p: vscode.Position;
  if (r.uri !== undefined && r.range) {
    uri = vscode.Uri.parse(r.uri);
    p = new vscode.Position(r.range.start.line, r.range.start.character);
  } else if (r.file !== undefined) {
    uri = vscode.Uri.file(r.file);
    p = new vscode.Position(Math.max(0, (r.line ?? 1) - 1), Math.max(0, (r.col ?? 1) - 1));
  } else {
    void vscode.window.showInformationMessage('alder: the standard library has no source to open');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { selection: new vscode.Range(p, p) });
}
