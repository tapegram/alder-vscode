import * as assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import * as vscode from 'vscode';
import type { Generator } from '../../src/generate/types';
import { api, decode, until } from './helpers';

// dogfood: run by `ALDER_DOGFOOD_ROOT=<app> npm run test:e2e` (run.ts copies the app); skips itself otherwise.
const app = process.env.ALDER_DOGFOOD_APP;

interface FileReport { file: string; tokensMs: number; tokens: number; folds: number }
interface Report {
  app: string; alder: string; vscode: string; health: string[];
  check: { exit: number | null; out: string };
  files: FileReport[];
  errors: string[];          // alder Error diagnostics after the settle: "file:line: message"
  routes: { lsp: number | string; cli: number | string };
  tests: { discovered: number; results: number; failed: string[]; outcome: string };
  generators: { file: string; count: number; here: number } | string;
  scratch: { ms: number; hints: string[] } | string;
  failures: string[];        // what the pass treats as broken
}

function alderFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    return e.isDirectory() ? alderFiles(p) : e.name.endsWith('.alder') ? [p] : [];
  }).sort();
}

describe('dogfood', function () {
  this.timeout(1_800_000);
  before(function () { if (!app) this.skip(); });

  it('runs the extension over a real app and writes the report', async () => {
    const root = app!;
    const bin = process.env.ALDER_DOGFOOD_BIN!;
    const a = await api();
    const r: Report = {
      app: root, alder: execFileSync(bin, ['version'], { encoding: 'utf8' }).trim(), vscode: vscode.version,
      health: [], check: { exit: null, out: '' }, files: [], errors: [],
      routes: { lsp: 0, cli: 0 }, tests: { discovered: 0, results: 0, failed: [], outcome: '' },
      generators: '', scratch: '', failures: [],
    };
    const soft = async (what: string, f: () => Promise<void>) => {
      try { await f(); } catch (e) { r.failures.push(`${what}: ${(e as Error).message}`); }
    };

    const out = process.env.ALDER_DOGFOOD_OUT!;
    const write = () => {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(r, null, 2));
    };

    // a binary the extension refuses (no `lsp`) would only time out file by file: report it at once
    const gate = await a.clients.checkGate();
    if (!gate.ok) {
      await soft('health', async () => { r.health = await a.health(); });
      r.failures.push(`the extension refuses ${bin}: ${gate.problem}`);
      write();
      assert.deepEqual(r.failures, [], `see ${out}`);
    }

    const chk = spawnSync(bin, ['check'], { cwd: root, encoding: 'utf8' });
    r.check = { exit: chk.status, out: (chk.stdout + chk.stderr).trim().split('\n').slice(0, 20).join('\n') };

    // every file: open, time to the first non-empty tokens, folding ranges
    for (const f of alderFiles(join(root, 'app'))) {
      await soft(relative(root, f), async () => {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(f));
        await vscode.window.showTextDocument(doc, { preview: false });
        await until(async () => a.clients.ensure(doc), 'a client', 60_000);
        const t0 = Date.now();
        const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>('vscode.provideDocumentSemanticTokensLegend', doc.uri);
        const toks = await until(async () => {
          const s = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentSemanticTokens', doc.uri);
          return s && s.data.length > 0 ? s : undefined;
        }, 'tokens', 60_000);
        const folds = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', doc.uri);
        r.files.push({ file: relative(root, f), tokensMs: Date.now() - t0, tokens: decode(toks.data, legend).length, folds: folds?.length ?? 0 });
      });
    }
    await soft('health', async () => { r.health = await a.health(); });

    // diagnostics after the server has had time to build the whole app
    await soft('diagnostics', async () => {
      await new Promise(res => setTimeout(res, 10_000));
      for (const [uri, ds] of vscode.languages.getDiagnostics()) {
        for (const d of ds) {
          if (d.source === 'alder' && d.severity === vscode.DiagnosticSeverity.Error) {
            r.errors.push(`${relative(root, uri.fsPath)}:${d.range.start.line + 1}: ${d.message.split('\n')[0]}`);
          }
        }
      }
      if (r.check.exit === 0 && r.errors.length) throw new Error(`alder check passes but the editor shows ${r.errors.length} errors`);
      if (r.check.exit !== 0 && !r.errors.length) throw new Error('alder check fails but the editor shows no errors');
    });

    await soft('routes', async () => {
      const lsp = await until(async () => { const g = await a.routes.fetch(root); return 'routes' in g && g.routes.length ? g : undefined; }, 'routes', 120_000);
      const cli = await a.routes.fetchCli(root);
      r.routes = { lsp: lsp.routes.length, cli: 'routes' in cli ? cli.routes.length : cli.error };
      if (r.routes.lsp !== r.routes.cli) throw new Error(`server lists ${r.routes.lsp}, CLI ${r.routes.cli}`);
    });

    await soft('tests', async () => {
      await a.tests.discoverAll();
      const leaves: string[] = [];
      const walk = (items: vscode.TestItemCollection): void => items.forEach(i => { if (i.children.size) walk(i.children); else leaves.push(i.id); });
      walk(a.tests.controller.items);
      r.tests.discovered = leaves.length;
      const cts = new vscode.CancellationTokenSource();
      const outs = await a.tests.execute(new vscode.TestRunRequest(), 'test', cts.token);
      r.tests.outcome = outs.map(o => `${o.kind}${o.summary ? ` (${o.summary})` : ''}`).join('; ');
      const results = outs.flatMap(o => o.results);
      r.tests.results = results.length;
      r.tests.failed = results.filter(x => !x.ok).map(x => `${x.id.split('\0').slice(1).join(' ')}: ${x.message ?? ''}`);
      if (outs.some(o => o.kind !== 'results')) throw new Error(`run ended as ${r.tests.outcome}`);
      if (r.tests.results !== r.tests.discovered) throw new Error(`discovered ${r.tests.discovered}, results for ${r.tests.results}`);
    });

    await soft('generators', async () => {
      // the first page module: the generators that apply at its first line (flow.ts's params())
      const page = r.files.map(f => join(root, f.file)).find(f => /^page\b/m.test(readFileSync(f, 'utf8')));
      if (!page) throw new Error('no page module');
      const client = await a.clients.forUri(vscode.Uri.file(page));
      const res = await client!.sendRequest<{ generators?: Generator[] | null } | null>('alder/generators', {
        textDocument: { uri: vscode.Uri.file(page).toString() }, position: { line: 0, character: 0 },
      });
      const gens = res?.generators ?? [];
      r.generators = { file: relative(root, page), count: gens.length, here: gens.filter(g => g.here).length };
      if (!gens.length) throw new Error('the server lists no generators');
    });

    await soft('scratch', async () => {
      const t0 = Date.now();
      const ed = await a.scratch.open();
      const doc = ed!.document;
      const hints = await until(async () => {
        const hs = await vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', doc.uri, new vscode.Range(0, 0, doc.lineCount, 0));
        const ls = (hs ?? []).map(h => (typeof h.label === 'string' ? h.label : h.label.map(p => p.value).join('')));
        return ls.includes('⇒ 2 : Int') ? ls : undefined;
      }, 'the template watch ⇒ 2 : Int', 600_000);
      r.scratch = { ms: Date.now() - t0, hints };
    });

    write();
    assert.deepEqual(r.failures, [], `see ${out}`);
  });
});
