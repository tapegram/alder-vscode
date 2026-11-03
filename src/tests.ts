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

// VS Code reserves \0 in TestItem ids (it joins the ids of an item's ancestors with it), and an
// item's id need only be unique among its siblings: so each item's own id is its last part (the
// real root, the module, the test name) and the \0-joined path is the id this file hands out.

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
    for (let i = 1; item && i < parts.length; i++) item = item.children.get(parts[i]);
    return item;
  }

  // idOf is an item's path id: `<real root>[\0<Module>[\0<name>]]`.
  private idOf(item: vscode.TestItem): string {
    const m = this.meta.get(item)!;
    return [m.real, ...(m.module === undefined ? [] : [m.module]), ...(m.name === undefined ? [] : [m.name])].join(SEP);
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
    let item = rootItem.children.get(module);
    if (!item) {
      item = this.controller.createTestItem(module, module, uri);
      this.meta.set(item, { ...m, module });
      rootItem.children.add(item);
    }
    return item;
  }

  private testItem(moduleItem: vscode.TestItem, name: string, uri: vscode.Uri | undefined, line: number | undefined): vscode.TestItem {
    const m = this.meta.get(moduleItem)!;
    let item = moduleItem.children.get(name);
    if (!item) {
      item = this.controller.createTestItem(name, name, uri);
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
    this.moduleOfFile.set(uri.toString(), this.idOf(mod));
  }

  private dropFile(uri: vscode.Uri): void {
    const id = this.moduleOfFile.get(uri.toString());
    if (!id) return;
    this.moduleOfFile.delete(uri.toString());
    const [rootId, module] = id.split(SEP);
    this.controller.items.get(rootId)?.children.delete(module);
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
    const excluded = new Set((request.exclude ?? []).flatMap(e => [e, ...this.leaves(e)]));
    const byRoot = new Map<string, vscode.TestItem[]>();
    for (const i of include) {
      const r = this.rootOf(i);
      byRoot.set(r.id, [...(byRoot.get(r.id) ?? []), i]);
    }
    const out: Scope[] = [];
    for (const [rid, items] of byRoot) {
      const rootItem = this.controller.items.get(rid)!;
      const m = this.meta.get(rootItem)!;
      const leaves = [...new Set(items.flatMap(i => this.leaves(i)))].filter(l => !excluded.has(l));
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
      // the root as `.` (cwd is the root): alder globs migrations/*.sql under the path it is
      // given unescaped, so an absolute root holding a glob metacharacter ([, *, ?) finds none
      args.push(...vscode.workspace.getConfiguration('alder').get<string[]>('test.args', []), '.');
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
      for (const l of scope.leaves) if (!seen.has(this.idOf(l))) run.skipped(l);
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
    const id = this.idOf(item);
    seen.add(id);
    if (r.ok) {
      run.passed(item, r.ms);
      return { id, ok: true };
    }
    const text = messageText(r);
    const sides = r.left !== undefined || r.right !== undefined;
    // alder tests read `computed == wanted`: right is expected, left actual
    const msg = sides ? vscode.TestMessage.diff(text, r.right ?? '', r.left ?? '') : new vscode.TestMessage(text);
    if (positioned && uri) msg.location = new vscode.Location(uri, new vscode.Position(r.line! - 1, Math.max((r.col ?? 1) - 1, 0)));
    run.failed(item, msg, r.ms);
    return { id, ok: false, message: text, expected: sides ? r.right ?? '' : undefined, actual: sides ? r.left ?? '' : undefined };
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
