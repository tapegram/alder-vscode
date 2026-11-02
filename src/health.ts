import { execFile } from 'node:child_process';
import { promises as fs, constants } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

export const BUILD_HINT = 'build one from a checkout of tapegram/alder: go build -o ~/bin/alder ./cmd/alder';
export const MISSING_TOKENS = 'update alder for highlighting; the fallback grammar is in use';
export const MISSING_SCRATCH = 'update alder for scratch files';
const FILL_VARS = ['ANTHROPIC_API_KEY', 'ALDER_FILL_COMMAND', 'ALDER_FILL_MODEL'];

// candidates lists where the binary may be. VS Code opened from the Dock on macOS sees a
// shorter PATH than a shell, so the Go install directories and ~/bin follow PATH.
export function candidates(setting: string, env: NodeJS.ProcessEnv, home: string): string[] {
  if (isAbsolute(setting)) return [setting];
  if (setting.includes('/')) return [resolve(setting)];
  const dirs = (env.PATH ?? '').split(delimiter).filter(d => d !== '');
  if (env.GOBIN) dirs.push(env.GOBIN);
  const gopath = (env.GOPATH ?? '').split(delimiter)[0];
  if (gopath) dirs.push(join(gopath, 'bin'));
  dirs.push(join(home, 'go', 'bin'), join(home, 'bin'));
  return dirs.map(d => join(d, setting));
}

async function executable(p: string): Promise<boolean> {
  try {
    await fs.access(p, constants.X_OK);
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function resolveBinary(setting: string, env: NodeJS.ProcessEnv, home: string): Promise<string | undefined> {
  for (const p of candidates(setting, env, home)) if (await executable(p)) return p;
  return undefined;
}

// hasLsp: an old alder exits 0 and prints text for `help --json`; only a command tree that
// lists `lsp` counts.
export function hasLsp(stdout: string): boolean {
  try {
    const t = JSON.parse(stdout);
    return Array.isArray(t?.commands) && t.commands.some((c: { name?: unknown }) => c?.name === 'lsp');
  } catch {
    return false;
  }
}

function run(path: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise(res => {
    execFile(path, args, { timeout: 10_000, maxBuffer: 4 << 20 }, (err, stdout) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      res({ code, stdout: String(stdout ?? '') });
    });
  });
}

export interface Gate { path?: string; version?: string; ok: boolean; problem?: string }

export async function checkBinary(setting: string, env: NodeJS.ProcessEnv, home: string): Promise<Gate> {
  const path = await resolveBinary(setting, env, home);
  if (!path) {
    return { ok: false, problem: `alder: no \`${setting}\` binary found (alder.path, PATH, $GOBIN, $GOPATH/bin, ~/go/bin, ~/bin); ${BUILD_HINT}` };
  }
  const v = await run(path, ['version']);
  const version = v.code === 0 ? v.stdout.trim() || undefined : undefined;
  const help = await run(path, ['help', '--json']);
  if (help.code !== 0 || !hasLsp(help.stdout)) {
    return { path, version, ok: false, problem: `alder: \`${path} help --json\` gave no command tree with \`lsp\`: this alder predates editor support; ${BUILD_HINT}` };
  }
  return { path, version, ok: true };
}

export interface RootStatus { root: string; running: boolean; tokens: boolean; scratch: boolean }

// report is the `Alder: Show Health` text. The fill variables are named, never their values.
export function report(gate: Gate, roots: RootStatus[], env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  out.push(gate.path ? `binary: ${gate.path}${gate.version ? ` (${gate.version})` : ''}` : 'binary: not found');
  out.push(gate.ok ? 'ok: `alder help --json` lists `lsp`' : `error: ${gate.problem}`);
  for (const r of roots) {
    out.push(r.running ? `ok: alder lsp running for ${r.root}` : `warn: alder lsp for ${r.root} is stopped (Alder: Restart Server)`);
    if (!r.running) continue;
    out.push(r.tokens ? '  ok: semantic tokens, folding, selection' : `  warn: no semantic tokens: ${MISSING_TOKENS}`);
    out.push(r.scratch ? '  ok: scratch files (alder/scratch)' : `  warn: no scratch support: ${MISSING_SCRATCH}`);
  }
  if (roots.length === 0) out.push('info: no alder lsp running (open an .alder file inside an app)');
  for (const k of FILL_VARS) out.push(`fill: ${k}: ${env[k] && env[k]!.trim() !== '' ? 'set' : 'not set'}`);
  return out;
}
