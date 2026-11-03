import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from './cli';

// routeItems turns the routes the server (alder/routes) or the CLI (`alder routes --json`)
// lists into one shape: an absolute file and a 0-based position (routes.lua's normalize_*).

export interface Route {
  kind: string;
  path: string;
  module: string;
  name: string;
  file: string;
  line: number;
  character: number;
}

export interface LspRoute {
  kind: string;
  path: string;
  module: string;
  name: string;
  uri: string;
  range?: { start: { line: number; character: number } };
}

export function normalizeLsp(result: readonly LspRoute[] | null | undefined): Route[] {
  return (result ?? []).map(r => ({
    kind: r.kind, path: r.path, module: r.module, name: r.name,
    file: fileURLToPath(r.uri),
    line: r.range?.start.line ?? 0,
    character: r.range?.start.character ?? 0,
  }));
}

interface CliRoute { kind: string; path: string; module: string; name: string; file?: string; line?: number; col?: number }

// normalizeCli reads `alder routes --json`: a JSON array (or {routes: […]}, or one object)
// decoded whole, else JSONL. Its file is root-relative and its line and col 1-based.
export function normalizeCli(stdout: string, root: string): Route[] {
  let objects: CliRoute[];
  try {
    const v: unknown = JSON.parse(stdout);
    if (Array.isArray(v)) objects = v as CliRoute[];
    else if (v && typeof v === 'object' && Array.isArray((v as { routes?: unknown }).routes)) objects = (v as { routes: CliRoute[] }).routes;
    else if (v && typeof v === 'object') objects = [v as CliRoute];
    else objects = [];
  } catch {
    objects = decode(stdout) as unknown as CliRoute[];
  }
  return objects.map(r => {
    const file = r.file ?? '';
    return {
      kind: r.kind, path: r.path, module: r.module, name: r.name,
      file: isAbsolute(file) ? file : join(root, file),
      line: Math.max((r.line ?? 1) - 1, 0),
      character: Math.max((r.col ?? 1) - 1, 0),
    };
  });
}

export function verb(r: Pick<Route, 'kind'>): 'GET' | 'POST' {
  return r.kind === 'msg' ? 'POST' : 'GET';
}

// pickItem is a route's QuickPick row: `GET /path`, then `Module.name`.
export function pickItem(r: Route): { label: string; description: string } {
  return { label: `${verb(r)} ${r.path}`, description: `${r.module}.${r.name}` };
}
