# Routes, run, explain, tests (alder#144, milestone 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill in the six "not yet" commands milestone 3 left for this milestone: `Alder: Routes` (a QuickPick of the app's routes that jumps to the declaration), `Alder: Run the App` (`alder run` in a terminal), `Alder: Explain Diagnostic` (the server's explanation in a markdown preview), and the Test Explorer (`alder test --json` as a run profile, `alder test --mutate --json` as a second profile whose survivors land in Problems), plus `Run Tests`, `Run Test at Cursor`, `Mutation Testing` from the palette.

**Architecture:** Every module with logic but no need for VS Code is pure and unit-tested with `node --test`: `cli.ts` (spawn `alder`, JSONL decode, cancel, the failure report), `routeItems.ts`, `explainAt.ts`, `testModel.ts`. The VS Code glue (`routes.ts`, `run.ts`, `explain.ts`, `tests.ts`, plus small shared helpers `deps.ts`, `project.ts`, `report.ts`, `virtualDocs.ts`) is covered by contract tests in a real VS Code against the real server and CLI, on the blog fixture and a new small `demo` app scaffolded by `alder new` at test time.

**Tech Stack:** TypeScript 5.x (`module: node16`), `vscode-languageclient` 11, VS Code API `^1.91.0` (`TestController`, `QuickPick`, `Terminal`, `TextDocumentContentProvider`, `DiagnosticCollection`), `node:child_process`, `node:test` (unit), `@vscode/test-electron` + mocha (contract).

**Spec:** `docs/superpowers/specs/2026-11-01-vscode-extension-design.md` on tapegram/alder main (https://github.com/tapegram/alder/blob/main/docs/superpowers/specs/2026-11-01-vscode-extension-design.md). Sections this plan implements: "Tests, mutation, routes, run, explain", the `cli.ts`/`routes.ts`/`tests.ts` rows of "Repository and layout", the corresponding rows of "Commands, keys, settings", the matching cases under "Extension tests", and milestone 4 under "Milestones". Read those sections before starting a task. The nvim originals are in `~/projects/alder.nvim/lua/alder/` (`cli.lua`, `routes.lua`, `test.lua`, `buf.lua`, `check.lua`'s `explain`) with specs in `~/projects/alder.nvim/tests/` (`routes_spec.lua`, `test_spec.lua`, `mutate_spec.lua`).

## Global Constraints

- Repository `tapegram/alder-vscode`, branch `routes-run-explain-tests`, one PR that names tapegram/alder#144 (milestone 4).
- No runtime dependencies beyond `vscode-languageclient`; nothing new in `devDependencies`.
- Engines stay `vscode ^1.91.0`; CI runs ubuntu stable, macOS stable, ubuntu 1.91.0. No API newer than 1.91 (`TestMessage.diff`, `TestRunProfile`, `refreshHandler` are all older).
- The extension never rewords the compiler or the CLI: a JSON `error`, a server `ResponseError`'s message and a CLI's stderr are shown as they came.
- Pure modules (`cli.ts`, `routeItems.ts`, `explainAt.ts`, `testModel.ts`) import nothing from `vscode`, so the unit tests can load them and Durandal can share them later (spec, last section). Their names say what they do, not "Alder".
- The CLI is run with the gated binary (`Clients.binary()`, the path the health gate resolved), never a bare `alder` from `PATH`; its environment is the server's (`process.env` overlaid by `alder.serverEnv`).
- `alder test` and `alder test --mutate` are run as nvim runs them: `alder test --json [-run <re>] [alder.test.args…] <root>` with `cwd` = the root; mutate inserts `--mutate` after `test`.
- `alder.test.args` is appended to every test and mutation run, after the extension's own `-run`.
- Test item ids: root `<real root>`; module `<real root>\0<Module>`; test `<real root>\0<Module>\0<name>`, where `<name>` is the source text between the test's quotes (escapes untouched), which is how `alder test --json` names it.
- Messages copied from alder.nvim where it has one (spelling exact): `alder: no routes`; `alder routes: <error>`; `this alder has no routes command (<lsp message>): update alder (go install ./cmd/alder in the alder repo), then Alder: Restart Server`; `alder test: the earlier run was cancelled`; `alder test --mutate: the earlier run was cancelled`; `<label>: not written, the run reads disk: <paths>`; `<label>: the app does not check`; `alder test: no \`module\` line in this file; running every test`; `alder test: no test above the cursor; running <Module>'s tests`; `alder test --mutate — <k> killed, <s> survived (<score 2dp>)`, with `: no survivors` appended when there are none; `survived  <kind>: <before> → <after>`; the bug report's first line `This may be a compiler bug; \`alder version\` and the command are in this document.`
- No-root message (new): `alder: no app here: open a file under a directory that holds app/`.
- **Deviations from the spec, on purpose** (say them in the PR description):
  1. Pure logic is split from glue into `routeItems.ts`, `explainAt.ts` and `testModel.ts` beside `routes.ts`, `explain.ts`, `tests.ts`: the glue imports `vscode`, which `node --test` cannot load.
  2. A failing test's `TestMessage.diff` takes `right` as *expected* and `left` as *actual*. The spec says "`left`/`right` as expected/actual", but alder tests are written `computed == wanted` (`answer == 42` reports `left: 41, right: 42`; the blog's tests put the computed record on the left), so the literal reading would show the wanted value as the actual one.
  3. The terminal runs the gated binary's path (`'/Users/x/go/bin/alder' run`), not `alder run`: VS Code from the Dock may not have `alder` on its `PATH` (the reason discovery exists).
  4. The routes QuickPick is not closed when its client is disposed (the spec says it closes): it holds a static list, and a jump works without a server.
  5. Activation also fires on `workspaceContains:**/app/**/*.alder`, so the Test Explorer lists the tests of a workspace before an `.alder` file is opened.
- Working hours (the user's rule): no agent or background work 9am–5pm America/New_York, Monday to Friday. Long runs stop before 9am.

## Review Focus

1. **A cancelled or superseded run.** Expected: the older `alder test` is killed (SIGTERM), its test items end as skipped (not left spinning), one warning says it was cancelled, and its late output never marks items. Pinned by the `cli.run` abort unit test (Task 1) and the two-runs contract test (Task 6).
2. **Unsaved edits when a test run starts.** Expected: dirty `.alder` documents under that root are saved first (the CLI reads disk); a document that cannot be saved is named in a warning and the run goes ahead. Pinned by the compile-failure contract test in Task 6, which runs with an unsaved broken edit and must see `compile`, so the save happened.
3. **Test names with regexp metacharacters and escaped quotes** (`"a \"c\" (b)?"`). Expected: discovery reads the name exactly as alder reports it, and `-run` selects exactly that test. Pinned by the `discover`/`testAt`/`runPattern` unit tests in Task 5.
4. **An older alder: no `alder/routes` method, or no `routes --json` at all.** Expected: the CLI fallback is used silently when only the server lacks it; when both fail, one error says to update alder and restart. Pinned by the CLI-matches-server and "update alder" contract tests in Task 3 (the second runs `fetchCli` on a directory where `alder routes` fails, with a server error passed in).
5. **The app does not compile when tests are run.** Expected: the root item is errored with "the app does not check", an error notification says so, no item is marked passed or failed, and nothing is re-published (the server's Problems already show it). Pinned by the compile-failure contract test in Task 6.

---

## File structure

```
src/cli.ts            pure: run `alder <args>` (spawn, JSONL decode, abort), reportOf, bugText, shellQuote   (Task 1)
src/virtualDocs.ts    alder-doc: read-only virtual documents (the error report, explanations)                (Task 2)
src/deps.ts           Deps (what the commands share) and cliEnv()                                         (Task 2)
src/project.ts        projectRoot / requireRoot: the app root a command acts on                           (Task 2)
src/report.ts         showReport: a failed CLI run, shown unreworded                                      (Task 2)
src/explainAt.ts      pure: the alder diagnostic code at a position                                       (Task 2)
src/explain.ts        Alder: Explain Diagnostic                                                           (Task 2)
src/client.ts         + Clients.binary(), Clients.clientFor(); execute() uses clientFor                    (Task 2)
src/routeItems.ts     pure: normalize LSP and CLI routes, QuickPick labels                                (Task 3)
src/routes.ts         fetch (server, else CLI), the picker, the jump                                       (Task 3)
src/run.ts            Alder: Run the App, one terminal per root                                           (Task 4)
src/testModel.ts      pure: discovery regex, testAt, runPattern, results, survivors, score, classify      (Task 5)
src/tests.ts          TestController, run and mutation profiles, survivors collection, commands          (Task 6)
src/commands.ts       NOT_YET loses each command as it is implemented                                     (Tasks 2, 3, 4, 6)
src/extension.ts      wiring, Api grows docs, routes, tests                                                (Tasks 2, 3, 4, 6)
package.json          activation event workspaceContains (Task 6)
test/unit/cli.test.ts, explainAt.test.ts, routeItems.test.ts, testModel.test.ts
test/e2e/run.ts       + the demo app fixture (Task 2)
test/e2e/explain.e2e.ts, routes.e2e.ts, run.e2e.ts, tests.e2e.ts
README.md, CHANGELOG.md                                                                                  (Task 7)
```

## Running the tests

- Unit: `npm run test:unit`.
- Lint: `npm run lint`.
- Contract: build the binary from `.alder-ref` once (scratchpad path `$S`):
  `cd ~/projects/alder && git fetch && git worktree add "$S/alder-ref" $(cat ~/projects/alder-vscode/.alder-ref) && (cd "$S/alder-ref" && go build -o "$S/alder-ref/bin/alder" ./cmd/alder)`,
  then from `~/projects/alder-vscode`: `ALDER_BIN="$S/alder-ref/bin/alder" ALDER_REPO="$S/alder-ref" npm run test:e2e`.
  Remove the worktree at the end (`git -C ~/projects/alder worktree remove "$S/alder-ref"`).
  Run contract tests in the foreground with a timeout (≤ 10 min); they take a few minutes.
- To run one e2e file while iterating, temporarily filter in `test/e2e/index.ts` with an env var: add `const only = process.env.ALDER_E2E_ONLY;` and `.filter(f => !only || f.startsWith(only))` in Task 2 (keep it; it is harmless).

---

### Task 1: `cli.ts`, the CLI runner

**Files:**
- Create: `src/cli.ts`
- Test: `test/unit/cli.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type JsonObject = Record<string, unknown>`
  - `interface CliResult { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; objects: JsonObject[]; json: JsonObject | undefined; cancelled: boolean }`
  - `interface RunOptions { cwd: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal }`
  - `function decode(stdout: string): JsonObject[]`
  - `function run(bin: string, args: string[], o: RunOptions): Promise<CliResult>` (never rejects)
  - `type Report = { kind: 'error'; message: string } | { kind: 'bug' }`
  - `function reportOf(args: string[], res: CliResult, o?: { bugOn2?: boolean }): Report`
  - `function bugText(args: string[], res: CliResult, version: string): string`
  - `function shellQuote(s: string): string`

- [ ] **Step 1: Write the failing tests**

`test/unit/cli.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode, run, reportOf, bugText, shellQuote, CliResult } from '../../src/cli';

function dir(): string { return realpathSync(mkdtempSync(join(tmpdir(), 'alder-cli-'))); }

// fake writes an executable shell script and returns its path.
function fake(body: string): string {
  const p = join(dir(), 'alder');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

function res(over: Partial<CliResult>): CliResult {
  return { code: 0, signal: null, stdout: '', stderr: '', objects: [], json: undefined, cancelled: false, ...over };
}

test('decode keeps every JSON object printed one per line and skips the rest', () => {
  const out = decode('{"a":1}\nnot json\n  {"b":2}\n{broken\n[1,2]\n"x"\n');
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(decode(''), []);
});

test('run gives the exit code, both streams, the objects and the first object', async () => {
  const bin = fake(`echo '{"name":"t","ok":true}'; echo '{"score":1}'; echo 'summary' >&2; exit 1`);
  const r = await run(bin, ['test', '--json'], { cwd: dir() });
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trim(), 'summary');
  assert.deepEqual(r.objects, [{ name: 't', ok: true }, { score: 1 }]);
  assert.deepEqual(r.json, { name: 't', ok: true });
  assert.equal(r.cancelled, false);
});

test('run passes the arguments, the working directory and the environment', async () => {
  const bin = fake('echo "$PWD|$1|$2|$ALDER_X"');
  const cwd = dir();
  const r = await run(bin, ['a b', 'c'], { cwd, env: { ...process.env, ALDER_X: 'y' } });
  assert.equal(r.stdout.trim(), `${cwd}|a b|c|y`);
});

test('an abort kills the run with SIGTERM and marks it cancelled', async () => {
  const bin = fake('sleep 30');
  const ac = new AbortController();
  const p = run(bin, [], { cwd: dir(), signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  const started = Date.now();
  const r = await p;
  assert.ok(Date.now() - started < 10_000, 'the run was not killed');
  assert.equal(r.cancelled, true);
  assert.equal(r.signal, 'SIGTERM');
});

test('an already-aborted signal never leaves the child running', async () => {
  const ac = new AbortController();
  ac.abort();
  const r = await run(fake('sleep 30'), [], { cwd: dir(), signal: ac.signal });
  assert.equal(r.cancelled, true);
});

test('a missing binary resolves with the spawn error in stderr', async () => {
  const r = await run(join(dir(), 'nope'), [], { cwd: dir() });
  assert.equal(r.code, null);
  assert.match(r.stderr, /ENOENT/);
});

test('reportOf: a JSON error as is, exit 2 a bug, else stderr, stdout or the exit code', () => {
  assert.deepEqual(reportOf(['routes'], res({ code: 1, json: { error: 'no app' } })), { kind: 'error', message: 'no app' });
  assert.deepEqual(reportOf(['test'], res({ code: 2, stderr: 'panic' })), { kind: 'bug' });
  assert.deepEqual(reportOf(['explain', 'E1'], res({ code: 2, stderr: 'usage' }), { bugOn2: false }), { kind: 'error', message: 'usage' });
  assert.deepEqual(reportOf(['test'], res({ code: 1, stderr: '  tests fail: fix them\n' })), { kind: 'error', message: 'tests fail: fix them' });
  assert.deepEqual(reportOf(['test'], res({ code: 1, stdout: 'out\n' })), { kind: 'error', message: 'out' });
  assert.deepEqual(reportOf(['test', '--json'], res({ code: 3 })), { kind: 'error', message: 'alder test exited 3' });
});

test('bugText names the command, the output and the version', () => {
  const t = bugText(['test', '--json', '/app'], res({ code: 2, stderr: 'panic: x\n' }), 'alder devel+abc');
  assert.equal(t, [
    'This may be a compiler bug; `alder version` and the command are in this document.',
    '',
    '$ alder test --json /app',
    '',
    'panic: x',
    '',
    '$ alder version',
    'alder devel+abc',
    '',
  ].join('\n'));
});

test('shellQuote leaves plain paths alone and single-quotes the rest', () => {
  assert.equal(shellQuote('/usr/local/bin/alder'), '/usr/local/bin/alder');
  assert.equal(shellQuote('/Users/a b/alder'), `'/Users/a b/alder'`);
  assert.equal(shellQuote(`/x/it's`), `'/x/it'\\''s'`);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm run test:unit`
Expected: compile error, `Cannot find module '../../src/cli'`.

- [ ] **Step 3: Implement `src/cli.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm run test:unit && npm run lint`
Expected: all unit tests pass (the 37 existing plus the 9 new); lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts test/unit/cli.test.ts
git commit -m "cli: run alder, decode its JSONL, cancel, report failures unreworded"
```

---

### Task 2: shared glue and `Alder: Explain Diagnostic`

**Files:**
- Create: `src/virtualDocs.ts`, `src/deps.ts`, `src/project.ts`, `src/report.ts`, `src/explainAt.ts`, `src/explain.ts`
- Modify: `src/client.ts` (add `binary()`, `clientFor()`; `execute()` uses `clientFor`), `src/commands.ts` (drop `alder.explainDiagnostic` from `NOT_YET`), `src/extension.ts` (create `VirtualDocs`, `Deps`; register the command; `Api` gains `docs`), `test/e2e/run.ts` (the `demo` app), `test/e2e/index.ts` (`ALDER_E2E_ONLY`)
- Test: `test/unit/explainAt.test.ts`, `test/e2e/explain.e2e.ts`

**Interfaces:**
- Consumes: `run`, `reportOf`, `bugText`, `CliResult` (Task 1); `findRoot`, `realRoot` (`src/root.ts`); `serverEnv` (`src/clientConfig.ts`).
- Produces:
  - `src/virtualDocs.ts`: `const DOC_SCHEME = 'alder-doc'`; `class VirtualDocs implements vscode.TextDocumentContentProvider` with `register(context: vscode.ExtensionContext): void`, `set(path: string, text: string): vscode.Uri` (path without a leading slash, e.g. `explain/E0003.md`), `provideTextDocumentContent(uri: vscode.Uri): string`.
  - `src/deps.ts`: `interface Deps { clients: Clients; docs: VirtualDocs; output: vscode.LogOutputChannel }`; `function cliEnv(): NodeJS.ProcessEnv`; `function settingEnv(): Record<string, string>` (only the `alder.serverEnv` overlay, for a terminal).
  - `src/project.ts`: `const NO_ROOT: string`; `function projectRoot(clients: Clients): Promise<string | undefined>`; `function requireRoot(clients: Clients): Promise<string | undefined>` (shows `NO_ROOT` when undefined).
  - `src/report.ts`: `function showReport(deps: Deps, args: string[], res: CliResult, o?: { bugOn2?: boolean }): Promise<void>`.
  - `src/client.ts`: `Clients.binary(): Promise<string | undefined>`; `Clients.clientFor(uri?: vscode.Uri | string): Promise<LanguageClient | undefined>`.
  - `src/explainAt.ts`: `interface Pos { line: number; character: number }`; `interface DiagLike { source?: string; code?: string | number | { value: string | number }; range: { start: Pos; end: Pos } }`; `function codeOf(d: DiagLike): string | undefined`; `function codeAt(diags: readonly DiagLike[], pos: Pos): string | undefined`.
  - `src/explain.ts`: `function explainDiagnostic(deps: Deps, code?: string): Promise<vscode.Uri | undefined>` (the uri of the shown explanation, undefined when nothing was shown).
  - `Api.docs: VirtualDocs`.
  - e2e workspace gains `demo/`: `alder new demo`, plus `demo/app/Demo.alder` (text in Step 9).

- [ ] **Step 1: Write the failing unit test**

`test/unit/explainAt.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeAt, codeOf, DiagLike } from '../../src/explainAt';

const d = (code: DiagLike['code'], sl: number, sc: number, el: number, ec: number, source = 'alder'): DiagLike =>
  ({ source, code, range: { start: { line: sl, character: sc }, end: { line: el, character: ec } } });

test('codeOf reads a string, a number and a {value} code', () => {
  assert.equal(codeOf(d('E0003', 0, 0, 0, 1)), 'E0003');
  assert.equal(codeOf(d(7, 0, 0, 0, 1)), '7');
  assert.equal(codeOf(d({ value: 'W0001' }, 0, 0, 0, 1)), 'W0001');
  assert.equal(codeOf(d(undefined, 0, 0, 0, 1)), undefined);
});

test('the diagnostic whose range holds the cursor wins, its end included', () => {
  const ds = [d('E0001', 3, 0, 3, 4), d('E0002', 3, 8, 3, 12)];
  assert.equal(codeAt(ds, { line: 3, character: 9 }), 'E0002');
  assert.equal(codeAt(ds, { line: 3, character: 12 }), 'E0002');
  assert.equal(codeAt(ds, { line: 3, character: 2 }), 'E0001');
});

test('else the first alder diagnostic on the cursor line, a multi-line one included', () => {
  assert.equal(codeAt([d('E0001', 3, 0, 3, 4), d('E0002', 3, 8, 3, 12)], { line: 3, character: 6 }), 'E0001');
  assert.equal(codeAt([d('E0005', 1, 4, 5, 0)], { line: 2, character: 0 }), 'E0005');
  assert.equal(codeAt([d('E0001', 3, 0, 3, 4)], { line: 4, character: 0 }), undefined);
});

test('other sources and code-less diagnostics are skipped', () => {
  assert.equal(codeAt([d('X1', 0, 0, 0, 9, 'eslint'), d(undefined, 0, 0, 0, 9)], { line: 0, character: 1 }), undefined);
  assert.equal(codeAt([d('X1', 0, 0, 0, 9, 'eslint'), d('E0003', 0, 2, 0, 3)], { line: 0, character: 1 }), 'E0003');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: `Cannot find module '../../src/explainAt'`.

- [ ] **Step 3: Implement `src/explainAt.ts`**

```ts
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
```

- [ ] **Step 4: Run the unit tests to see them pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: The shared glue**

`src/virtualDocs.ts`:

```ts
import * as vscode from 'vscode';

export const DOC_SCHEME = 'alder-doc';

// VirtualDocs are read-only documents the extension writes: the CLI's bug report and the
// explanations. A path's extension picks the language (explain/E0003.md is markdown).
export class VirtualDocs implements vscode.TextDocumentContentProvider {
  private texts = new Map<string, string>();
  private changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DOC_SCHEME, this), this.changed);
  }

  set(path: string, text: string): vscode.Uri {
    const uri = vscode.Uri.from({ scheme: DOC_SCHEME, path: '/' + path });
    this.texts.set(uri.path, text);
    this.changed.fire(uri);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.texts.get(uri.path) ?? '';
  }
}
```

`src/deps.ts`:

```ts
import * as vscode from 'vscode';
import type { Clients } from './client';
import { serverEnv } from './clientConfig';
import type { VirtualDocs } from './virtualDocs';

// Deps is what the commands share.
export interface Deps {
  clients: Clients;
  docs: VirtualDocs;
  output: vscode.LogOutputChannel;
}

// cliEnv is the environment of a CLI run: the server's (VS Code's own overlaid by alder.serverEnv).
export function cliEnv(): NodeJS.ProcessEnv {
  return serverEnv(process.env, vscode.workspace.getConfiguration('alder').get('serverEnv'));
}

// settingEnv is only the alder.serverEnv overlay (a terminal adds it to its own environment).
export function settingEnv(): Record<string, string> {
  return serverEnv({}, vscode.workspace.getConfiguration('alder').get('serverEnv')) as Record<string, string>;
}
```

`src/project.ts`:

```ts
import * as vscode from 'vscode';
import type { Clients } from './client';
import { findRoot } from './root';

export const NO_ROOT = 'alder: no app here: open a file under a directory that holds app/';

// projectRoot is the app root a project command acts on, as project.lua's root: the active
// editor's file's root; else the only running server's; else the first workspace folder that is
// (or is inside) an app root.
export async function projectRoot(clients: Clients): Promise<string | undefined> {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc?.uri.scheme === 'file') {
    const r = await findRoot(doc.uri.fsPath);
    if (r) return r;
  }
  const running = clients.roots();
  if (running.length === 1) return running[0];
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    const r = await findRoot(f.uri.fsPath);
    if (r) return r;
  }
  return undefined;
}

// requireRoot is projectRoot, saying so when there is none.
export async function requireRoot(clients: Clients): Promise<string | undefined> {
  const r = await projectRoot(clients);
  if (!r) void vscode.window.showErrorMessage(NO_ROOT);
  return r;
}
```

`src/report.ts`:

```ts
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { bugText, CliResult, reportOf, run } from './cli';
import type { Deps } from './deps';

// showReport shows a failed CLI run without rewording it (cli.lua's report): an error
// notification, or for exit 2 the bug report document beside the editor.
export async function showReport(deps: Deps, args: string[], res: CliResult, o: { bugOn2?: boolean } = {}): Promise<void> {
  const r = reportOf(args, res, o);
  if (r.kind === 'error') {
    void vscode.window.showErrorMessage(r.message);
    return;
  }
  const bin = await deps.clients.binary();
  const version = bin ? (await run(bin, ['version'], { cwd: homedir() })).stdout : '';
  const uri = deps.docs.set('error.txt', bugText(args, res, version));
  await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}
```

In `src/client.ts`, add to `Clients` (after `checkGate`), and make `execute` use `clientFor`:

```ts
  // binary is the alder binary the gate resolved, or undefined after reporting a failed gate
  // (once, as ensure does). The CLI commands run this path, never a bare `alder`.
  async binary(): Promise<string | undefined> {
    const gate = await this.checkGate();
    if (!gate.ok || !gate.path) {
      this.reportGate(gate);
      return undefined;
    }
    return gate.path;
  }

  // clientFor is the client of uri's root when uri is given; else the active editor's root's,
  // else the only one running.
  async clientFor(uri?: vscode.Uri | string): Promise<LanguageClient | undefined> {
    if (uri !== undefined) return this.forUri(uri);
    const active = vscode.window.activeTextEditor?.document.uri;
    const client = active ? await this.forUri(active) : undefined;
    if (client) return client;
    return this.byReal.size === 1 ? [...this.byReal.values()][0].client : undefined;
  }
```

and in `execute` replace the `let client … if (!client && this.byReal.size === 1) …` block with:

```ts
    const client = await this.clientFor(commandUri(args));
```

- [ ] **Step 6: Implement `src/explain.ts`**

```ts
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { ExecuteCommandRequest, State } from 'vscode-languageclient/node';
import { run } from './cli';
import { cliEnv, Deps } from './deps';
import { codeAt } from './explainAt';
import { projectRoot } from './project';
import { showReport } from './report';

// explainDiagnostic shows the explanation of code, else of the alder diagnostic at the cursor,
// else of a code the user types, in a markdown preview beside the editor. The text comes from
// the server (alder.explain) when one runs for the file, else from `alder explain <code>`.
// Returns the explanation document's uri, or undefined when nothing was shown.
export async function explainDiagnostic(deps: Deps, code?: string): Promise<vscode.Uri | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!code && editor) code = codeAt(vscode.languages.getDiagnostics(editor.document.uri), editor.selection.active);
  if (!code) {
    code = (await vscode.window.showInputBox({
      prompt: 'alder: no diagnostic under the cursor; explain which code?',
      placeHolder: 'E0003',
    }))?.trim();
  }
  if (!code) return undefined;
  const text = await explainText(deps, code, editor?.document.uri);
  if (text === undefined) return undefined;
  const uri = deps.docs.set(`explain/${code}.md`, text);
  try {
    await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
  } catch {
    // the built-in markdown extension is disabled: show the text itself
    await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }
  return uri;
}

async function explainText(deps: Deps, code: string, uri: vscode.Uri | undefined): Promise<string | undefined> {
  const client = await deps.clients.clientFor(uri);
  if (client && client.state === State.Running) {
    try {
      return await client.sendRequest(ExecuteCommandRequest.type, { command: 'alder.explain', arguments: [code] }) as string;
    } catch (err) {
      void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }
  const bin = await deps.clients.binary();
  if (!bin) return undefined;
  const args = ['explain', code];
  const res = await run(bin, args, { cwd: (await projectRoot(deps.clients)) ?? homedir(), env: cliEnv() });
  if (res.code !== 0) {
    await showReport(deps, args, res, { bugOn2: false });
    return undefined;
  }
  return res.stdout;
}
```

- [ ] **Step 7: Wire it**

In `src/commands.ts`, delete the `'alder.explainDiagnostic': 'Explain Diagnostic',` line of `NOT_YET` and change its comment to name what is still missing:

```ts
// NOT_YET are the commands later milestones fill in (5: the generator flow; 6: scratch). Each
// says so when run.
```

(Later tasks delete their lines too; the comment is final once Task 6 is done: by then only `alder.generate` and the three `alder.scratch.*` remain.)

In `src/extension.ts`: import `VirtualDocs`, `Deps`, `explainDiagnostic`; after `const cs = new Clients(output);` add

```ts
  const docs = new VirtualDocs();
  docs.register(context);
  const deps: Deps = { clients: cs, docs, output };
```

register `vscode.commands.registerCommand('alder.explainDiagnostic', (code?: unknown) => explainDiagnostic(deps, typeof code === 'string' ? code : undefined))` in the `context.subscriptions.push(` list, add `docs: VirtualDocs;` to `interface Api` and `docs` to the returned object.

- [ ] **Step 8: The `ALDER_E2E_ONLY` filter**

In `test/e2e/index.ts`:

```ts
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', timeout: 60_000, color: true });
  // ALDER_E2E_ONLY=<prefix> runs only the files whose name starts with it (while iterating)
  const only = process.env.ALDER_E2E_ONLY;
  for (const f of readdirSync(__dirname).filter(f => f.endsWith('.e2e.js') && (!only || f.startsWith(only))).sort()) {
    mocha.addFile(join(__dirname, f));
  }
  return new Promise((res, rej) => mocha.run(failures => (failures ? rej(new Error(`${failures} failed`)) : res())));
}
```

and in `test/e2e/run.ts` pass it through: `extensionTestsEnv: { ALDER_E2E_WS: ws, ALDER_E2E_ONLY: process.env.ALDER_E2E_ONLY ?? '' },`.

- [ ] **Step 9: The demo app fixture**

In `test/e2e/run.ts`, add `import { execFileSync } from 'node:child_process';` and, after the `fill` fixture is written and before `.vscode` is made:

```ts
  // demo: a fresh `alder new` app with one passing and one failing test (Demo), for the test
  // controller, mutation testing, explain and run. The scaffold's own Home tests pass.
  execFileSync(bin, ['new', 'demo'], { cwd: ws, stdio: 'ignore' });
  writeFileSync(join(ws, 'demo/app/Demo.alder'), DEMO);
```

with, at module level:

```ts
// DEMO's line numbers are pinned by tests.e2e.ts (0-based: "answer is positive" on 5, "answer is 42" on 7).
export const DEMO = [
  'module Demo',
  '',
  'answer : Int',
  'answer = 40 + 1',
  '',
  'test "answer is positive" = answer > 0',
  '',
  'test "answer is 42" = answer == 42',
  '',
].join('\n');
```

- [ ] **Step 10: Write the contract test**

`test/e2e/explain.e2e.ts`:

```ts
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import { api, at, open, revert, until } from './helpers';

// serverText is the server's own explanation of code (requests go by method name: see client.e2e.ts).
async function serverText(uri: vscode.Uri, code: string): Promise<string> {
  const c: LanguageClient | undefined = await (await api()).clients.forUri(uri);
  assert.ok(c);
  return c.sendRequest<string>('workspace/executeCommand', { command: 'alder.explain', arguments: [code] });
}

describe('Alder: Explain Diagnostic', () => {
  it('explains the diagnostic under the cursor in a markdown document, as the server wrote it', async () => {
    const editor = await open('demo/app/Demo.alder');
    const doc = editor.document;
    try {
      const edit = new vscode.WorkspaceEdit();
      const p = at(doc, '40 + 1');
      edit.replace(doc.uri, new vscode.Range(p, p.translate(0, '40 + 1'.length)), '"x"');
      assert.ok(await vscode.workspace.applyEdit(edit));
      const diag = await until(() => vscode.languages.getDiagnostics(doc.uri).find(d => d.source === 'alder' && (typeof d.code === 'object' ? d.code.value : d.code) === 'E0003'), 'E0003');
      editor.selection = new vscode.Selection(diag.range.start.translate(0, 1), diag.range.start.translate(0, 1));
      const uri = await vscode.commands.executeCommand<vscode.Uri | undefined>('alder.explainDiagnostic');
      assert.ok(uri, 'nothing was shown');
      assert.equal(uri.path, '/explain/E0003.md');
      const shown = await vscode.workspace.openTextDocument(uri);
      assert.equal(shown.languageId, 'markdown');
      assert.equal(shown.getText(), await serverText(doc.uri, 'E0003'));
    } finally {
      await revert(doc);
    }
  });

  it('an explicit code is explained without a diagnostic; an unknown one shows nothing', async () => {
    await open('demo/app/Demo.alder');
    const uri = await vscode.commands.executeCommand<vscode.Uri | undefined>('alder.explainDiagnostic', 'E0003');
    assert.equal(uri?.path, '/explain/E0003.md');
    assert.equal(await vscode.commands.executeCommand('alder.explainDiagnostic', 'E9999'), undefined);
  });
});
```

- [ ] **Step 11: Run all the tests**

Run: `npm run lint && npm run test:unit && ALDER_BIN=… ALDER_REPO=… npm run test:e2e` (see "Running the tests").
Expected: everything passes, the two new contract tests included. If `markdown.showPreviewToSide` opens nothing for an `alder-doc:` uri on 1.91 (check by eye once with a local run), keep the fallback and say so in the PR.

- [ ] **Step 12: Commit**

```bash
git add src test
git commit -m "explain: the diagnostic at the cursor, from the server, in a markdown preview"
```

---

### Task 3: `Alder: Routes`

**Files:**
- Create: `src/routeItems.ts`, `src/routes.ts`
- Modify: `src/commands.ts` (drop `alder.routes` from `NOT_YET`), `src/extension.ts` (register; `Api.routes`)
- Test: `test/unit/routeItems.test.ts`, `test/e2e/routes.e2e.ts`

**Interfaces:**
- Consumes: `run`, `decode` (Task 1); `Deps`, `cliEnv`, `requireRoot` (Task 2); `Clients.forUri`, `Clients.binary`.
- Produces:
  - `src/routeItems.ts`: `interface Route { kind: string; path: string; module: string; name: string; file: string; line: number; character: number }` (absolute file, 0-based position); `interface LspRoute { kind: string; path: string; module: string; name: string; uri: string; range?: { start: { line: number; character: number } } }`; `function normalizeLsp(result: readonly LspRoute[] | null | undefined): Route[]`; `function normalizeCli(stdout: string, root: string): Route[]`; `function verb(r: Pick<Route, 'kind'>): 'GET' | 'POST'`; `function pickItem(r: Route): { label: string; description: string }`.
  - `src/routes.ts`: `type Fetched = { routes: Route[] } | { error: string }`; `interface RouteUi { pick(items: RouteItem[]): Promise<RouteItem | undefined> }` with `interface RouteItem extends vscode.QuickPickItem { route: Route }`; `function fetchRoutes(deps: Deps, root: string): Promise<Fetched>`; `function fetchCli(deps: Deps, root: string, lspError?: string): Promise<Fetched>`; `function pickRoutes(deps: Deps, ui?: RouteUi): Promise<Route | undefined>`; `function jump(r: Route): Promise<vscode.TextEditor>`; `const UPDATE_ROUTES: (lspError: string) => string`.
  - `Api.routes: { fetch: (root: string) => Promise<Fetched>; fetchCli: (root: string, lspError?: string) => Promise<Fetched> }`.
  - The `alder.routes` command takes an optional `RouteUi` (tests answer the pick) and returns the route jumped to.

- [ ] **Step 1: Write the failing unit tests**

`test/unit/routeItems.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { normalizeCli, normalizeLsp, pickItem, verb } from '../../src/routeItems';

const lsp = (root: string) => [
  { kind: 'page', path: '/sites/:id', module: 'Sites.Clarity.Index', name: 'page',
    uri: pathToFileURL(`${root}/app/Sites/Clarity/Index.alder`).href, range: { start: { line: 1, character: 2 } } },
  { kind: 'msg', path: '/sites/:id/delete', module: 'Sites.Clarity.Index', name: 'Delete',
    uri: pathToFileURL(`${root}/app/Sites/Clarity/Index.alder`).href, range: { start: { line: 2, character: 0 } } },
];

test('normalizeLsp keeps the 0-based position and turns the uri into a path', () => {
  const r = normalizeLsp(lsp('/x'));
  assert.deepEqual(r[0], { kind: 'page', path: '/sites/:id', module: 'Sites.Clarity.Index', name: 'page',
    file: '/x/app/Sites/Clarity/Index.alder', line: 1, character: 2 });
  assert.deepEqual(normalizeLsp(null), []);
});

test('a route without a range starts at the top of its file', () => {
  const [r] = normalizeLsp([{ ...lsp('/x')[0], range: undefined }]);
  assert.equal(r.line, 0);
  assert.equal(r.character, 0);
});

test('normalizeCli reads the JSON array, makes the file absolute and the position 0-based', () => {
  const out = '[{"kind":"page","path":"/","module":"Home","name":"page","file":"app/Home.alder","line":3,"col":5}]\n';
  assert.deepEqual(normalizeCli(out, '/proj'), [
    { kind: 'page', path: '/', module: 'Home', name: 'page', file: '/proj/app/Home.alder', line: 2, character: 4 },
  ]);
});

test('normalizeCli also reads {routes: […]}, JSONL, one object, and an absolute file', () => {
  const one = { kind: 'msg', path: '/_m/A/B', module: 'A', name: 'B', file: '/abs/app/A.alder', line: 1, col: 1 };
  assert.equal(normalizeCli(JSON.stringify({ routes: [one] }), '/p')[0].file, '/abs/app/A.alder');
  assert.equal(normalizeCli(`${JSON.stringify(one)}\n${JSON.stringify(one)}\n`, '/p').length, 2);
  assert.equal(normalizeCli(JSON.stringify(one), '/p').length, 1);
  assert.deepEqual(normalizeCli('', '/p'), []);
});

test('a msg is POST, a page GET; the pick shows the verb and path, then the declaration', () => {
  const [page, msg] = normalizeLsp(lsp('/x'));
  assert.equal(verb(msg), 'POST');
  assert.deepEqual(pickItem(page), { label: 'GET /sites/:id', description: 'Sites.Clarity.Index.page' });
  assert.deepEqual(pickItem(msg), { label: 'POST /sites/:id/delete', description: 'Sites.Clarity.Index.Delete' });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:unit`
Expected: `Cannot find module '../../src/routeItems'`.

- [ ] **Step 3: Implement `src/routeItems.ts`**

```ts
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
```

- [ ] **Step 4: Run the unit tests to see them pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Implement `src/routes.ts`**

```ts
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
```

Wire it: drop `'alder.routes': 'Routes',` from `NOT_YET`; in `src/extension.ts` register

```ts
    vscode.commands.registerCommand('alder.routes', (ui?: RouteUi) => pickRoutes(deps, ui && typeof ui.pick === 'function' ? ui : undefined)),
```

and add to `Api`: `routes: { fetch(root: string): Promise<Fetched>; fetchCli(root: string, lspError?: string): Promise<Fetched> };` returning `routes: { fetch: root => fetchRoutes(deps, root), fetchCli: (root, e) => fetchCli(deps, root, e) }`.

- [ ] **Step 6: Write the contract test**

`test/e2e/routes.e2e.ts`:

```ts
import * as assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { RouteItem } from '../../src/routes';
import { api, open, ws } from './helpers';

const blog = () => join(ws(), 'blog');

describe('Alder: Routes', () => {
  it('lists the blog\'s routes from the server, GET / at Posts.Index.page', async () => {
    await open('blog/app/Posts/Index.alder');
    const got = await (await api()).routes.fetch(blog());
    assert.ok('routes' in got, JSON.stringify(got));
    const home = got.routes.find(r => r.path === '/' && r.kind === 'page');
    assert.ok(home, JSON.stringify(got.routes.slice(0, 3)));
    assert.equal(`${home.module}.${home.name}`, 'Posts.Index.page');
    assert.ok(got.routes.some(r => r.kind === 'msg'), 'no msg routes');
  });

  it('the CLI lists the same routes', async () => {
    const a = await api();
    const lsp = await a.routes.fetch(blog());
    const cli = await a.routes.fetchCli(blog());
    assert.ok('routes' in lsp && 'routes' in cli, JSON.stringify(cli));
    const key = (r: { kind: string; path: string; module: string; name: string; file: string; line: number }) =>
      `${r.kind} ${r.path} ${r.module}.${r.name} ${r.file}:${r.line}`;
    assert.deepEqual(cli.routes.map(key).sort(), lsp.routes.map(key).sort());
  });

  it('when the server failed too, the CLI error says to update alder', async () => {
    // a root with no app/ makes `alder routes --json` fail; the server error is passed in
    const got = await (await api()).routes.fetchCli(ws(), 'Unhandled method alder/routes');
    assert.ok('error' in got);
    assert.match(got.error, /^this alder has no routes command \(Unhandled method alder\/routes\): update alder/);
  });

  it('picking a route opens its declaration', async () => {
    await open('blog/app/App.alder');
    const ui = { pick: async (items: RouteItem[]) => items.find(i => i.label === 'GET /') };
    const r = await vscode.commands.executeCommand<{ file: string; line: number } | undefined>('alder.routes', ui);
    assert.ok(r, 'nothing picked');
    const ed = vscode.window.activeTextEditor!;
    assert.equal(ed.document.uri.fsPath, join(blog(), 'app/Posts/Index.alder'));
    assert.equal(ed.selection.active.line, r.line);
    assert.match(ed.document.lineAt(r.line).text, /page/);
  });
});
```

(If the `fetchCli(ws(), …)` case finds `alder routes` succeeding from a directory without `app/`, use `join(ws(), 'nowhere')` created with `mkdirSync` in the test instead; the point is a failing CLI.)

- [ ] **Step 7: Run all the tests**

Run: `npm run lint && npm run test:unit && ALDER_E2E_ONLY=routes ALDER_BIN=… ALDER_REPO=… npm run test:e2e`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src test
git commit -m "routes: the app's routes from the server (else the CLI) in a QuickPick"
```

---

### Task 4: `Alder: Run the App`

**Files:**
- Create: `src/run.ts`
- Modify: `src/commands.ts` (drop `alder.run`), `src/extension.ts` (register)
- Test: `test/e2e/run.e2e.ts`

**Interfaces:**
- Consumes: `shellQuote` (Task 1); `Deps`, `settingEnv`, `requireRoot` (Task 2); `realRoot` (`src/root.ts`).
- Produces: `class AppTerminals { constructor(deps: Deps); register(context: vscode.ExtensionContext): void; run(): Promise<vscode.Terminal | undefined> }`. The `alder.run` command returns the terminal.

- [ ] **Step 1: Write the failing contract test**

`test/e2e/run.e2e.ts`:

```ts
import * as assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { open, until, ws } from './helpers';

describe('Alder: Run the App', () => {
  it('opens one terminal per root in the root, and reuses it while it is alive', async () => {
    await open('demo/app/Demo.alder');
    const t = await vscode.commands.executeCommand<vscode.Terminal>('alder.run');
    try {
      assert.ok(t);
      assert.equal(t.name, 'alder run (demo)');
      const cwd = (t.creationOptions as vscode.TerminalOptions).cwd;
      assert.equal(typeof cwd === 'string' ? cwd : cwd?.fsPath, join(ws(), 'demo'));
      assert.equal(await vscode.commands.executeCommand<vscode.Terminal>('alder.run'), t, 'not reused');
    } finally {
      t?.dispose();
    }
    await until(() => !vscode.window.terminals.includes(t), 'the terminal to close');
    const again = await vscode.commands.executeCommand<vscode.Terminal>('alder.run');
    try {
      assert.ok(again && again !== t, 'a closed terminal was reused');
    } finally {
      again?.dispose();
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `ALDER_E2E_ONLY=run ALDER_BIN=… ALDER_REPO=… npm run test:e2e`
Expected: FAIL (the command returns the "not implemented" message's promise, not a terminal).

- [ ] **Step 3: Implement `src/run.ts`**

```ts
import { basename } from 'node:path';
import * as vscode from 'vscode';
import { shellQuote } from './cli';
import { Deps, settingEnv } from './deps';
import { requireRoot } from './project';
import { realRoot } from './root';

// AppTerminals is Alder: Run the App: `alder run` in a terminal at the project's root, one
// terminal per root, reused (shown again, not re-run) while it is open. It runs the binary the
// gate resolved, so a VS Code started from the Dock with a short PATH still finds it.
export class AppTerminals {
  private byReal = new Map<string, vscode.Terminal>();

  constructor(private readonly deps: Deps) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.window.onDidCloseTerminal(t => {
      for (const [k, v] of this.byReal) if (v === t) this.byReal.delete(k);
    }));
  }

  async run(): Promise<vscode.Terminal | undefined> {
    const root = await requireRoot(this.deps.clients);
    if (!root) return undefined;
    const bin = await this.deps.clients.binary();
    if (!bin) return undefined;
    const real = await realRoot(root);
    let t = this.byReal.get(real);
    if (!t || t.exitStatus !== undefined) {
      t = vscode.window.createTerminal({ name: `alder run (${basename(real)})`, cwd: real, env: settingEnv() });
      this.byReal.set(real, t);
      t.sendText(`${shellQuote(bin)} run`);
    }
    t.show();
    return t;
  }
}
```

Wire it: drop `'alder.run': 'Run',` from `NOT_YET`; in `src/extension.ts`: `const terminals = new AppTerminals(deps); terminals.register(context);` and `vscode.commands.registerCommand('alder.run', () => terminals.run()),`.

- [ ] **Step 4: Run the tests**

Run: `npm run lint && ALDER_E2E_ONLY=run ALDER_BIN=… ALDER_REPO=… npm run test:e2e`
Expected: PASS. (`run.e2e.js` and `run.js` both start with `run`; the filter loads only `*.e2e.js`, so the launcher is not loaded as a test.)

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "run: alder run in a terminal per root"
```

---

### Task 5: `testModel.ts`, the test and mutation logic

**Files:**
- Create: `src/testModel.ts`
- Test: `test/unit/testModel.test.ts`

**Interfaces:**
- Consumes: `JsonObject` (Task 1).
- Produces:
  - `interface TestResult { module: string; name: string; ok: boolean; file?: string; line?: number; col?: number; left?: string; right?: string; error?: string; note?: string; ms?: number }`
  - `interface Mutant { module?: string; file?: string; decl?: string; line?: number; col?: number; kind?: string; before?: string; after?: string; killed?: boolean }`
  - `interface Score { score: number; killed: number; survived: number }`
  - `interface Discovered { module: string; tests: { name: string; line: number }[] }` (0-based lines)
  - `function moduleOf(text: string): string | undefined`
  - `function discover(text: string): Discovered | undefined` (undefined without a `module` line)
  - `function testAt(text: string, line: number): string | undefined`
  - `function runPattern(module: string, name?: string): string`
  - `function messageText(r: TestResult): string`
  - `function summary(results: readonly TestResult[]): string`
  - `function resultsOf(objects: readonly JsonObject[]): TestResult[]`
  - `function scoreOf(objects: readonly JsonObject[]): Score | undefined`
  - `function survivors(objects: readonly JsonObject[]): Mutant[]` (sorted by file, then line)
  - `function survivorText(m: Mutant): string`
  - `function mutateTitle(s: Score): string`
  - `type Mode = 'test' | 'mutate'`
  - `function classify(res: { code: number | null; objects: readonly JsonObject[]; json: JsonObject | undefined }, mode: Mode): 'compile' | 'report' | 'ok'`
  - `const MUTATE_TITLE = 'alder test --mutate'`, `const TEST_TITLE = 'alder test'`
  - `function label(mode: Mode): string` (`TEST_TITLE` or `MUTATE_TITLE`)

- [ ] **Step 1: Write the failing tests**

`test/unit/testModel.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, discover, label, messageText, moduleOf, mutateTitle, resultsOf, runPattern, scoreOf, summary,
  survivors, survivorText, testAt,
} from '../../src/testModel';

const SRC = [
  'module Todos.Index',            // 0
  '',                              // 1
  'test "a plain name" = 1 == 1',  // 2
  '',                              // 3
  'test "a \\"quoted\\" (name)?" =', // 4
  '  x == "y"',                    // 5
  'testing = 3',                   // 6
  '  test "indented is not a test" = True', // 7
  'test "b" = a == "c" == d',      // 8
].join('\n');

test('discover reads the module and each top-level test, its name as written between the quotes', () => {
  assert.deepEqual(discover(SRC), {
    module: 'Todos.Index',
    tests: [
      { name: 'a plain name', line: 2 },
      { name: 'a \\"quoted\\" (name)?', line: 4 },
      { name: 'b', line: 8 },
    ],
  });
  assert.equal(discover('x = 1\ntest "t" = True\n'), undefined);
  assert.equal(moduleOf('-- c\nmodule A.B exposing\n'), 'A.B');
});

test('testAt is the nearest test at or above the line', () => {
  assert.equal(testAt(SRC, 1), undefined);
  assert.equal(testAt(SRC, 2), 'a plain name');
  assert.equal(testAt(SRC, 5), 'a \\"quoted\\" (name)?');
  assert.equal(testAt(SRC, 7), 'a \\"quoted\\" (name)?');
  assert.equal(testAt(SRC, 99), 'b');
});

test('runPattern anchors one test or the module, escaping Go regexp metacharacters', () => {
  assert.equal(runPattern('Todo'), '^Todo ');
  assert.equal(runPattern('Todo', 'adds one'), '^Todo "adds one"$');
  assert.equal(runPattern('A.B', 'a \\"q\\" (x)? [y] {2} a|b ^$ + * .'),
    '^A.B "a \\\\"q\\\\" \\(x\\)\\? \\[y\\] \\{2\\} a\\|b \\^\\$ \\+ \\* \\."$');
});

test('messageText: sides, else the error, else the note, flattened', () => {
  assert.equal(messageText({ module: 'M', name: 'n', ok: false, left: '3', right: '2' }), 'left: 3  right: 2');
  assert.equal(messageText({ module: 'M', name: 'n', ok: false, error: 'boom\n  here' }), 'error: boom here');
  assert.equal(messageText({ module: 'M', name: 'n', ok: false, note: 'sides print the same' }), 'note: sides print the same');
  assert.equal(messageText({ module: 'M', name: 'n', ok: false }), 'failed');
});

test('summary counts', () => {
  assert.equal(summary([{ module: 'M', name: 'a', ok: true }, { module: 'M', name: 'b', ok: false }]), '1 passed, 1 failed');
  assert.equal(summary([]), '0 passed, 0 failed');
});

test('resultsOf keeps the objects that name a test', () => {
  const objs = [{ module: 'M', name: 'a', ok: true }, { diagnostics: [] }, { mutants: [] }, { score: 1, killed: 1, survived: 0 }];
  assert.deepEqual(resultsOf(objs), [{ module: 'M', name: 'a', ok: true }]);
});

const MUTATE = [
  { module: 'Demo', name: 'answer is positive', ok: true },
  { mutants: [
    { id: 2, module: 'Home', file: 'app/Home.alder', line: 26, col: 5, kind: 'write replaced', before: 'a', after: 'b', killed: false },
    { id: 1, module: 'Home', file: 'app/Home.alder', line: 14, col: 10, kind: 'orderBy reversed', before: 'x.desc', after: 'x.asc', killed: false },
    { id: 3, module: 'Home', file: 'app/Home.alder', line: 30, col: 1, kind: 'k', before: 'c', after: 'd', killed: true },
    { id: 4, module: 'A', file: 'app/A.alder', line: 99, col: 1, kind: 'k', before: 'e', after: 'f', killed: false },
    { id: 5, kind: 'k', killed: false },
  ] },
  { score: 0.5625, killed: 18, survived: 14, suppressed: 0, skipped: 0 },
];

test('survivors are the unkilled mutants with a file, by file then line', () => {
  assert.deepEqual(survivors(MUTATE).map(m => `${m.file}:${m.line}`), ['app/A.alder:99', 'app/Home.alder:14', 'app/Home.alder:26']);
  assert.equal(survivorText(survivors(MUTATE)[1]), 'survived  orderBy reversed: x.desc → x.asc');
  assert.equal(survivorText({}), 'survived  ?:  → ');
});

test('the score object and the title', () => {
  const s = scoreOf(MUTATE);
  assert.deepEqual(s && { score: s.score, killed: s.killed, survived: s.survived }, { score: 0.5625, killed: 18, survived: 14 });
  assert.equal(mutateTitle(s!), 'alder test --mutate — 18 killed, 14 survived (0.56)');
  assert.equal(scoreOf([{ module: 'M', name: 'a', ok: true }]), undefined);
  assert.equal(label('test'), 'alder test');
  assert.equal(label('mutate'), 'alder test --mutate');
});

test('classify: diagnostics are a compile failure; a usage error, no results or a JSON error a report', () => {
  const r = (code: number | null, objects: Record<string, unknown>[]) => ({ code, objects, json: objects[0] });
  assert.equal(classify(r(1, [{ diagnostics: [{ code: 'E0003' }] }]), 'test'), 'compile');
  assert.equal(classify(r(1, [{ diagnostics: [] }]), 'mutate'), 'compile');
  assert.equal(classify(r(1, [{ module: 'M', name: 'a', ok: false }]), 'test'), 'ok');
  assert.equal(classify(r(0, []), 'test'), 'ok');
  assert.equal(classify(r(1, []), 'test'), 'report');
  assert.equal(classify(r(2, [{ module: 'M', name: 'a', ok: true }]), 'test'), 'report');
  assert.equal(classify(r(1, [{ error: 'no app' }]), 'test'), 'report');
  assert.equal(classify(r(0, MUTATE), 'mutate'), 'ok');
  // tests fail before mutants are measured: results, no score
  assert.equal(classify(r(1, [{ module: 'M', name: 'a', ok: false }]), 'mutate'), 'report');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:unit`
Expected: `Cannot find module '../../src/testModel'`.

- [ ] **Step 3: Implement `src/testModel.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm run test:unit && npm run lint`
Expected: PASS. If the `runPattern` metacharacter assertion fails, compare against test.lua's escaping (`[%^%$%(%)%%%.%[%]%*%+%-%?%{%}%|\\]`): every one of `^ $ ( ) . [ ] * + - ? { } | \` gets a backslash; fix the expected string only if the implementation matches that set.

- [ ] **Step 5: Commit**

```bash
git add src/testModel.ts test/unit/testModel.test.ts
git commit -m "testModel: discovery, -run patterns, results, survivors and the score"
```

---

### Task 6: the Test Explorer, mutation testing and the test commands

**Files:**
- Create: `src/tests.ts`
- Modify: `src/commands.ts` (drop `alder.test.run`, `alder.test.runAtCursor`, `alder.test.mutate`; the `NOT_YET` comment is final now), `src/extension.ts` (create, register, commands, `Api.tests`), `package.json` (`activationEvents`)
- Test: `test/e2e/tests.e2e.ts`

**Interfaces:**
- Consumes: `run`, `CliResult` (Task 1); `Deps`, `cliEnv`, `requireRoot`, `showReport` (Task 2); everything in `testModel.ts` (Task 5); `findRoot`, `realRoot`.
- Produces:
  - `interface ResultRecord { id: string; ok: boolean; message?: string; expected?: string; actual?: string }`
  - `interface RunOutcome { root: string; kind: 'results' | 'compile' | 'report' | 'cancelled'; summary?: string; results: ResultRecord[]; title?: string; survivors?: number }`
  - `class AlderTests { readonly controller: vscode.TestController; readonly survivorDiagnostics: vscode.DiagnosticCollection; constructor(deps: Deps); register(context: vscode.ExtensionContext): void; discoverAll(): Promise<void>; execute(request: vscode.TestRunRequest, mode: Mode, token: vscode.CancellationToken): Promise<RunOutcome[]>; runActive(mode: Mode): Promise<RunOutcome[] | undefined>; runAtCursor(): Promise<RunOutcome[] | undefined>; item(id: string): vscode.TestItem | undefined }`
  - Commands `alder.test.run`, `alder.test.mutate` → `runActive('test' | 'mutate')`; `alder.test.runAtCursor` → `runAtCursor()`. Each returns its outcomes.
  - `Api.tests: AlderTests`.

- [ ] **Step 1: Write the failing contract tests**

`test/e2e/tests.e2e.ts`:

```ts
import * as assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { RunOutcome } from '../../src/tests';
import { api, at, file, open, revert, until, ws } from './helpers';

const demo = () => join(ws(), 'demo');
const id = (...parts: string[]) => [demo(), ...parts].join('\0');

describe('the Test Explorer', () => {
  it('discovers each root\'s modules and tests at their lines', async () => {
    await open('demo/app/Demo.alder');
    const t = (await api()).tests;
    await t.discoverAll();
    const mod = t.item(id('Demo'));
    assert.ok(mod, 'no Demo module item');
    assert.equal(mod.label, 'Demo');
    assert.equal(t.item(id('Demo', 'answer is positive'))?.range?.start.line, 5);
    assert.equal(t.item(id('Demo', 'answer is 42'))?.range?.start.line, 7);
    assert.ok(t.item([join(ws(), 'blog'), 'Write', 'a taken slug is refused'].join('\0')), 'the blog\'s tests are missing');
  });

  it('Run Tests runs the root; the failure carries right as expected and left as actual', async () => {
    await open('demo/app/Demo.alder');
    const [o] = await vscode.commands.executeCommand<RunOutcome[]>('alder.test.run');
    assert.equal(o.kind, 'results', JSON.stringify(o));
    assert.match(o.summary ?? '', /^\d+ passed, 1 failed$/);
    const fail = o.results.find(r => r.id === id('Demo', 'answer is 42'));
    assert.deepEqual(fail && { ok: fail.ok, expected: fail.expected, actual: fail.actual }, { ok: false, expected: '42', actual: '41' });
    assert.ok(o.results.find(r => r.id === id('Demo', 'answer is positive'))?.ok);
  });

  it('Run Test at Cursor runs only the test above the cursor', async () => {
    const editor = await open('demo/app/Demo.alder');
    const p = at(editor.document, 'answer > 0');
    editor.selection = new vscode.Selection(p, p);
    const [o] = await vscode.commands.executeCommand<RunOutcome[]>('alder.test.runAtCursor');
    assert.equal(o.kind, 'results', JSON.stringify(o));
    assert.deepEqual(o.results.map(r => [r.id, r.ok]), [[id('Demo', 'answer is positive'), true]]);
  });

  it('an unsaved broken edit is saved first, and the run errors with "the app does not check"', async () => {
    const editor = await open('demo/app/Demo.alder');
    const doc = editor.document;
    const original = doc.getText();
    try {
      const edit = new vscode.WorkspaceEdit();
      const p = at(doc, '40 + 1');
      edit.replace(doc.uri, new vscode.Range(p, p.translate(0, '40 + 1'.length)), '"x"');
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.ok(doc.isDirty);
      const [o] = await vscode.commands.executeCommand<RunOutcome[]>('alder.test.run');
      assert.equal(o.kind, 'compile', JSON.stringify(o));
      assert.equal(o.results.length, 0);
      assert.ok(!doc.isDirty, 'the document was not saved before the run');
    } finally {
      const restore = new vscode.WorkspaceEdit();
      restore.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), original);
      await vscode.workspace.applyEdit(restore);
      await doc.save();
      await revert(doc);
    }
  });

  it('a second run of the same root cancels the first', async () => {
    await open('demo/app/Demo.alder');
    const t = (await api()).tests;
    const root = t.item(demo());
    assert.ok(root);
    const req = () => new vscode.TestRunRequest([root]);
    const first = t.execute(req(), 'test', new vscode.CancellationTokenSource().token);
    const second = t.execute(req(), 'test', new vscode.CancellationTokenSource().token);
    const [[a], [b]] = await Promise.all([first, second]);
    assert.equal(a.kind, 'cancelled', JSON.stringify(a));
    assert.equal(b.kind, 'results', JSON.stringify(b));
  });

  it('mutation testing a passing test puts the survivors in Problems', async function () {
    this.timeout(180_000);
    await open('demo/app/Demo.alder');
    const t = (await api()).tests;
    const item = t.item(id('Demo', 'answer is positive'));
    assert.ok(item);
    const [o] = await t.execute(new vscode.TestRunRequest([item]), 'mutate', new vscode.CancellationTokenSource().token);
    assert.equal(o.kind, 'results', JSON.stringify(o));
    assert.ok((o.survivors ?? 0) > 0, JSON.stringify(o));
    assert.match(o.title ?? '', /^alder test --mutate — \d+ killed, \d+ survived \(\d\.\d\d\)$/);
    const home = file('demo/app/Home.alder');
    const diags = await until(() => {
      const ds = t.survivorDiagnostics.get(home) ?? [];
      return ds.length > 0 ? ds : undefined;
    }, 'survivor diagnostics');
    assert.ok(diags.every(d => d.message.startsWith('survived  ') && d.severity === vscode.DiagnosticSeverity.Warning && d.source === 'alder mutate'));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `ALDER_E2E_ONLY=tests ALDER_BIN=… ALDER_REPO=… npm run test:e2e`
Expected: FAIL (compile error: `../../src/tests` does not exist).

- [ ] **Step 3: Implement `src/tests.ts`**

```ts
import { basename, join, sep } from 'node:path';
import * as vscode from 'vscode';
// runCli: `run` is the TestRun throughout this file
import { run as runCli } from './cli';
import { cliEnv, Deps } from './deps';
import { requireRoot } from './project';
import { showReport } from './report';
import { findRoot, realRoot } from './root';
import {
  classify, discover, label, messageText, Mode, mutateTitle, resultsOf, runPattern, scoreOf, summary,
  survivors, survivorText, testAt, TestResult,
} from './testModel';

export interface ResultRecord { id: string; ok: boolean; message?: string; expected?: string; actual?: string }

// RunOutcome is what a run did for one root; the contract tests read it (the Test Explorer's
// own results are not readable through the stable API).
export interface RunOutcome {
  root: string;
  kind: 'results' | 'compile' | 'report' | 'cancelled';
  summary?: string;
  results: ResultRecord[];
  title?: string;
  survivors?: number;
}

interface Meta { real: string; root: string; module?: string; name?: string }

interface Scope { real: string; root: string; rootItem: vscode.TestItem; pattern?: string; leaves: vscode.TestItem[] }

const SEP = '\0';

// AlderTests is the Test Explorer: one controller, items `root › Module › "name"` found by
// regex over app/**/*.alder (the server has no test listing) and corrected by each run's
// results; a Run profile (`alder test --json`) and a Mutation testing profile
// (`alder test --mutate --json`, survivors as warnings in Problems).
export class AlderTests {
  readonly controller = vscode.tests.createTestController('alder', 'Alder');
  readonly survivorDiagnostics = vscode.languages.createDiagnosticCollection('alder mutate');
  private meta = new WeakMap<vscode.TestItem, Meta>();
  // the module item each file holds, by file uri, so an edit replaces it
  private moduleOfFile = new Map<string, string>();
  // the survivors' files per real root, so a mutation run clears its root's warnings
  private survivorFiles = new Map<string, vscode.Uri[]>();
  // the run in flight per real root and mode; a newer one aborts it
  private inFlight = new Map<string, AbortController>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly deps: Deps) {
    this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run,
      (req, token) => { void this.execute(req, 'test', token); }, true);
    this.controller.createRunProfile('Mutation testing', vscode.TestRunProfileKind.Run,
      (req, token) => { void this.execute(req, 'mutate', token); }, false);
    this.controller.resolveHandler = async item => { if (!item) await this.discoverAll(); };
    this.controller.refreshHandler = () => this.discoverAll();
  }

  register(context: vscode.ExtensionContext): void {
    const watcher = vscode.workspace.createFileSystemWatcher('**/app/**/*.alder');
    context.subscriptions.push(
      this.controller, this.survivorDiagnostics, watcher,
      watcher.onDidCreate(uri => void this.discoverFile(uri)),
      watcher.onDidChange(uri => void this.discoverFile(uri)),
      watcher.onDidDelete(uri => this.dropFile(uri)),
      vscode.workspace.onDidChangeTextDocument(e => {
        const doc = e.document;
        if (doc.languageId !== 'alder' || doc.uri.scheme !== 'file') return;
        const key = doc.uri.toString();
        clearTimeout(this.timers.get(key));
        this.timers.set(key, setTimeout(() => { this.timers.delete(key); void this.discoverFile(doc.uri, doc.getText()); }, 300));
      }),
      { dispose: () => { for (const t of this.timers.values()) clearTimeout(t); } },
    );
    void this.discoverAll();
  }

  item(id: string): vscode.TestItem | undefined {
    const parts = id.split(SEP);
    let item = this.controller.items.get(parts[0]);
    for (let i = 1; item && i < parts.length; i++) item = item.children.get(parts.slice(0, i + 1).join(SEP));
    return item;
  }

  async discoverAll(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/app/**/*.alder', '**/{node_modules,build,.git}/**');
    this.controller.items.replace([]);
    this.moduleOfFile.clear();
    for (const uri of files) await this.discoverFile(uri);
  }

  private async rootItem(root: string, real: string): Promise<vscode.TestItem> {
    let item = this.controller.items.get(real);
    if (!item) {
      item = this.controller.createTestItem(real, basename(real), vscode.Uri.file(real));
      this.meta.set(item, { real, root });
      this.controller.items.add(item);
    }
    return item;
  }

  private moduleItem(rootItem: vscode.TestItem, module: string, uri: vscode.Uri | undefined): vscode.TestItem {
    const m = this.meta.get(rootItem)!;
    const id = [m.real, module].join(SEP);
    let item = rootItem.children.get(id);
    if (!item) {
      item = this.controller.createTestItem(id, module, uri);
      this.meta.set(item, { ...m, module });
      rootItem.children.add(item);
    }
    return item;
  }

  private testItem(moduleItem: vscode.TestItem, name: string, uri: vscode.Uri | undefined, line: number | undefined): vscode.TestItem {
    const m = this.meta.get(moduleItem)!;
    const id = [m.real, m.module!, name].join(SEP);
    let item = moduleItem.children.get(id);
    if (!item) {
      item = this.controller.createTestItem(id, name, uri);
      this.meta.set(item, { ...m, name });
      moduleItem.children.add(item);
    }
    if (line !== undefined && line >= 0) item.range = new vscode.Range(line, 0, line, 0);
    return item;
  }

  // discoverFile (re)reads one file's module and tests; text is the open document's, else disk's.
  private async discoverFile(uri: vscode.Uri, text?: string): Promise<void> {
    const root = await findRoot(uri.fsPath);
    if (!root || !uri.fsPath.startsWith(join(root, 'app') + sep)) return;
    const real = await realRoot(root);
    if (text === undefined) {
      try {
        text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        return this.dropFile(uri);
      }
    }
    this.dropFile(uri);
    const found = discover(text);
    if (!found || found.tests.length === 0) return;
    const rootItem = await this.rootItem(root, real);
    const mod = this.moduleItem(rootItem, found.module, uri);
    mod.children.replace([]);
    for (const t of found.tests) this.testItem(mod, t.name, uri, t.line);
    this.moduleOfFile.set(uri.toString(), mod.id);
  }

  private dropFile(uri: vscode.Uri): void {
    const id = this.moduleOfFile.get(uri.toString());
    if (!id) return;
    this.moduleOfFile.delete(uri.toString());
    const rootId = id.split(SEP)[0];
    this.controller.items.get(rootId)?.children.delete(id);
  }

  private rootOf(item: vscode.TestItem): vscode.TestItem {
    let i = item;
    while (i.parent) i = i.parent;
    return i;
  }

  private leaves(item: vscode.TestItem, out: vscode.TestItem[] = []): vscode.TestItem[] {
    if (this.meta.get(item)?.name !== undefined) out.push(item);
    else item.children.forEach(c => this.leaves(c, out));
    return out;
  }

  // scopes groups a request by root: the whole root (no -run) when the root itself is included
  // and nothing is excluded, else one -run alternation of the included modules and tests (the
  // exact tests left when some are excluded).
  private scopes(request: vscode.TestRunRequest): Scope[] {
    const include: vscode.TestItem[] = [];
    if (request.include) include.push(...request.include);
    else this.controller.items.forEach(i => include.push(i));
    const excluded = new Set((request.exclude ?? []).flatMap(e => [e.id, ...this.leaves(e).map(l => l.id)]));
    const byRoot = new Map<string, vscode.TestItem[]>();
    for (const i of include) {
      const r = this.rootOf(i);
      byRoot.set(r.id, [...(byRoot.get(r.id) ?? []), i]);
    }
    const out: Scope[] = [];
    for (const [rid, items] of byRoot) {
      const rootItem = this.controller.items.get(rid)!;
      const m = this.meta.get(rootItem)!;
      const leaves = [...new Set(items.flatMap(i => this.leaves(i)))].filter(l => !excluded.has(l.id));
      let pattern: string | undefined;
      if (excluded.size > 0) {
        if (leaves.length === 0) continue;
        pattern = leaves.map(l => { const lm = this.meta.get(l)!; return runPattern(lm.module!, lm.name); }).join('|');
      } else if (!items.includes(rootItem)) {
        pattern = items.map(i => { const im = this.meta.get(i)!; return runPattern(im.module!, im.name); }).join('|');
      }
      out.push({ real: m.real, root: m.root, rootItem, pattern, leaves });
    }
    return out;
  }

  async execute(request: vscode.TestRunRequest, mode: Mode, token: vscode.CancellationToken): Promise<RunOutcome[]> {
    const run = this.controller.createTestRun(request, label(mode));
    const outcomes: RunOutcome[] = [];
    try {
      for (const scope of this.scopes(request)) outcomes.push(await this.runRoot(run, scope, mode, token));
    } finally {
      run.end();
    }
    return outcomes;
  }

  // saveUnder saves the dirty alder documents under the root (the run reads disk) and returns
  // the paths of those it could not save.
  private async saveUnder(real: string): Promise<string[]> {
    const failed: string[] = [];
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId !== 'alder' || doc.uri.scheme !== 'file' || !doc.isDirty) continue;
      const r = await findRoot(doc.uri.fsPath);
      if (!r || (await realRoot(r)) !== real) continue;
      const ok = await doc.save();
      if (!ok || doc.isDirty) failed.push(vscode.workspace.asRelativePath(doc.uri));
    }
    return failed;
  }

  private async runRoot(run: vscode.TestRun, scope: Scope, mode: Mode, token: vscode.CancellationToken): Promise<RunOutcome> {
    const title = label(mode);
    const key = scope.real + SEP + mode;
    const prev = this.inFlight.get(key);
    if (prev) {
      prev.abort();
      void vscode.window.showWarningMessage(`${title}: the earlier run was cancelled`);
    }
    const ac = new AbortController();
    this.inFlight.set(key, ac);
    const sub = token.onCancellationRequested(() => ac.abort());
    const outcome: RunOutcome = { root: scope.root, kind: 'report', results: [] };
    try {
      for (const l of scope.leaves) run.enqueued(l);
      const unsaved = await this.saveUnder(scope.real);
      if (unsaved.length > 0) {
        const msg = `${title}: not written, the run reads disk: ${unsaved.join(', ')}`;
        void vscode.window.showWarningMessage(msg);
        run.appendOutput(msg + '\r\n');
      }
      const bin = await this.deps.clients.binary();
      if (!bin) {
        run.errored(scope.rootItem, new vscode.TestMessage('the alder binary failed its check — Alder: Show Health'));
        return outcome;
      }
      const args = mode === 'mutate' ? ['test', '--mutate', '--json'] : ['test', '--json'];
      if (scope.pattern) args.push('-run', scope.pattern);
      args.push(...vscode.workspace.getConfiguration('alder').get<string[]>('test.args', []), scope.real);
      for (const l of scope.leaves) run.started(l);
      if (mode === 'mutate') this.clearSurvivors(scope.real);
      const res = await runCli(bin, args, { cwd: scope.real, env: cliEnv(), signal: ac.signal });
      if (ac.signal.aborted) {
        for (const l of scope.leaves) run.skipped(l);
        run.appendOutput(`${title}: cancelled\r\n`);
        outcome.kind = 'cancelled';
        return outcome;
      }
      const kind = classify(res, mode);
      if (kind === 'compile') {
        for (const l of scope.leaves) run.skipped(l);
        run.errored(scope.rootItem, new vscode.TestMessage('the app does not check'));
        void vscode.window.showErrorMessage(`${title}: the app does not check`);
        outcome.kind = 'compile';
        return outcome;
      }
      if (kind === 'report') {
        for (const l of scope.leaves) run.skipped(l);
        const text = (res.stderr.trim() || res.stdout.trim() || `${title} failed`).split('\n')[0];
        run.errored(scope.rootItem, new vscode.TestMessage(text));
        await showReport(this.deps, args, res);
        return outcome;
      }
      const results = resultsOf(res.objects);
      const seen = new Set<string>();
      for (const r of results) outcome.results.push(this.apply(run, scope, r, seen));
      for (const l of scope.leaves) if (!seen.has(l.id)) run.skipped(l);
      outcome.kind = 'results';
      outcome.summary = summary(results);
      run.appendOutput(outcome.summary + '\r\n');
      if (mode === 'mutate') {
        const score = scoreOf(res.objects)!;
        const found = survivors(res.objects);
        this.setSurvivors(scope.real, found);
        outcome.title = mutateTitle(score);
        outcome.survivors = found.length;
        run.appendOutput(outcome.title + '\r\n');
        if (found.length > 0) void vscode.window.showWarningMessage(outcome.title);
        else void vscode.window.showInformationMessage(`${outcome.title}: no survivors`);
      }
      return outcome;
    } finally {
      sub.dispose();
      if (this.inFlight.get(key) === ac) this.inFlight.delete(key);
    }
  }

  // apply marks one result, creating its module and test items when discovery missed them, and
  // moving a test to the line the run reports.
  private apply(run: vscode.TestRun, scope: Scope, r: TestResult, seen: Set<string>): ResultRecord {
    const positioned = !!r.file && (r.line ?? 0) > 0;
    const uri = r.file ? vscode.Uri.file(join(scope.real, r.file)) : undefined;
    const mod = this.moduleItem(scope.rootItem, r.module, uri);
    const item = this.testItem(mod, r.name, uri, positioned ? r.line! - 1 : undefined);
    seen.add(item.id);
    if (r.ok) {
      run.passed(item, r.ms);
      return { id: item.id, ok: true };
    }
    const text = messageText(r);
    const sides = r.left !== undefined || r.right !== undefined;
    // alder tests read `computed == wanted`: right is expected, left actual
    const msg = sides ? vscode.TestMessage.diff(text, r.right ?? '', r.left ?? '') : new vscode.TestMessage(text);
    if (positioned && uri) msg.location = new vscode.Location(uri, new vscode.Position(r.line! - 1, Math.max((r.col ?? 1) - 1, 0)));
    run.failed(item, msg, r.ms);
    return { id: item.id, ok: false, message: text, expected: sides ? r.right ?? '' : undefined, actual: sides ? r.left ?? '' : undefined };
  }

  private clearSurvivors(real: string): void {
    for (const uri of this.survivorFiles.get(real) ?? []) this.survivorDiagnostics.delete(uri);
    this.survivorFiles.delete(real);
  }

  private setSurvivors(real: string, found: ReturnType<typeof survivors>): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const m of found) {
      const line = Math.max((m.line ?? 1) - 1, 0);
      const col = Math.max((m.col ?? 1) - 1, 0);
      const width = (m.before ?? '').split('\n')[0].length || 1;
      const d = new vscode.Diagnostic(new vscode.Range(line, col, line, col + width), survivorText(m), vscode.DiagnosticSeverity.Warning);
      d.source = 'alder mutate';
      const f = join(real, m.file!);
      byFile.set(f, [...(byFile.get(f) ?? []), d]);
    }
    const uris: vscode.Uri[] = [];
    for (const [f, ds] of byFile) {
      const uri = vscode.Uri.file(f);
      this.survivorDiagnostics.set(uri, ds);
      uris.push(uri);
    }
    this.survivorFiles.set(real, uris);
  }

  // runActive runs the active project's whole root (Run Tests, Mutation Testing).
  async runActive(mode: Mode): Promise<RunOutcome[] | undefined> {
    const root = await requireRoot(this.deps.clients);
    if (!root) return undefined;
    const rootItem = await this.rootItem(root, await realRoot(root));
    return this.execute(new vscode.TestRunRequest([rootItem]), mode, new vscode.CancellationTokenSource().token);
  }

  // runAtCursor runs the test above the cursor, else the file's module, else (no module line)
  // the whole root.
  async runAtCursor(): Promise<RunOutcome[] | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'alder' || editor.document.uri.scheme !== 'file') return this.runActive('test');
    const doc = editor.document;
    const found = discover(doc.getText());
    if (!found) {
      void vscode.window.showWarningMessage('alder test: no `module` line in this file; running every test');
      return this.runActive('test');
    }
    const root = await findRoot(doc.uri.fsPath);
    if (!root) return this.runActive('test');
    const rootItem = await this.rootItem(root, await realRoot(root));
    const mod = this.moduleItem(rootItem, found.module, doc.uri);
    const name = testAt(doc.getText(), editor.selection.active.line);
    if (name === undefined) void vscode.window.showInformationMessage(`alder test: no test above the cursor; running ${found.module}'s tests`);
    const item = name === undefined ? mod : this.testItem(mod, name, doc.uri, found.tests.find(t => t.name === name)?.line);
    return this.execute(new vscode.TestRunRequest([item]), 'test', new vscode.CancellationTokenSource().token);
  }
}
```

Notes for the implementer:
- `runRoot` aborts the older run for the same root and mode synchronously, before its first `await`, so of two runs started back to back the first is the one cancelled (the contract test relies on it). Test and mutate runs of one root do not cancel each other (test.lua: they build in separate directories).
- A module item for a module with no discovered tests is created only by a run's results or by `runAtCursor` (an empty module item in the tree is harmless; it fills on the run).

- [ ] **Step 4: Wire it**

`src/commands.ts`: drop the three `alder.test.*` lines from `NOT_YET`. `src/extension.ts`:

```ts
  const tests = new AlderTests(deps);
  tests.register(context);
```

and in the subscriptions list:

```ts
    vscode.commands.registerCommand('alder.test.run', () => tests.runActive('test')),
    vscode.commands.registerCommand('alder.test.runAtCursor', () => tests.runAtCursor()),
    vscode.commands.registerCommand('alder.test.mutate', () => tests.runActive('mutate')),
```

`Api` gains `tests: AlderTests;` and the returned object `tests`.

`package.json` `activationEvents`:

```json
  "activationEvents": [
    "onLanguage:alder",
    "workspaceContains:**/app/**/*.alder"
  ],
```

- [ ] **Step 5: Run the tests**

Run: `npm run lint && npm run test:unit && ALDER_E2E_ONLY=tests ALDER_BIN=… ALDER_REPO=… npm run test:e2e`
Expected: PASS. Then the whole contract suite once (`ALDER_E2E_ONLY` unset): the explain, routes, run and existing M3 tests must still pass with the demo app in the workspace (the M3 health test asserts `/blog` and `/fill`; a third root does not break it).

- [ ] **Step 6: Commit**

```bash
git add src test package.json
git commit -m "tests: Test Explorer with run and mutation profiles, survivors in Problems"
```

---

### Task 7: docs, the whole suite, the PR

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: README**

Add, after "## Settings" and before "## Fill with AI":

```markdown
## Commands

All under "Alder" in the command palette; the chord is `ctrl+alt+a` (`cmd+alt+a` on macOS).

- **Routes** (`u`): the app's pages and messages; pick one to open its declaration.
- **Run the App** (`r`): `alder run` in a terminal at the app root, reused while it is open.
- **Explain Diagnostic** (`e`): the explanation of the diagnostic under the cursor (or a code you
  type) in a markdown preview.
- **Run Tests** (`t`), **Run Test at Cursor** (`shift+t`), **Mutation Testing** (`m`): also in the
  Test Explorer, where "Mutation testing" is a second run profile. Unsaved `.alder` files of the
  app are saved first (the tests read disk). A failing test shows its two sides as a diff, the
  right side as expected; mutants that survive are warnings in Problems until the next mutation
  run. `alder.test.args` is added to every run.
```

- [ ] **Step 2: CHANGELOG**

Under the unreleased heading (create `## Unreleased` at the top if it is missing), add:

```markdown
- Routes, Run the App, Explain Diagnostic, and the Test Explorer with run and mutation-testing
  profiles (alder#144 milestone 4).
```

- [ ] **Step 3: The whole suite**

Run, in the foreground with a 10-minute timeout: `npm run lint && npm run test:unit && ALDER_BIN=… ALDER_REPO=… npm run test:e2e && npm run package`
Expected: all green, a `.vsix` built. Paste the counts (unit n/n, e2e n/n) into the PR description. Delete the `.vsix` (it is git-ignored, but keep the tree tidy).

- [ ] **Step 4: Commit, push, PR**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: the milestone 4 commands"
git push -u origin routes-run-explain-tests
gh pr create -R tapegram/alder-vscode --title "Routes, run, explain, tests (alder#144 M4)" --body-file <body>
```

The body: what each command does, the five deviations from Global Constraints (numbered as there), the test counts, and that it is tapegram/alder#144 milestone 4. End it with the attribution lines the session's system reminder gives. Wait for CI (ubuntu stable, macOS stable, ubuntu 1.91.0) to go green before calling it done.
