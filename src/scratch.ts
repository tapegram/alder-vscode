// The alder/scratch notification: the server's last run of a scratch file, and what the editor
// shows of it. The values themselves are the server's inlay hints; this is what hints cannot
// carry (the full value, a file-level error or note). No vscode import.

// ScratchWatch is internal/scratch's WatchResult.
export interface ScratchWatch {
  line: number;
  end?: number; // the watch's last line (line for a one-line watch)
  expr?: string;
  value?: string;
  type?: string;
  error?: string;
  note?: string;
  kind?: string;
  truncated?: boolean;
}

// ScratchParams are internal/lsp's scratchParams: "types" once the file has checked, then
// "values" when the run ends.
export interface ScratchParams {
  uri: string;
  version?: number;
  phase?: string;
  ran?: boolean;
  watches?: ScratchWatch[];
  error?: string;
  note?: string;
  warning?: string;
}

// ScratchEntry is a notification and the document's lines at its version, when the editor still
// had that version as it arrived (else none: no watch can be found until the next run).
export interface ScratchEntry {
  params: ScratchParams;
  lines?: string[];
}

export class ScratchStore {
  private byUri = new Map<string, ScratchEntry>();
  private listeners = new Set<(uri: string) => void>();

  record(p: ScratchParams, lines?: string[]): void {
    if (!p || typeof p.uri !== 'string') return;
    this.byUri.set(p.uri, { params: p, lines });
    this.fire(p.uri);
  }

  last(uri: string): ScratchParams | undefined {
    return this.byUri.get(uri)?.params;
  }

  entry(uri: string): ScratchEntry | undefined {
    return this.byUri.get(uri);
  }

  forget(uri: string): void {
    if (this.byUri.delete(uri)) this.fire(uri);
  }

  clear(): void {
    const uris = [...this.byUri.keys()];
    this.byUri.clear();
    for (const u of uris) this.fire(u);
  }

  // onChange calls f with the uri of each record, forget and clear; the result unsubscribes.
  onChange(f: (uri: string) => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private fire(uri: string): void {
    for (const f of this.listeners) f(uri);
  }
}

// docLines splits a document's text into lines, LF or CRLF.
export function docLines(text: string): string[] {
  return text.split(/\r?\n/);
}

// watchAt is the watch whose lines hold line (1-based) in a document whose lines are now, when
// those lines are as they were at the run (the rule of the server's inlay hints).
export function watchAt(e: ScratchEntry, now: string[], line: number): ScratchWatch | undefined {
  const then = e.lines;
  if (!then) return undefined;
  for (const w of e.params.watches ?? []) {
    const end = w.end ?? w.line;
    if (line < w.line || line > end || w.line < 1 || end > now.length || end > then.length) continue;
    let same = true;
    for (let i = w.line - 1; i < end; i++) if (now[i] !== then[i]) same = false;
    if (same) return w;
  }
  return undefined;
}

// watchText is a watch's full result: the error, else the value and the note, then `: Type`.
export function watchText(w: ScratchWatch): string {
  const parts = w.error ? [w.error] : [w.value, w.note].filter((s): s is string => !!s);
  if (w.type) parts.push(': ' + w.type);
  return parts.join('\n');
}

// MAX_HINT is the server's cap on an inlay hint's label, in code points (maxHint).
export const MAX_HINT = 120;

// fullHint is the server's hintLabel before its cap: what the inlay hint shows.
export function fullHint(w: ScratchWatch): string {
  const first = (s: string) => s.split('\n')[0];
  if (w.error) return '✗ ' + first(w.error);
  if (w.value) {
    let l = first(w.value);
    if (l !== w.value || w.truncated) l += ' …';
    return '⇒ ' + l + (w.type ? ' : ' + w.type : '');
  }
  if (w.type) return ': ' + w.type;
  return '';
}

// needsHover is whether the inlay hint leaves part of a watch out: a multi-line or cut value or
// error, a label over the cap, or a note (which hints never show).
export function needsHover(w: ScratchWatch): boolean {
  if (w.note || w.truncated) return true;
  if ((w.error || w.value || '').includes('\n')) return true;
  return [...fullHint(w)].length > MAX_HINT;
}

// FileLine is the file-level text on a scratch document's first line.
export interface FileLine {
  text: string;
  kind: 'error' | 'note';
  warning: boolean; // it is the warning: the caller records warnedAt = p.version
}

// fileLine is the first line of p's error, else its note, else its warning when no other run
// has shown it (warnedAt is the version of the run that first showed it, or undefined).
export function fileLine(p: ScratchParams, warnedAt: number | undefined): FileLine | undefined {
  const first = (s: string) => s.split('\n')[0];
  if (p.error) return { text: first(p.error), kind: 'error', warning: false };
  if (p.note) return { text: first(p.note), kind: 'note', warning: false };
  if (p.warning && (warnedAt === undefined || warnedAt === p.version)) return { text: first(p.warning), kind: 'note', warning: true };
  return undefined;
}
