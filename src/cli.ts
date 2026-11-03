import { spawn } from 'node:child_process';

// cli runs `alder <args>` and reads what it prints: the JSONL (or single object) of a --json
// command, the exit code, and stderr. It names nothing of VS Code, so another front end can use it.

export type JsonObject = Record<string, unknown>;

export interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  objects: JsonObject[];
  json: JsonObject | undefined;
  // cancelled: the run was aborted through its signal
  cancelled: boolean;
}

export interface RunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

// decode returns every JSON object printed one per line on stdout (JSONL, or one object).
export function decode(stdout: string): JsonObject[] {
  const out: JsonObject[] = [];
  for (const line of stdout.split('\n')) {
    if (!/^\s*\{/.test(line)) continue;
    try {
      const v: unknown = JSON.parse(line);
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v as JsonObject);
    } catch {
      // not JSON: a line of text between the objects
    }
  }
  return out;
}

// run starts bin with args and resolves when it exits; it never rejects. An abort through
// o.signal sends SIGTERM and marks the result cancelled. A binary that cannot start resolves
// with code null and the spawn error in stderr.
export function run(bin: string, args: string[], o: RunOptions): Promise<CliResult> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cancelled = () => o.signal?.aborted ?? false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      // let go of pipes an orphaned grandchild may still hold
      child.stdout.destroy();
      child.stderr.destroy();
      o.signal?.removeEventListener('abort', onAbort);
      const objects = decode(stdout);
      resolve({ code, signal, stdout, stderr, objects, json: objects[0], cancelled: cancelled() });
    };
    const child = spawn(bin, args, { cwd: o.cwd, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    function onAbort() { child.kill('SIGTERM'); }
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    child.on('error', err => {
      stderr += err.message;
      finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));
    // an aborted alder may leave a child holding its pipes open, so close never comes: the
    // cancelled run's output is discarded anyway, settle on exit
    child.on('exit', (code, signal) => { if (cancelled()) finish(code, signal); });
    if (o.signal?.aborted) onAbort();
    else o.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export type Report = { kind: 'error'; message: string } | { kind: 'bug' };

// reportOf says how to show a failed run without rewording it: a JSON `error` as is; a usage
// or internal failure (exit 2) as a bug report (unless o.bugOn2 is false); anything else as its
// stderr, else its stdout, else `alder <command> exited <code>`.
export function reportOf(args: string[], res: CliResult, o: { bugOn2?: boolean } = {}): Report {
  const err = res.json?.error;
  if (typeof err === 'string') return { kind: 'error', message: err };
  if (res.code === 2 && o.bugOn2 !== false) return { kind: 'bug' };
  const text = (res.stderr.trim() !== '' ? res.stderr : res.stdout).trim();
  return { kind: 'error', message: text !== '' ? text : `alder ${args[0]} exited ${res.code}` };
}

// bugText is the bug report document: the command, its output and `alder version`.
export function bugText(args: string[], res: CliResult, version: string): string {
  const output = (res.stderr.trim() !== '' ? res.stderr : res.stdout).trim();
  return [
    'This may be a compiler bug; `alder version` and the command are in this document.',
    '',
    `$ alder ${args.join(' ')}`,
    '',
    output,
    '',
    '$ alder version',
    version.trim(),
    '',
  ].join('\n');
}

// shellQuote quotes s for a POSIX shell when it holds anything but plain path characters.
export function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
