import type { JsonObject } from './cli';

// testModel reads `alder test --json` and `alder test --mutate --json` (test.lua's pure half) and
// finds tests in source text by regex (buf.lua's fallback; the server has no test listing).

export const TEST_TITLE = 'alder test';
export const MUTATE_TITLE = 'alder test --mutate';

export type Mode = 'test' | 'mutate';

export function label(mode: Mode): string {
  return mode === 'mutate' ? MUTATE_TITLE : TEST_TITLE;
}

export interface TestResult {
  module: string;
  name: string;
  ok: boolean;
  file?: string;
  line?: number;
  col?: number;
  left?: string;
  right?: string;
  error?: string;
  note?: string;
  ms?: number;
}

export interface Mutant {
  module?: string;
  file?: string;
  decl?: string;
  line?: number;
  col?: number;
  kind?: string;
  before?: string;
  after?: string;
  killed?: boolean;
}

export interface Score { score: number; killed: number; survived: number }

export interface Discovered { module: string; tests: { name: string; line: number }[] }

const MODULE = /^module\s+([\w.]+)/m;
// a top-level `test "name" =`; the name is a string literal, escapes and all
const TEST = /^test\s+"((?:[^"\\]|\\.)*)"\s*=/;

export function moduleOf(text: string): string | undefined {
  return MODULE.exec(text)?.[1];
}

// discover is the module a file declares and its tests (0-based lines), or undefined when the
// text has no `module` line.
export function discover(text: string): Discovered | undefined {
  const module = moduleOf(text);
  if (!module) return undefined;
  const tests: Discovered['tests'] = [];
  text.split('\n').forEach((l, line) => {
    const m = TEST.exec(l);
    if (m) tests.push({ name: m[1], line });
  });
  return { module, tests };
}

// testAt is the name of the nearest test starting at or above line (0-based), or undefined.
export function testAt(text: string, line: number): string | undefined {
  const lines = text.split('\n');
  for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
    const m = TEST.exec(lines[i]);
    if (m) return m[1];
  }
  return undefined;
}

// runPattern is the -run regexp selecting one test (`^Module "name"$`) or, without a name,
// every test of the module (`^Module `: the space keeps Module.Sub out). Go regexp
// metacharacters in the name, backslash included, are escaped.
export function runPattern(module: string, name?: string): string {
  if (name === undefined) return `^${module} `;
  return `^${module} "${name.replace(/[\\^$()|.[\]*+?{}-]/g, '\\$&')}"$`;
}

const flat = (s: string) => s.replace(/\s*\n\s*/g, ' ');

// messageText is a failure's one line: its sides, else its error, else its note.
export function messageText(r: TestResult): string {
  if (r.left !== undefined || r.right !== undefined) return `left: ${flat(r.left ?? '')}  right: ${flat(r.right ?? '')}`;
  if (r.error !== undefined) return `error: ${flat(r.error)}`;
  if (r.note !== undefined) return `note: ${flat(r.note)}`;
  return 'failed';
}

export function summary(results: readonly TestResult[]): string {
  const passed = results.filter(r => r.ok).length;
  return `${passed} passed, ${results.length - passed} failed`;
}

// resultsOf are a run's test objects: those naming a module and a test.
export function resultsOf(objects: readonly JsonObject[]): TestResult[] {
  return objects.filter(o => typeof o.name === 'string' && typeof o.module === 'string') as unknown as TestResult[];
}

export function scoreOf(objects: readonly JsonObject[]): Score | undefined {
  const o = objects.find(o => o.score !== undefined && o.killed !== undefined && o.mutants === undefined);
  return o as unknown as Score | undefined;
}

export function survivors(objects: readonly JsonObject[]): Mutant[] {
  const out: Mutant[] = [];
  for (const o of objects) {
    if (Array.isArray(o.mutants)) for (const m of o.mutants as Mutant[]) if (!m.killed && m.file) out.push(m);
  }
  return out.sort((a, b) => (a.file! < b.file! ? -1 : a.file! > b.file! ? 1 : (a.line ?? 0) - (b.line ?? 0)));
}

export function survivorText(m: Mutant): string {
  return `survived  ${m.kind ?? '?'}: ${m.before ?? ''} → ${m.after ?? ''}`;
}

export function mutateTitle(s: Score): string {
  return `${MUTATE_TITLE} — ${s.killed ?? 0} killed, ${s.survived ?? 0} survived (${(s.score ?? 0).toFixed(2)})`;
}

// classify says what a finished run is: a compile failure (diagnostics instead of results), a
// failure to report as the CLI printed it, or results to show.
export function classify(res: { code: number | null; objects: readonly JsonObject[]; json: JsonObject | undefined }, mode: Mode): 'compile' | 'report' | 'ok' {
  if (Array.isArray(res.json?.diagnostics)) return 'compile';
  if (res.code === 2 || typeof res.json?.error === 'string') return 'report';
  if (mode === 'mutate') return scoreOf(res.objects) ? 'ok' : 'report';
  if (res.code !== 0 && resultsOf(res.objects).length === 0) return 'report';
  return 'ok';
}
