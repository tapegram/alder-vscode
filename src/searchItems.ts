import { isAbsolute, join } from 'node:path';
import type { QuickPickItem, QuickInputButton, Range, ThemeIcon } from 'vscode';
import type { CliResult } from './cli';

// searchItems are the pure parts of the search quick pick: the result shape, its label and row,
// the `alder search --json` reader, and how old-alder failures are told apart. Type-only vscode
// imports, so it runs under plain node.

export interface SearchResult {
  name: string;
  module: string;
  kind: string;
  signature: string;
  doc: string;
  source: 'stdlib' | 'app';
  effect?: string;
  match?: string;
  args?: number;
  // the server gives uri and range; the CLI gives file (made absolute here), line and col (1-based)
  uri?: string;
  range?: Range;
  file?: string;
  line?: number;
  col?: number;
}

export interface SearchReply { query: string; mode: string; note: string; results: SearchResult[] }

export interface SearchItem extends QuickPickItem { result: SearchResult }

export const OLD_ALDER =
  'this alder has no search (update alder: go install ./cmd/alder in the alder repo, then Alder: Restart Server)';

// A plain object shaped like ThemeIcon('go-to-file'), for unit tests: the real class needs the
// vscode runtime, so search.ts passes its own button.
const GO_TO_DEFINITION: QuickInputButton = {
  iconPath: { id: 'go-to-file' } as ThemeIcon,
  tooltip: 'Go to definition',
};

export function searchLabel(r: Pick<SearchResult, 'module' | 'name'>): string {
  return r.module === 'Prelude' ? r.name : `${r.module}.${r.name}`;
}

export function toItem(r: SearchResult, button: QuickInputButton = GO_TO_DEFINITION): SearchItem {
  const first = r.doc.split('\n')[0].trim();
  return {
    label: searchLabel(r),
    description: r.signature,
    detail: first === '' ? undefined : first,
    alwaysShow: true,
    ...(r.uri !== undefined || r.file !== undefined ? { buttons: [button] } : {}),
    result: r,
  };
}

// normalizeCli reads `alder search --json`; file is root-relative there.
export function normalizeCli(stdout: string, root: string): SearchReply {
  const v = JSON.parse(stdout) as Partial<SearchReply>;
  const results = (v.results ?? []).map(r => (
    r.file === undefined ? r : { ...r, file: isAbsolute(r.file) ? r.file : join(root, r.file) }
  ));
  return { query: v.query ?? '', mode: v.mode ?? '', note: v.note ?? '', results };
}

// searchCliError reads a failed `alder search --json`: its own message (a query it cannot read,
// or its usage line) is a note; another command's usage or "unknown command" is an alder with
// no search; anything else is an error.
// _lspError is accepted for symmetry with routesCliError; the CLI result alone decides.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function searchCliError(res: CliResult, _lspError?: string): { note: string } | { error: string } {
  const err = res.stderr.trim();
  if (res.code === 2) {
    if (/^usage: alder search\b/.test(err)) return { note: err.split('\n')[0] };
    const m = /^alder search: (.*)$/m.exec(err);
    if (m) return { note: m[1] };
    if (/^usage: alder\b/.test(err) || /unknown command/i.test(err)) return { error: OLD_ALDER };
  }
  return { error: `alder search: ${err}` };
}

export function editParams(uri: string, position: { line: number; character: number }, r: SearchResult) {
  return {
    uri, position, module: r.module, name: r.name, kind: r.kind,
    ...(r.args !== undefined ? { args: r.args } : {}),
  };
}

export function isOldServer(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === -32601;
}

// checkEditReply: a reply without a cursor comes from a server that predates it.
export function checkEditReply(reply: unknown): { edit: unknown; cursor: { line: number; character: number } } | { error: string } {
  const r = reply as { edit?: unknown; cursor?: { line: number; character: number } } | null;
  if (r && typeof r === 'object' && r.edit !== undefined && r.cursor) return { edit: r.edit, cursor: r.cursor };
  return { error: OLD_ALDER };
}
