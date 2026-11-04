// The send side of scratch files, ported from alder.nvim's scratch.lua: no vscode import.

export const SCRATCH_FILE = 'scratch.alder';

// TEMPLATE is the text of a new scratch.alder (internal/scaffold/files/scratch.alder in alder).
export const TEMPLATE = [
  '-- A scratch file: each `> expr` line is evaluated. Run `alder scratch --watch` to see results on save.',
  '-- Everything else is ordinary Alder: define values and helpers here, then watch them.',
  '-- Put `in Module` on the first line to work inside an app module, with its names unqualified.',
  '',
  '> 1 + 1',
  '',
].join('\n');

// isScratchPath is whether path names a scratch file (syntax.IsScratchName): its base name ends
// in scratch.alder.
export function isScratchPath(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? '';
  return base.endsWith(SCRATCH_FILE);
}

const DEFINITION_KEYWORDS = ['type', 'alias', 'import', 'page', 'msg', 'form', 'table', 'capability', 'fake', 'session', 'login', 'test'];
const EXPRESSION_KEYWORDS = new Set(['let', 'if', 'case']);

// isDefinition says whether a line starts a definition rather than an expression: it begins with
// a declaration keyword and the start of its head (`type Model`, `page "/x"`, `session {`), or is
// a signature (`name :`), or is a binding (`f x =`, not `==`/`<=`).
export function isDefinition(line: string): boolean {
  line = line.replace(/^\s+/, '');
  for (const kw of DEFINITION_KEYWORDS) {
    if (new RegExp(`^${kw}\\s+[A-Z"{]`).test(line)) return true;
  }
  if (/^[A-Za-z_][A-Za-z0-9_']*\s*:/.test(line)) return true;
  const word = /^[a-z_][A-Za-z0-9_']*/.exec(line)?.[0];
  if (!word || EXPRESSION_KEYWORDS.has(word)) return false;
  const eq = line.indexOf('=');
  if (eq < 0 || line[eq + 1] === '=') return false;
  return /^[A-Za-z0-9_'\s(),{}:]*$/.test(line.slice(0, eq));
}

const blank = (l: string) => !/\S/.test(l);

// scratchInsert is the text to add at the end of a scratch document whose text is text, to send
// lines to it; undefined when they are all blank. A definition, or lines that already hold
// watches (raw), go in as written; an expression becomes a `> ` watch with its other lines
// indented four spaces. Leading `--` comments go in as written either way. One blank line
// separates it from what is there, unless the file already ends in one.
export function scratchInsert(text: string, lines: string[], raw: boolean): string | undefined {
  let indent: number | undefined;
  for (const l of lines) {
    if (blank(l)) continue;
    const n = /^\s*/.exec(l)![0].length;
    indent = indent === undefined ? n : Math.min(indent, n);
  }
  const out = lines.map(l => (raw ? l : l.slice(indent ?? 0)));
  while (out.length > 0 && blank(out[0])) out.shift();
  while (out.length > 0 && blank(out[out.length - 1])) out.pop();
  if (out.length === 0) return undefined;
  const add: string[] = [];
  if (raw) {
    add.push(...out);
  } else {
    let first = 0;
    while (first < out.length && (out[first].startsWith('--') || blank(out[first]))) add.push(out[first++]);
    if (first < out.length && isDefinition(out[first])) {
      add.push(...out.slice(first));
    } else if (first < out.length) {
      add.push('> ' + out[first]);
      for (const l of out.slice(first + 1)) add.push(l === '' ? '' : '    ' + l);
    }
  }
  const t = text.replace(/\r\n/g, '\n');
  const ended = t === '' || t.endsWith('\n');
  const existing = t === '' ? [] : (ended ? t.slice(0, -1) : t).split('\n');
  const lastBlank = existing.length > 0 && existing[existing.length - 1] === '';
  const sep = existing.length === 0 || lastBlank ? '' : '\n';
  return (ended ? '' : '\n') + sep + add.join('\n') + '\n';
}

// lineSpan is the first and last line of a selection (0-based); a last line selected only up
// to its column 0 is not part of it.
export function lineSpan(start: { line: number; character: number }, end: { line: number; character: number }): [number, number] {
  const last = end.line > start.line && end.character === 0 ? end.line - 1 : end.line;
  return [start.line, last];
}

// moduleName is the name on the first `module` line (buf.lua's fallback; there is no tree-sitter
// here).
export function moduleName(text: string): string | undefined {
  return /^module\s+([A-Za-z0-9_.]+)/m.exec(text)?.[1];
}

// headerModule is the module named by a scratch file's `in` header (its first line of code).
export function headerModule(text: string): string | undefined {
  for (const l of text.split(/\r?\n/)) {
    if (blank(l) || /^\s*--/.test(l)) continue;
    return /^in\s+([A-Za-z0-9_.]+)\s*$/.exec(l)?.[1];
  }
  return undefined;
}

// inHeaderWarning is the warning for sending from module to a scratch file that is not `in` it.
export function inHeaderWarning(module: string | undefined, scratchText: string): string | undefined {
  if (!module || headerModule(scratchText) === module) return undefined;
  return `alder: scratch.alder is not "in ${module}"; names from ${module} need qualifying (add "in ${module}" as its first line)`;
}
