// explainAt picks the diagnostic code a cursor is on, the port of check.lua's under_cursor:
// the alder diagnostic whose range holds the position (its end included, so a cursor just after
// the word still counts), else the first alder diagnostic with a code on the cursor's line.

export interface Pos { line: number; character: number }

export interface DiagLike {
  source?: string;
  code?: string | number | { value: string | number };
  range: { start: Pos; end: Pos };
}

export function codeOf(d: DiagLike): string | undefined {
  const c = d.code;
  if (c === undefined || c === null) return undefined;
  if (typeof c === 'object') return String(c.value);
  return String(c);
}

function cmp(a: Pos, b: Pos): number {
  return a.line !== b.line ? a.line - b.line : a.character - b.character;
}

export function codeAt(diags: readonly DiagLike[], pos: Pos): string | undefined {
  let onLine: string | undefined;
  for (const d of diags) {
    const code = codeOf(d);
    if (d.source !== 'alder' || code === undefined) continue;
    if (cmp(d.range.start, pos) <= 0 && cmp(pos, d.range.end) <= 0) return code;
    if (onLine === undefined && d.range.start.line <= pos.line && pos.line <= d.range.end.line) onLine = code;
  }
  return onLine;
}
