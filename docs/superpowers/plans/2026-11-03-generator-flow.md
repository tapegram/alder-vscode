# Generator flow Implementation Plan (alder#144 milestone 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Alder: Generate` (and the server's generator code actions) opens a multi-step quick input beside a live diff preview, with a review step, and applies the plan as one undoable `WorkspaceEdit`. It ports alder.nvim's generator modal.

**Architecture:** The pure modules (`form`, `picker`, `preview`, `review`, `planCheck`, `entry`) are ports of alder.nvim's `form.lua`, `picker.lua`, `preview.lua`, `review.lua` and the pure half of `apply.lua`. None of them imports `vscode`. `flow.ts` is the state machine ported from `modal.lua` (the sequence counter, debounce, enter rules, review drop). It does not import `vscode` either: it talks to a `Server`, a `FlowUi`, a `PreviewSink` and an `apply` callback, so node unit tests drive it end to end with fakes. The VS Code side is thin: `ui.ts` (the quick inputs), `previewDoc.ts`, `origin.ts`, `apply.ts` (the `WorkspaceEdit`) and `command.ts` (wiring).

**Tech Stack:** TypeScript 5.9, VS Code API ^1.91 (`@types/vscode` 1.91.0), vscode-languageclient 11, node:test (unit), mocha + @vscode/test-electron (e2e), esbuild.

**Spec:** tapegram/alder `docs/superpowers/specs/2026-11-01-vscode-extension-design.md`, section "The generator flow (`src/generate/`)", "Extension tests" and milestone 5. To read it: `git -C ~/projects/alder show origin/main:docs/superpowers/specs/2026-11-01-vscode-extension-design.md`. The nvim originals live in `~/projects/alder.nvim/lua/alder/{form,picker,preview,review,apply,modal,project}.lua` and their specs in `~/projects/alder.nvim/tests/`.

## Global Constraints

- `engines.vscode` stays `^1.91.0`. Use no proposed API: `QuickPick.sortByLabel` is proposed, so leave it out. With an empty filter the QuickPick keeps the server's order anyway.
- No new runtime or dev dependencies.
- `src/generate/{types,form,picker,preview,review,planCheck,entry,flow}.ts` must not import `vscode` (the spec: "form.ts, picker.ts, preview.ts and review.ts do not import vscode so a webview could reuse them").
- Never reword the compiler: server text (`error`, `why`, diagnostics) is shown as sent.
- Message strings (exact): `alder: no generators`; `alder: applied <id>: <path>, <path>` plus ` (1 hole)` or ` (<n> holes)` when there are holes; `alder: <path> changed since planning; nothing applied`; `Delete <path> from disk? undo cannot restore it` with the action `Delete`; `alder: nothing to change`; `alder: no .alder file under app/`; `the preview failed: <message>` (inside the preview).
- The preview debounce is 80 ms (`DEBOUNCE_MS`).
- The sets sent to the server: the preset (the item's `sets`, overlaid by a code action's), with the typed text over that. An empty text drops the key, and the server's own values are never echoed back.
- Each commit ends with the attribution lines from the session's system reminder.
- Branch: `generator-flow` off `main` in `~/projects/alder-vscode`.
- Unit: `npm run test:unit`. E2e: `ALDER_BIN=$(go env GOPATH)/bin/alder ALDER_REPO=~/projects/alder npm run test:e2e`. Run one file with `ALDER_E2E_ONLY=generate`. Check how `test/e2e/index.ts` filters before relying on that; if it matches differently, use its rule. Lint: `npm run lint`.
- Local e2e is unreliable when the machine is loaded. On an e2e failure, check `uptime` first. When the load is above 50, rerun once before you debug.

## Review Focus

1. **A preview answer that lands after the user moved on.** This means a second keystroke, Back to the picker, a new generator, or the flow closed. The late answer must not paint the form, the preview or the text box's validation, and must not set `ready`. Task 3 pins this: tests `stale answer is dropped`, `back to the picker drops the in-flight answer` and `closed flow ignores answers`.
2. **The quick input hides for a reason other than Escape.** Focus moving to the preview, or `vscode.diff` opening beside it, is the main case. With `ignoreFocusOut` the form must stay open. Only a real hide counts as Escape, and the flow's own `close()` must never come back as an `escape` answer. Task 5 pins this with the `closing` flag and the e2e smoke `the real picker closes the flow on hide`.
3. **A file edited between planning and applying, in an open editor or only on disk.** Typing during the delete confirm is the main case. Apply must refuse with the exact message and change nothing. Task 4 pins this: `remove page re-checks after the confirm`.
4. **Escape in a field editor.** It must put back the field's previous value, typed or untouched, and re-request the preview. It must not keep the half-typed text. Task 3 pins this: `escape in the text editor restores the previous value`.
5. **A preset whose generator is not in the list,** for example a code action from an older server. Show the picker. Do not open a form for the first item. Task 3 pins this: `unknown preset shows the picker`.

---

## File Structure

| file | responsibility |
|---|---|
| `src/generate/types.ts` | wire types of `alder/generators`, `alder/preview`, `alder/plan` (from `internal/lsp/generators.go`, `internal/generate/here.go`, `holes.go`) |
| `src/generate/form.ts` | port of form.lua: visible fields, rows (value + note), sets, options, fuzzy, first invalid / to fill, module names, editor kind |
| `src/generate/picker.ts` | the picker rows with the `here` / `all` headings |
| `src/generate/preview.ts` | port of preview.lua: render, firstHunk |
| `src/generate/review.ts` | port of review.lua's `model` (the diff itself is `vscode.diff`) |
| `src/generate/planCheck.ts` | the pure half of apply.lua: staleness, the removed file, where the cursor lands, the messages |
| `src/generate/entry.ts` | the origin file of a root with no alder editor: `app/App.alder`, else the first `.alder` under `app/` |
| `src/generate/flow.ts` | the flow state machine (port of modal.lua's state): interfaces `Server`, `FlowUi`, `PreviewSink`, `FlowEnv`; class `Flow`; `asPreset` |
| `src/generate/apply.ts` | plan → staleness → confirm → one `WorkspaceEdit` → cursor + message; refusal diagnostics |
| `src/generate/ui.ts` | `quickInputUi()`: the real `FlowUi` over `createQuickPick` / `createInputBox` |
| `src/generate/previewDoc.ts` | `PreviewDoc`: the read-only diff document beside the origin |
| `src/generate/origin.ts` | `findOrigin`: the active alder editor, else the root's entry file, waiting ≤5 s for a client |
| `src/generate/command.ts` | registers `alder.generate` and `alder.generate.apply`; one active flow |
| `test/unit/{form,picker,preview,review,planCheck,entry,flow}.test.ts` | unit tests |
| `test/e2e/fakeUi.ts`, `test/e2e/generate.e2e.ts`, `test/e2e/apply.e2e.ts` | contract tests against the real server |

Modified: `src/extension.ts`, `src/commands.ts` (drop `alder.generate` from `NOT_YET`), `package.json` (command, keybinding, menus), `test/unit/legend.test.ts`, `test/e2e/run.ts` (the `gen` fixture), `README.md`, `CHANGELOG.md`.

---

### Task 1: Wire types and the form module

**Files:**
- Create: `src/generate/types.ts`, `src/generate/form.ts`
- Test: `test/unit/form.test.ts`

**Interfaces:**
- Produces (types.ts): `Sets`, `Generator`, `FieldState`, `Hole`, `PlanDiagnostic`, `PreviewFile`, `PreviewResult`, `PlanFile`, `PlanResult`, `Preset`. These are exactly as written below.
- Produces (form.ts): `NOTES`, `MODULE_EXAMPLE`, `Typed`, `FieldRow`, `EditorKind`, `visible`, `current`, `rows`, `sets`, `fuzzy`, `options`, `firstInvalid`, `firstToFill`, `exampleLine`, `editorKind`, `moduleText`, `moduleDirs`, `modulePath`, `moduleHelp`, `moduleSuggest`. Row indices are 0-based, and `undefined` means none.

- [ ] **Step 1: Create the branch**

```bash
cd ~/projects/alder-vscode && git switch main && git pull --ff-only && git switch -c generator-flow
```

- [ ] **Step 2: Write `src/generate/types.ts`** (types only, nothing to test)

```ts
// The wire types of alder/generators, alder/preview and alder/plan (alder internal/lsp/generators.go,
// internal/generate/here.go and holes.go). Go sends a nil slice as null, so lists may be null.

export type Sets = Record<string, string>;

// Generator is one item of alder/generators: here is true when it applies at the cursor, and
// sets are the values the cursor fills in.
export interface Generator { id: string; summary: string; here: boolean; why?: string; sets?: Sets }

// FieldState is one field of a preview's form. source is "here", "you", "default" or "".
export interface FieldState {
  name: string;
  kind: string; // text module page table decl fieldList type route path bool choice
  flag: boolean;
  required: boolean;
  value: string;
  source: string;
  valid: boolean;
  why?: string;
  choices?: string[];
  help: string;
  example?: string;
  agent?: boolean;
}

export interface Hole { module: string; decl: string; arm?: string; name: string; type: string; file: string; line: number; col: number }

export interface PlanDiagnostic { file: string; line: number; col: number; code: string; message: string; severity: string }

export interface PreviewFile { path: string; action: string; added: number; removed: number }

export interface PreviewResult {
  fields?: FieldState[] | null;
  files?: PreviewFile[] | null;
  diff?: string;
  warnings?: string[] | null;
  diagnostics?: PlanDiagnostic[] | null;
  holes?: Hole[] | null;
  ready?: boolean;
  error?: string;
}

// PlanFile is a file a plan changes: before is null for a created file, after null for a removed one.
export interface PlanFile { path: string; action: string; before: string | null; after: string | null }

export interface PlanResult {
  files?: PlanFile[] | null;
  diagnostics?: PlanDiagnostic[] | null;
  holes?: Hole[] | null;
  imports?: string[] | null;
  migration?: string[] | null;
  error?: string;
}

// Preset is what a code action (or a caller) opens the flow with: the generator and its values.
export interface Preset { id: string; sets?: Sets }
```

- [ ] **Step 3: Write the failing test `test/unit/form.test.ts`.** It ports `alder.nvim/tests/form_spec.lua`.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as form from '../../src/generate/form';
import type { FieldState } from '../../src/generate/types';

const f = (o: Partial<FieldState> & { name: string }): FieldState =>
  ({ kind: 'text', flag: false, required: false, value: '', source: '', valid: true, help: '', ...o });

const fields: FieldState[] = [
  f({ name: 'page', kind: 'page', required: true, value: 'Posts.Index', source: 'here', choices: ['Posts.Index', 'Posts.Show'] }),
  f({ name: 'name', required: true, valid: false, why: 'required' }),
  f({ name: 'fields', kind: 'fieldList' }),
  f({ name: 'example', kind: 'bool', flag: true, value: 'true', source: 'default' }),
];

const described: FieldState[] = [
  f({ name: 'page', kind: 'page', required: true, value: 'Posts.Index', source: 'here', help: 'the page the message belongs to', example: 'Posts.Index' }),
  f({ name: 'name', required: true, value: 'Archive', source: 'default', help: "the message's name", example: 'Archive' }),
  f({ name: 'fields', kind: 'fieldList', help: 'the values it carries', example: 'note:Text' }),
  f({ name: 'when', flag: true, help: 'show the button only when this holds', example: 'model.canWrite', agent: true }),
];

test('form: rows show values, toggles and notes', () => {
  const r = form.rows(fields, {});
  assert.deepEqual(r.map(x => x.value), ['Posts.Index', '', '', '[x]']);
  assert.deepEqual(r.map(x => x.name), ['page', 'name', 'fields', 'example']);
  assert.equal(r[0].note, 'from the cursor');
  assert.equal(r[0].error, false);
  assert.equal(r[1].note, 'required');
  assert.equal(r[2].note, undefined);
  assert.equal(r[3].note, 'default');
});

test('form: a bool with an empty value is unchecked, with no note', () => {
  const r = form.rows([f({ name: 'blank', kind: 'bool', flag: true })], {});
  assert.equal(r[0].value, '[ ]');
  assert.equal(r[0].note, undefined);
});

test('form: typed text wins; a why that is not "required" is an error', () => {
  const g = structuredClone(fields);
  g[1].value = 'bad name';
  g[1].why = 'not a message name: write Capitalised';
  const r = form.rows(g, { name: 'Del' });
  assert.equal(r[1].value, 'Del');
  assert.equal(r[1].note, g[1].why);
  assert.equal(r[1].error, true);
});

test('form: sets merge the preset and the typed text, dropping empties', () => {
  assert.deepEqual(form.sets({ page: 'Posts.Index' }, { name: 'Delete', fields: '' }), { page: 'Posts.Index', name: 'Delete' });
  assert.deepEqual(form.sets({ page: 'Posts.Index' }, { page: '' }), {});
  assert.deepEqual(form.sets({ page: '' }, {}), {});
  assert.deepEqual(form.sets(undefined, undefined), {});
});

test('form: a default bool is not sent until toggled', () => {
  assert.equal(form.sets({}, {}).example, undefined);
  assert.equal(form.sets({}, { example: 'false' }).example, 'false');
  assert.equal(form.sets({}, { example: 'true' }).example, 'true');
});

test('form: options, fuzzy, firstInvalid', () => {
  assert.deepEqual(form.options(fields[0], ''), ['Posts.Index', 'Posts.Show']);
  assert.deepEqual(form.options(fields[0], 'show'), ['Posts.Show']);
  assert.deepEqual(form.options(fields[1], 'x'), []);
  assert.deepEqual(form.fuzzy(['abc', 'xaxbxc', 'cba'], 'abc'), ['abc', 'xaxbxc']);
  assert.deepEqual(form.fuzzy(['Posts.', 'Sites.'], 'PS'), ['Posts.']);
  assert.equal(form.firstInvalid(fields), 1);
  assert.equal(form.firstInvalid([fields[0]]), undefined);
});

test('form: visible leaves out the agent flags', () => {
  assert.deepEqual(form.visible(described).map(x => x.name), ['page', 'name', 'fields']);
  assert.equal(form.visible(fields).length, fields.length);
  assert.deepEqual(form.visible(null), []);
  assert.deepEqual(form.visible(undefined), []);
});

test('form: the note carries the help after the source; an error still wins', () => {
  const r = form.rows(form.visible(described), {});
  assert.equal(r[0].note, 'from the cursor · the page the message belongs to');
  assert.equal(r[1].note, "default · the message's name");
  assert.equal(r[2].note, 'the values it carries');
  const g = structuredClone(described);
  g[1].valid = false;
  g[1].why = 'not a name';
  const e = form.rows(g, {});
  assert.equal(e[1].note, 'not a name');
  assert.equal(e[1].error, true);
});

test('form: a cleared field says which value the server uses instead', () => {
  const r = form.rows(form.visible(described), { name: '' });
  assert.equal(r[1].value, '');
  assert.equal(r[1].note, 'default: Archive');
  assert.equal(form.rows(form.visible(described), { page: '' })[0].note, 'from the cursor: Posts.Index');
});

test('form: exampleLine', () => {
  assert.equal(form.exampleLine(described[2]), 'e.g. note:Text');
  assert.equal(form.exampleLine(fields[0]), undefined);
  assert.equal(form.exampleLine(f({ name: 'x', kind: 'bool', example: '' })), undefined);
  assert.equal(form.exampleLine(undefined), undefined);
});

test('form: firstToFill is the first invalid field, else the first required one at its starting value', () => {
  assert.equal(form.firstToFill(fields), 1);
  assert.equal(form.firstToFill(described), 1);
  assert.equal(form.firstToFill(described, { name: 'Archive' }), undefined, 'typed counts as touched');
  const g = structuredClone(described);
  g[1].source = 'you';
  assert.equal(form.firstToFill(g), undefined);
});

test('form: editorKind and moduleText', () => {
  assert.equal(form.editorKind(fields[3]), 'bool');
  assert.equal(form.editorKind(fields[0]), 'choice');
  assert.equal(form.editorKind(f({ name: 'module', kind: 'module' })), 'module');
  assert.equal(form.editorKind(fields[1]), 'text');
  assert.equal(form.editorKind(f({ name: 'p', kind: 'page', choices: [] })), 'text');
  assert.equal(form.moduleText(f({ name: 'module', kind: 'module', value: '<Module>' }), {}), '');
  assert.equal(form.moduleText(f({ name: 'module', kind: 'module', value: '<Module>' }), { module: 'Tags.' }), 'Tags.');
  assert.equal(form.moduleText(f({ name: 'module', kind: 'module', value: 'Posts.Show' }), {}), 'Posts.Show');
});

test('form: moduleDirs lists the capitalised folders under app/ as dotted prefixes, shallow first', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alder-form-')));
  for (const [p, s] of [['app/App.alder', 'module App\n'], ['app/Sites/Clarity/Index.alder', ''], ['app/Posts/Index.alder', ''], ['app/lowercase/X.alder', '']]) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), s);
  }
  assert.deepEqual(form.moduleDirs(root), ['Posts.', 'Sites.', 'Sites.Clarity.']);
  assert.deepEqual(form.moduleDirs(join(root, 'nope')), []);
});

test('form: modulePath and moduleHelp', () => {
  assert.equal(form.modulePath('Sites.Clarity.Index'), 'app/Sites/Clarity/Index.alder');
  assert.equal(form.moduleHelp('Posts.Show'), 'Posts.Show → app/Posts/Show.alder');
  assert.equal(form.moduleHelp(''), 'Sites.Clarity.Index → app/Sites/Clarity/Index.alder');
  assert.equal(form.moduleHelp('Sites.Clarity.'), 'Sites.Clarity.Index → app/Sites/Clarity/Index.alder');
});

test('form: moduleSuggest completes a typed prefix', () => {
  const dirs = ['Posts.', 'Sites.', 'Sites.Clarity.'];
  assert.deepEqual(form.moduleSuggest(dirs, ''), dirs);
  assert.notEqual(form.moduleSuggest(dirs, ''), dirs, 'a copy');
  assert.deepEqual(form.moduleSuggest(dirs, 'Sites.'), ['Sites.Clarity.']);
  assert.deepEqual(form.moduleSuggest(dirs, 'Si'), ['Sites.', 'Sites.Clarity.']);
  assert.deepEqual(form.moduleSuggest(dirs, 'Zzz'), []);
  assert.deepEqual(form.moduleSuggest(dirs, 'Sites.Clarity.'), []);
  assert.deepEqual(form.moduleSuggest(dirs, 'Clar'), ['Sites.Clarity.'], 'fuzzy when no prefix matches');
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npm run test:unit`
Expected: the `tsc` step fails with `Cannot find module '../../src/generate/form'`.

- [ ] **Step 5: Write `src/generate/form.ts`**

```ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FieldState, Sets } from './types';

// form: the generator's fields as the form shows them (one row per field: its value, and a note
// on where the value came from or what is wrong) and what to send back. Port of alder.nvim's
// form.lua. Pure (moduleDirs reads the app's folders).

export const NOTES: Record<string, string> = { here: 'from the cursor', default: 'default' };
export const MODULE_EXAMPLE = 'Sites.Clarity.Index';

// Typed are the values the user entered, by field name; '' is a field they cleared.
export type Typed = Record<string, string>;

// FieldRow is a field as the form lists it: value is the text (`[x]`/`[ ]` for a switch);
// error marks a note that is the server's why.
export interface FieldRow { name: string; value: string; note?: string; error: boolean }

export type EditorKind = 'bool' | 'choice' | 'module' | 'text';

const isBool = (f: FieldState) => f.kind === 'bool';
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// visible are the fields the form shows: all but the agent-oriented flags (alder#45). A hidden
// field the cursor prefilled still reaches the server through the preset.
export function visible(fields: FieldState[] | null | undefined): FieldState[] {
  return (fields ?? []).filter(f => !f.agent);
}

// current is the text a field shows: what was typed, else the server's value.
export function current(f: FieldState, typed: Typed): string {
  return has(typed, f.name) ? typed[f.name] : (f.value ?? '');
}

function joined(...parts: (string | undefined)[]): string | undefined {
  const p = parts.filter((x): x is string => !!x);
  return p.length > 0 ? p.join(' · ') : undefined;
}

// rows are form.lua's lines and notes: the server's why (not "required") as an error; for a field
// you cleared, the value the server uses instead (`default: Archive`); `required` while empty;
// else where the value came from and the field's help.
export function rows(fields: FieldState[], typed: Typed = {}): FieldRow[] {
  return fields.map(f => {
    const v = current(f, typed);
    const from = f.source ? NOTES[f.source] : undefined;
    let note: string | undefined;
    let error = false;
    if (f.why && f.why !== 'required') {
      note = f.why;
      error = true;
    } else if (!isBool(f) && v === '' && f.value && from) {
      note = `${from}: ${f.value}`;
    } else if (!isBool(f) && v === '' && f.required) {
      note = 'required';
    } else {
      note = joined(from, f.help);
    }
    return { name: f.name, value: isBool(f) ? (v === 'true' ? '[x]' : '[ ]') : v, note, error };
  });
}

// sets is what the server gets: the preset with the typed text over it; an empty text drops the
// key, so the server falls back to the cursor. The server's own values are never echoed back.
export function sets(preset: Sets | undefined, typed: Typed | undefined): Sets {
  const out: Sets = {};
  for (const [k, v] of Object.entries(preset ?? {})) if (v !== '') out[k] = v;
  for (const [k, v] of Object.entries(typed ?? {})) {
    if (v !== '') out[k] = v;
    else delete out[k];
  }
  return out;
}

// fuzzy is the strings of list holding query's characters in order (ignoring case), best first:
// the earliest first match, then the fewest gaps, then list order.
export function fuzzy(list: string[], query: string): string[] {
  const q = query.toLowerCase();
  const scored: { s: string; score: number; i: number }[] = [];
  list.forEach((s, i) => {
    const t = s.toLowerCase();
    let at = -1;
    let first = -1;
    let gaps = 0;
    for (const ch of q) {
      const k = t.indexOf(ch, at + 1);
      if (k < 0) return;
      if (first < 0) first = k;
      else gaps += k - at - 1;
      at = k;
    }
    scored.push({ s, score: first + gaps, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map(x => x.s);
}

// options are a choice field's choices matching the typed text (all for none).
export function options(f: FieldState, typed?: string): string[] {
  const all = f.choices ?? [];
  if (!typed) return [...all];
  return fuzzy(all, typed);
}

// firstInvalid is the index of the first field the server marked invalid.
export function firstInvalid(fields: FieldState[] | undefined): number | undefined {
  const i = (fields ?? []).findIndex(f => !f.valid);
  return i < 0 ? undefined : i;
}

// firstToFill is the field a new form opens first: the first invalid one, else the first
// required one still at the server's starting value and untouched (alder#45 starts required
// fields at an example, so nothing is generated unseen).
export function firstToFill(fields: FieldState[] | undefined, typed: Typed = {}): number | undefined {
  const bad = firstInvalid(fields);
  if (bad !== undefined) return bad;
  const i = (fields ?? []).findIndex(f => f.required && f.source === 'default' && !has(typed, f.name));
  return i < 0 ? undefined : i;
}

// exampleLine is a field's example as a hint, undefined when it has none.
export function exampleLine(f: FieldState | undefined): string | undefined {
  return f?.example ? `e.g. ${f.example}` : undefined;
}

// editorKind is the editor a field opens: a switch, a list of choices, a module name, or text.
export function editorKind(f: FieldState): EditorKind {
  if (isBool(f)) return 'bool';
  if (f.choices && f.choices.length > 0) return 'choice';
  if (f.kind === 'module') return 'module';
  return 'text';
}

// moduleText is a module field's current text; the server's placeholder (`<Module>`) is empty.
export function moduleText(f: FieldState, typed: Typed): string {
  const v = current(f, typed);
  return v.startsWith('<') ? '' : v;
}

// moduleDirs are the capitalised folders under root/app as dotted prefixes (`Sites.`,
// `Sites.Clarity.`), shallow first, then alphabetical.
export function moduleDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && /^[A-Z]/.test(e.name)) {
        out.push(`${prefix}${e.name}.`);
        walk(join(dir, e.name), `${prefix}${e.name}.`);
      }
    }
  };
  walk(join(root, 'app'), '');
  const depth = (s: string) => s.split('.').length;
  return out.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// modulePath is the file a module name is written to, relative to the app root.
export function modulePath(name: string): string {
  return `app/${name.replaceAll('.', '/')}.alder`;
}

// moduleHelp says where the name lands: the typed name (a trailing dot gets `Index`), else the example.
export function moduleHelp(text: string): string {
  let name = text || MODULE_EXAMPLE;
  if (name.endsWith('.')) name += 'Index';
  return `${name} → ${modulePath(name)}`;
}

// moduleSuggest are the folder prefixes that complete text: those starting with it (fuzzy when
// none do and text does not end in a dot), never the text itself.
export function moduleSuggest(dirs: string[], text: string): string[] {
  if (!text) return [...dirs];
  const out = dirs.filter(d => d !== text && d.startsWith(text));
  if (out.length === 0 && !text.endsWith('.')) return fuzzy(dirs, text);
  return out;
}
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:unit`
Expected: every test passes, the new `form:` ones included.

- [ ] **Step 7: Commit**

```bash
git add src/generate/types.ts src/generate/form.ts test/unit/form.test.ts
git commit -m "generate: wire types and the form module (port of form.lua)"
```

---

### Task 2: Picker rows, preview render, review model, plan checks, entry file

**Files:**
- Create: `src/generate/picker.ts`, `src/generate/preview.ts`, `src/generate/review.ts`, `src/generate/planCheck.ts`, `src/generate/entry.ts`
- Test: `test/unit/picker.test.ts`, `test/unit/preview.test.ts`, `test/unit/review.test.ts`, `test/unit/planCheck.test.ts`, `test/unit/entry.test.ts`

**Interfaces:**
- Consumes: `Generator`, `PreviewResult`, `PlanResult`, `PlanFile` from `./types`.
- Produces:
  - `type PickerRow = { heading: 'here' | 'all' } | { item: Generator }`; `pickerRows(items: Generator[]): PickerRow[]`
  - `RULE: string`; `render(r: PreviewResult | null | undefined): string[]`; `firstHunk(lines: string[]): number` (0-based)
  - `interface ReviewFile { path: string; mark: '+' | '-' | '~'; before: string; after: string }`; `interface ReviewModel { notes: string[]; files: ReviewFile[]; canApply: boolean }`; `reviewModel(plan: PlanResult | null | undefined): ReviewModel`
  - `firstStale(files: PlanFile[], textOf: (rel: string) => Promise<string | null>): Promise<string | undefined>`; `firstRemoved(files: PlanFile[]): string | undefined`; `type Landing = { kind: 'hole'; file: string; line: number; col: number } | { kind: 'file'; path: string }`; `landing(plan: PlanResult, activeRel?: string): Landing | undefined`; `appliedMessage(id: string, plan: PlanResult): string`; `staleMessage(path: string): string`; `deletePrompt(path: string): string`
  - `entryFile(root: string): Promise<string | undefined>` (absolute path)

- [ ] **Step 1: Write the failing tests**

`test/unit/picker.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerRows } from '../../src/generate/picker';
import type { Generator } from '../../src/generate/types';

const items: Generator[] = [
  { id: 'new msg', summary: 'a message and its update arm', here: true },
  { id: 'new form', summary: 'a form, its message and arm', here: true },
  { id: 'new page', summary: 'a page module', here: false },
  { id: 'edit table', summary: 'change a table', here: false },
];

test('picker: here heading above the first here item, all above the first other', () => {
  const rows = pickerRows(items);
  assert.deepEqual(rows.map(r => 'heading' in r ? `-- ${r.heading}` : r.item.id),
    ['-- here', 'new msg', 'new form', '-- all', 'new page', 'edit table']);
});

test('picker: no here items is one all heading; nothing is nothing', () => {
  assert.deepEqual(pickerRows(items.slice(2)).map(r => 'heading' in r ? r.heading : r.item.id), ['all', 'new page', 'edit table']);
  assert.deepEqual(pickerRows([]), []);
});
```

`test/unit/preview.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstHunk, render, RULE } from '../../src/generate/preview';

test('preview: files, rule, diff and holes', () => {
  const lines = render({
    files: [{ path: 'app/Posts/Index.alder', action: 'edited', added: 3, removed: 1 }, { path: 'app/New.alder', action: 'created', added: 9, removed: 0 }],
    diff: '--- a/app/Posts/Index.alder\n+++ b/app/Posts/Index.alder\n@@ -1 +1 @@\n-x\n+y\n',
    holes: [{ name: 'delete', type: 'Task Nav', module: 'Posts.Index', decl: 'update', file: 'app/Posts/Index.alder', line: 3, col: 5 }],
  });
  assert.equal(RULE, '─'.repeat(40));
  assert.deepEqual(lines, [
    '~ app/Posts/Index.alder  +3 −1', '+ app/New.alder', RULE,
    '--- a/app/Posts/Index.alder', '+++ b/app/Posts/Index.alder', '@@ -1 +1 @@', '-x', '+y',
    '? delete : Task Nav',
  ]);
  assert.equal(firstHunk(lines), 5);
});

test('preview: an error replaces everything; a removal is marked; no rule without a diff or holes', () => {
  assert.deepEqual(render({ error: 'line one\nline two', files: [] }), ['line one', 'line two']);
  const lines = render({ files: [{ path: 'app/Old.alder', action: 'removed', added: 0, removed: 12 }], diff: '' });
  assert.deepEqual(lines, ['- app/Old.alder']);
  assert.equal(firstHunk(lines), 0);
});

test('preview: nothing yet; null lists', () => {
  assert.deepEqual(render(undefined), []);
  assert.deepEqual(render(null), []);
  assert.deepEqual(render({ files: null, holes: null, diff: '' }), []);
});
```

`test/unit/review.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewModel } from '../../src/generate/review';

test('review: notes and files', () => {
  const m = reviewModel({
    files: [
      { path: 'app/Posts/Index.alder', action: 'edited', before: 'a\nb\n', after: 'a\nB\n' },
      { path: 'app/New.alder', action: 'created', before: null, after: 'module New\n' },
      { path: 'app/Old.alder', action: 'removed', before: 'module Old\n', after: null },
    ],
    holes: [{ name: 'delete', type: 'Task Nav', module: 'Posts.Index', decl: 'update', arm: 'Delete', file: 'app/Posts/Index.alder', line: 1, col: 1 },
      { name: 'x', type: 'Int', module: 'A', decl: 'view', file: 'app/A.alder', line: 1, col: 1 }],
    imports: ['Post'],
    migration: ['add column note'],
    diagnostics: [],
    error: '',
  });
  assert.equal(m.canApply, true);
  assert.deepEqual(m.notes, ['? delete : Task Nav  (Posts.Index.update.Delete)', '? x : Int  (A.view)', 'import Post', 'migration: add column note']);
  assert.deepEqual(m.files.map(f => [f.mark, f.path, f.before, f.after]), [
    ['~', 'app/Posts/Index.alder', 'a\nb\n', 'a\nB\n'],
    ['+', 'app/New.alder', '', 'module New\n'],
    ['-', 'app/Old.alder', 'module Old\n', ''],
  ]);
});

test('review: an error forbids applying and heads the notes', () => {
  const m = reviewModel({ error: 'the result does not check', diagnostics: [{ file: 'app/X.alder', line: 3, col: 1, code: 'E0003', message: 'expected Int', severity: 'error' }], files: [] });
  assert.equal(m.canApply, false);
  assert.deepEqual(m.notes, ['✗ the result does not check', 'app/X.alder:3:1 E0003 expected Int']);
});

test('review: absent and null fields are fine', () => {
  assert.deepEqual(reviewModel(null), { notes: [], files: [], canApply: true });
  assert.deepEqual(reviewModel({ files: null, holes: null, imports: null, migration: null, diagnostics: null }), { notes: [], files: [], canApply: true });
});
```

`test/unit/planCheck.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliedMessage, deletePrompt, firstRemoved, firstStale, landing, staleMessage } from '../../src/generate/planCheck';
import type { PlanFile, PlanResult } from '../../src/generate/types';

const files: PlanFile[] = [
  { path: 'app/A.alder', action: 'edited', before: 'a\n', after: 'A\n' },
  { path: 'app/New.alder', action: 'created', before: null, after: 'module New\n' },
  { path: 'app/Old.alder', action: 'removed', before: 'old\n', after: null },
];

test('planCheck: firstStale compares every file with its before; a created file must not exist', async () => {
  const disk: Record<string, string | null> = { 'app/A.alder': 'a\n', 'app/New.alder': null, 'app/Old.alder': 'old\n' };
  assert.equal(await firstStale(files, async p => disk[p] ?? null), undefined);
  assert.equal(await firstStale(files, async p => (p === 'app/A.alder' ? 'typed\n' : disk[p] ?? null)), 'app/A.alder');
  assert.equal(await firstStale(files, async p => (p === 'app/New.alder' ? '' : disk[p] ?? null)), 'app/New.alder');
});

test('planCheck: firstRemoved and the messages', () => {
  assert.equal(firstRemoved(files), 'app/Old.alder');
  assert.equal(firstRemoved(files.slice(0, 2)), undefined);
  assert.equal(staleMessage('app/A.alder'), 'alder: app/A.alder changed since planning; nothing applied');
  assert.equal(deletePrompt('app/Old.alder'), 'Delete app/Old.alder from disk? undo cannot restore it');
  const plan: PlanResult = { files, holes: [] };
  assert.equal(appliedMessage('remove page', plan), 'alder: applied remove page: app/A.alder, app/New.alder, app/Old.alder');
  const hole = { name: 'h', type: 'Int', module: 'A', decl: 'view', file: 'app/A.alder', line: 4, col: 7 };
  assert.equal(appliedMessage('new msg', { files: files.slice(0, 1), holes: [hole] }), 'alder: applied new msg: app/A.alder (1 hole)');
  assert.equal(appliedMessage('new msg', { files: files.slice(0, 1), holes: [hole, hole] }), 'alder: applied new msg: app/A.alder (2 holes)');
});

test('planCheck: landing is the first hole, else the first created .alder file, else the first edited one not active', () => {
  const hole = { name: 'h', type: 'Int', module: 'A', decl: 'view', file: 'app/A.alder', line: 4, col: 7 };
  assert.deepEqual(landing({ files, holes: [hole] }), { kind: 'hole', file: 'app/A.alder', line: 3, col: 6 });
  assert.deepEqual(landing({ files, holes: [{ ...hole, col: 0 }] }), { kind: 'hole', file: 'app/A.alder', line: 3, col: 0 });
  assert.deepEqual(landing({ files, holes: [] }), { kind: 'file', path: 'app/New.alder' });
  const edited: PlanFile[] = [files[0], { path: 'app/B.alder', action: 'edited', before: 'b', after: 'B' }];
  assert.deepEqual(landing({ files: edited }), { kind: 'file', path: 'app/A.alder' });
  assert.deepEqual(landing({ files: edited }, 'app/A.alder'), { kind: 'file', path: 'app/B.alder' });
  assert.equal(landing({ files: [files[0]] }, 'app/A.alder'), undefined);
  assert.equal(landing({ files: [{ path: 'db/x.sql', action: 'created', before: null, after: '' }] }), undefined);
});
```

`test/unit/entry.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entryFile } from '../../src/generate/entry';

function tree(files: string[]): string {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'alder-entry-')));
  for (const f of files) {
    mkdirSync(join(t, f, '..'), { recursive: true });
    writeFileSync(join(t, f), '');
  }
  return t;
}

test('entry: app/App.alder when it exists', async () => {
  const t = tree(['app/App.alder', 'app/A/B.alder']);
  assert.equal(await entryFile(t), join(t, 'app/App.alder'));
});

test('entry: else the first .alder under app/ in name order, depth first', async () => {
  const t = tree(['app/Zed.alder', 'app/Posts/Show.alder', 'app/Posts/Index.alder', 'app/notes.txt']);
  assert.equal(await entryFile(t), join(t, 'app/Posts/Index.alder'));
});

test('entry: none', async () => {
  assert.equal(await entryFile(tree(['app/readme.md'])), undefined);
  assert.equal(await entryFile(tree([])), undefined);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:unit`
Expected: `tsc` fails because the modules don't exist yet.

- [ ] **Step 3: Write the modules**

`src/generate/picker.ts`:

```ts
import type { Generator } from './types';

// PickerRow is a picker entry: a heading (`here` above the first item that applies at the
// cursor, `all` above the first other) or a generator, in the server's order (here first).
// Port of picker.lua's grouped lines; the QuickPick does the filtering.
export type PickerRow = { heading: 'here' | 'all' } | { item: Generator };

export function pickerRows(items: Generator[]): PickerRow[] {
  const out: PickerRow[] = [];
  let seenHere = false;
  let seenRest = false;
  for (const item of items) {
    if (item.here && !seenHere) {
      out.push({ heading: 'here' });
      seenHere = true;
    } else if (!item.here && !seenRest) {
      out.push({ heading: 'all' });
      seenRest = true;
    }
    out.push({ item });
  }
  return out;
}
```

`src/generate/preview.ts`:

```ts
import type { PreviewResult } from './types';

// preview: the preview document's lines from an alder/preview answer (the files it would touch,
// a rule, the unified diff, the holes it leaves) or the refusal. Port of preview.lua.

export const RULE = '─'.repeat(40);

const MARK: Record<string, string> = { created: '+ ', removed: '- ' };

export function render(r: PreviewResult | null | undefined): string[] {
  if (!r) return [];
  if (r.error) return r.error.split('\n');
  const lines: string[] = [];
  for (const f of r.files ?? []) {
    const m = MARK[f.action];
    lines.push(m ? m + f.path : `~ ${f.path}  +${f.added ?? 0} −${f.removed ?? 0}`);
  }
  const holes = r.holes ?? [];
  if (lines.length > 0 && (r.diff || holes.length > 0)) lines.push(RULE);
  if (r.diff) {
    const dl = r.diff.split('\n');
    if (dl[dl.length - 1] === '') dl.pop();
    lines.push(...dl);
  }
  for (const h of holes) lines.push(`? ${h.name} : ${h.type}`);
  return lines;
}

// firstHunk is the index of the first `@@` line (the first change), else 0.
export function firstHunk(lines: string[]): number {
  const i = lines.findIndex(l => l.startsWith('@@'));
  return i < 0 ? 0 : i;
}
```

`src/generate/review.ts`:

```ts
import type { PlanResult } from './types';

// review: the plan as the review step shows it: what it leaves to you (the refusal, diagnostics,
// holes with their address, imports, migration) and the files with both sides for vscode.diff.
// Port of review.lua's model.

export interface ReviewFile { path: string; mark: '+' | '-' | '~'; before: string; after: string }
export interface ReviewModel { notes: string[]; files: ReviewFile[]; canApply: boolean }

export function reviewModel(plan: PlanResult | null | undefined): ReviewModel {
  const p = plan ?? {};
  const notes: string[] = [];
  const canApply = !p.error;
  if (p.error) notes.push(`✗ ${p.error}`);
  for (const d of p.diagnostics ?? []) notes.push(`${d.file ?? ''}:${d.line ?? 0}:${d.col ?? 0} ${d.code ?? ''} ${d.message ?? ''}`);
  for (const h of p.holes ?? []) {
    const addr = `${h.module ?? ''}.${h.decl ?? ''}${h.arm ? `.${h.arm}` : ''}`;
    notes.push(`? ${h.name ?? ''} : ${h.type ?? ''}  (${addr})`);
  }
  for (const i of p.imports ?? []) notes.push(`import ${i}`);
  for (const m of p.migration ?? []) notes.push(`migration: ${m}`);
  const files = (p.files ?? []).map((f): ReviewFile => ({
    path: f.path ?? '',
    mark: f.before === null ? '+' : f.after === null ? '-' : '~',
    before: f.before ?? '',
    after: f.after ?? '',
  }));
  return { notes, files, canApply };
}
```

`src/generate/planCheck.ts`:

```ts
import type { PlanFile, PlanResult } from './types';

// planCheck: the pure half of apply.lua: whether the files still read as planned, the file a
// plan removes, where the cursor lands after applying, and the messages.

export const staleMessage = (path: string) => `alder: ${path} changed since planning; nothing applied`;
export const deletePrompt = (path: string) => `Delete ${path} from disk? undo cannot restore it`;

// firstStale is the first file whose text as the user sees it (textOf: the open document's,
// else the file's, else null) is not its planned before (null for a created file: it must not exist).
export async function firstStale(files: PlanFile[], textOf: (rel: string) => Promise<string | null>): Promise<string | undefined> {
  for (const f of files) {
    if ((await textOf(f.path)) !== f.before) return f.path;
  }
  return undefined;
}

export function firstRemoved(files: PlanFile[]): string | undefined {
  return files.find(f => f.after === null)?.path;
}

export type Landing = { kind: 'hole'; file: string; line: number; col: number } | { kind: 'file'; path: string };

// landing is where the cursor goes after applying (0-based): the first hole, so the lightbulb
// there offers Fill with AI; else the first created .alder file; else the first edited one that
// is not activeRel (the active editor's path relative to the root).
export function landing(plan: PlanResult, activeRel?: string): Landing | undefined {
  const h = (plan.holes ?? [])[0];
  if (h) return { kind: 'hole', file: h.file, line: Math.max(h.line - 1, 0), col: Math.max((h.col || 1) - 1, 0) };
  const files = plan.files ?? [];
  const created = files.find(f => f.before === null && f.after !== null && f.path.endsWith('.alder'));
  if (created) return { kind: 'file', path: created.path };
  const edited = files.find(f => f.before !== null && f.after !== null && f.path !== activeRel);
  if (edited) return { kind: 'file', path: edited.path };
  return undefined;
}

export function appliedMessage(id: string, plan: PlanResult): string {
  const paths = (plan.files ?? []).map(f => f.path).join(', ');
  const n = (plan.holes ?? []).length;
  const left = n === 0 ? '' : ` (${n} hole${n === 1 ? '' : 's'})`;
  return `alder: applied ${id}: ${paths}${left}`;
}
```

`src/generate/entry.ts`:

```ts
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

// entryFile is the document a generator flow starts from when no alder editor is active, as
// project.lua's entry: app/App.alder, else the first .alder under app/ (names in order, a
// folder's files before the next sibling), else undefined.
export async function entryFile(root: string): Promise<string | undefined> {
  const app = join(root, 'app');
  const main = join(app, 'App.alder');
  try {
    if ((await fs.stat(main)).isFile()) return main;
  } catch {
    // no App.alder
  }
  const walk = async (dir: string): Promise<string | undefined> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        const found = await walk(p);
        if (found) return found;
      } else if (e.name.endsWith('.alder')) {
        return p;
      }
    }
    return undefined;
  };
  return walk(app);
}
```

Check the entry test's expectation against this order: the names `Posts` < `Zed.alder`, so it finds `Posts/Index.alder` (`Index` < `Show`).

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/generate/{picker,preview,review,planCheck,entry}.ts test/unit/{picker,preview,review,planCheck,entry}.test.ts
git commit -m "generate: picker rows, preview render, review model, plan checks, entry file"
```

---

### Task 3: The flow state machine

**Files:**
- Create: `src/generate/flow.ts`
- Test: `test/unit/flow.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces (all exported from `src/generate/flow.ts`):

```ts
export const DEBOUNCE_MS = 80;
export interface Position { line: number; character: number }
export interface Origin { uri: string; position: Position; root: string }
export interface Server { request<T>(method: string, params: unknown): Promise<T>; running(): boolean }
export interface FormModel { title: string; rows: FieldRow[]; ready: boolean; updating: boolean; active?: string }
export type FormAnswer = { kind: 'field'; name: string } | { kind: 'apply' } | { kind: 'review' } | { kind: 'back' } | { kind: 'escape' };
export interface FormView { update(m: FormModel): void; close(): void }
export interface TextView { setValidation(message: string | undefined): void; result: Promise<string | undefined> }
export interface ApplyUi { confirm(message: string, action: string): Promise<boolean>; info(message: string): void; warn(message: string): void; error(message: string): void }
export interface FlowUi extends ApplyUi {
  pickGenerator(rows: PickerRow[]): Promise<Generator | undefined>;
  form(m: FormModel, answer: (a: FormAnswer) => void): FormView;
  pickOne(o: { title: string; items: string[]; active?: string; placeholder?: string }): Promise<string | undefined>;
  module(o: { title: string; value: string; suggest(text: string): { help: string; suggestions: string[] } }): Promise<string | undefined>;
  text(o: { title: string; value: string; prompt?: string; placeholder?: string; onChange(text: string): void }): TextView;
  review(m: ReviewModel, o: { title: string; onActive(f: ReviewFile): void }): Promise<'apply' | 'back'>;
}
export interface PreviewSink { show(lines: string[], firstHunk: number): void; dispose(): void }
export interface FlowEnv {
  server: Server; ui: FlowUi; preview: PreviewSink;
  apply(id: string, sets: Sets): Promise<unknown>;
  showPlanFile(f: ReviewFile): void;
  debounceMs?: number;
}
export function asPreset(a: unknown): Preset | undefined;
export class Flow {
  readonly done: Promise<void>;
  constructor(env: FlowEnv, origin: Origin);
  start(preset?: Preset): Promise<void>;   // resolves once the first step is up; `done` when the flow ends
  answer(a: FormAnswer): Promise<void>;     // the form's answers; also Ctrl+Enter's { kind: 'apply' }
  close(): void;                            // idempotent; resolves `done`
}
```

Behaviour (from modal.lua and the spec's Step 1/Step 2/Enter rules/Review):
- `start`: `alder/generators` with `{ textDocument: { uri }, position }`. No items → `ui.warn('alder: no generators')` and close. A request error → `ui.error('alder: ' + message)` and close. If the preset's id is in the list, select that item with the preset's sets. Otherwise show the picker. When the picker answers `undefined`, close.
- `select(item, presetSets)`: the preset is `{ ...item.sets, ...presetSets }`. Reset typed, fields, active and the review state. Set `fillFirst = true` (on both the picker and the preset path, so nothing is generated unseen). Show the empty preview, open the form, and send a preview at once.
- Sequence: a module-level `seqCounter`. `invalidate()` bumps it into `this.seq`, sets `ready = false` and clears the debounce timer. A preview answer counts only when its number is still `this.seq` and the flow is open. `updating` is true from the request until the answer that counts arrives. The title then shows `id  summary  updating…`.
- A request error during a preview: a `-32800` error (`code === -32800`) is swallowed. If the server is not running, call `ui.error('alder: <message>')` and close. Otherwise the answer becomes `{ error: 'the preview failed: <message>', files: [] }`.
- `onPreview`: `fields = visible(r.fields)` when `r.fields` is present, else the old ones. `ready = r.ready === true`. The preview gets `render(r)` and `firstHunk`. An open text editor gets its field's why (not `required`). The form re-renders. When `fillFirst` is set, clear it, and if `firstToFill` finds a field, open that field's editor.
- Editors (each closes the form view first and reopens the form afterwards, unless the flow closed meanwhile). The title is `<id>: <field>`.
  - `bool`: `pickOne` with items `['on', 'off']` and the current one active. A pick sets `'true'` or `'false'`.
  - `choice`: `pickOne` with the field's choices, the current value active and placeholder `f.help`. Any pick sets the field. Escape changes nothing.
  - `module`: `ui.module` with `value: moduleText(f, typed)` and `suggest: t => ({ help: moduleHelp(t), suggestions: moduleSuggest(dirs, t) })`. `dirs = moduleDirs(origin.root)` is computed once per flow. A result sets the field.
  - `text`: `ui.text` with value `current(f, typed)`, prompt `f.help` and placeholder `exampleLine(f)`. Each `onChange` calls `setField`, which records the text, re-renders and requests a debounced preview. Validation is pushed after each answer. On Escape (`undefined`), if typed differs from the value before the editor opened, put it back (delete the key if it was absent) and request a preview. On accept, set the field if the value differs from typed.
- `answer`: `escape` closes. `back` closes the form view, invalidates (so a late answer is dropped), sets `updating = false` and `sel = undefined`, then shows the picker again. `field` opens that editor. `apply` runs the enter rule. `review` runs the review.
- The enter rule: while `updating`, do nothing. When not ready, open the editor of `firstInvalid` (if any). Otherwise apply with `sets()`.
- Apply: tear down (closed, timer, form view, preview disposed), `await env.apply(id, sets)`, then resolve `done`.
- Review: `alder/plan` with the current sets as `planned`. When the answer arrives, drop it if the flow closed, the selected id changed, or `sets()` no longer equals `planned`. If `!files.length && canApply`, call `ui.info('alder: nothing to change')` and keep the form. Otherwise close the form view and `await ui.review(model, { title: id, onActive: env.showPlanFile })`. `apply` with `canApply` applies with `planned`. `back` reopens the form with `active` kept. A plan request error behaves like a preview error: not running → error + close; else `ui.error('alder: <message>')`.
- `asPreset`: a string → `{ id }`. An object with a string `id` → `{ id, sets }`, keeping only the string values of `sets`. Anything else → `undefined`.

- [ ] **Step 1: Write the failing test `test/unit/flow.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asPreset, Flow, FlowUi, FormAnswer, FormModel, Origin, Server, TextView } from '../../src/generate/flow';
import type { PickerRow } from '../../src/generate/picker';
import type { ReviewFile, ReviewModel } from '../../src/generate/review';
import type { FieldState, Generator, PlanResult, PreviewResult, Sets } from '../../src/generate/types';

const tick = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

interface Pending { method: string; params: { id?: string; sets?: Sets }; resolve(v: unknown): void; reject(e: unknown): void }

class FakeServer implements Server {
  pending: Pending[] = [];
  up = true;
  request<T>(method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => this.pending.push({ method, params: params as Pending['params'], resolve: resolve as (v: unknown) => void, reject }));
  }
  running() { return this.up; }
  // take removes and returns the oldest pending request of method
  take(method: string): Pending {
    const i = this.pending.findIndex(p => p.method === method);
    assert.ok(i >= 0, `no pending ${method}; pending: ${this.pending.map(p => p.method).join(', ')}`);
    return this.pending.splice(i, 1)[0];
  }
}

interface FormCall { model: FormModel; answer(a: FormAnswer): void; closed: boolean }

class FakeUi implements FlowUi {
  log: string[] = [];
  forms: FormCall[] = [];
  onPick: (rows: PickerRow[]) => Generator | undefined = () => undefined;
  onPickOne: (o: { title: string; items: string[]; active?: string }) => string | undefined = () => undefined;
  onModule: (o: { value: string; suggest(t: string): { help: string; suggestions: string[] } }) => string | undefined = () => undefined;
  texts: { title: string; value: string; onChange(t: string): void; validation?: string; finish(v: string | undefined): void }[] = [];
  onReview: (m: ReviewModel, o: { onActive(f: ReviewFile): void }) => 'apply' | 'back' = () => 'back';
  confirm = async () => true;
  info(m: string) { this.log.push(`info ${m}`); }
  warn(m: string) { this.log.push(`warn ${m}`); }
  error(m: string) { this.log.push(`error ${m}`); }
  async pickGenerator(rows: PickerRow[]) { this.log.push('pick'); return this.onPick(rows); }
  form(model: FormModel, answer: (a: FormAnswer) => void) {
    const call: FormCall = { model, answer, closed: false };
    this.forms.push(call);
    return { update: (m: FormModel) => { call.model = m; }, close: () => { call.closed = true; } };
  }
  async pickOne(o: { title: string; items: string[]; active?: string }) { this.log.push(`pickOne ${o.title}`); return this.onPickOne(o); }
  async module(o: { title: string; value: string; suggest(t: string): { help: string; suggestions: string[] } }) { this.log.push(`module ${o.title}`); return this.onModule(o); }
  text(o: { title: string; value: string; onChange(t: string): void }): TextView {
    let finish!: (v: string | undefined) => void;
    const result = new Promise<string | undefined>(r => { finish = r; });
    const entry = { title: o.title, value: o.value, onChange: o.onChange, validation: undefined as string | undefined, finish };
    this.texts.push(entry);
    this.log.push(`text ${o.title}`);
    return { setValidation: m => { entry.validation = m; }, result };
  }
  async review(m: ReviewModel, o: { title: string; onActive(f: ReviewFile): void }) { this.log.push('review'); return this.onReview(m, o); }
  get form_() { const f = this.forms[this.forms.length - 1]; assert.ok(f && !f.closed, 'no open form'); return f; }
}

class FakeSink { shown: string[][] = []; disposed = false; show(lines: string[]) { this.shown.push(lines); } dispose() { this.disposed = true; } }

const origin: Origin = { uri: 'file:///w/app/Posts/Index.alder', position: { line: 3, character: 2 }, root: '/w' };
const msg: Generator = { id: 'new msg', summary: 'a message', here: true, sets: { page: 'Posts.Index' } };
const page: Generator = { id: 'new page', summary: 'a page', here: false };
const field = (o: Partial<FieldState> & { name: string }): FieldState =>
  ({ kind: 'text', flag: false, required: false, value: '', source: '', valid: true, help: '', ...o });
const nameDefault = field({ name: 'name', required: true, value: 'Archive', source: 'default', help: "the message's name", example: 'Archive' });
const nameYou = (v: string) => field({ name: 'name', required: true, value: v, source: 'you' });
const ready = (fields: FieldState[]): PreviewResult => ({ fields, files: [{ path: 'app/Posts/Index.alder', action: 'edited', added: 2, removed: 0 }], diff: '@@ -1 +1 @@\n-a\n+b\n', ready: true });

function setup() {
  const server = new FakeServer();
  const ui = new FakeUi();
  const sink = new FakeSink();
  const applied: { id: string; sets: Sets }[] = [];
  const shownFiles: string[] = [];
  const flow = new Flow({ server, ui, preview: sink, apply: async (id, sets) => { applied.push({ id, sets }); }, showPlanFile: f => shownFiles.push(f.path), debounceMs: 0 }, origin);
  return { server, ui, sink, applied, shownFiles, flow };
}

// started is a flow past the picker on `new msg`, with its first preview answered by r.
async function started(r: PreviewResult = ready([nameYou('Delete')])) {
  const s = setup();
  s.ui.onPick = rows => rows.flatMap(x => ('item' in x ? [x.item] : [])).find(g => g.id === 'new msg');
  void s.flow.start();
  await tick();
  s.server.take('alder/generators').resolve({ generators: [msg, page] });
  await tick();
  s.server.take('alder/preview').resolve(r);
  await tick();
  return s;
}

test('flow: no generators warns and ends', async () => {
  const { server, ui, flow } = setup();
  void flow.start();
  await tick();
  const p = server.take('alder/generators');
  assert.deepEqual(p.params, { textDocument: { uri: origin.uri }, position: origin.position });
  p.resolve({ generators: null });
  await flow.done;
  assert.deepEqual(ui.log, ['warn alder: no generators']);
  assert.equal(ui.forms.length, 0);
});

test('flow: the picker gets the grouped rows; picking sends a preview with the item\'s sets', async () => {
  const s = setup();
  let seen: PickerRow[] = [];
  s.ui.onPick = rows => { seen = rows; return msg; };
  void s.flow.start();
  await tick();
  s.server.take('alder/generators').resolve({ generators: [msg, page] });
  await tick();
  assert.deepEqual(seen.map(r => ('heading' in r ? r.heading : r.item.id)), ['here', 'new msg', 'all', 'new page']);
  const p = s.server.take('alder/preview');
  assert.deepEqual(p.params, { textDocument: { uri: origin.uri }, position: origin.position, id: 'new msg', sets: { page: 'Posts.Index' } });
  assert.equal(s.ui.form_.model.updating, true);
  assert.equal(s.ui.form_.model.title, 'new msg  a message  updating…');
  p.resolve(ready([nameYou('Delete')]));
  await tick();
  assert.equal(s.ui.form_.model.ready, true);
  assert.equal(s.ui.form_.model.title, 'new msg  a message');
  assert.deepEqual(s.ui.form_.model.rows.map(r => r.name), ['name']);
  assert.ok(s.sink.shown.at(-1)!.includes('+b'));
});

test('flow: picker escape ends the flow', async () => {
  const { server, flow } = setup();
  void flow.start();
  await tick();
  server.take('alder/generators').resolve({ generators: [msg] });
  await flow.done;
});

test('flow: a required field at its starting value opens its editor first', async () => {
  const s = await started(ready([nameDefault]));
  assert.equal(s.ui.texts.length, 1);
  assert.equal(s.ui.texts[0].title, 'new msg: name');
  assert.equal(s.ui.texts[0].value, 'Archive');
  assert.ok(s.ui.forms[0].closed, 'the form closes while the editor is up');
});

test('flow: typing in the text editor previews, validates, and the stale answer is dropped', async () => {
  const s = await started(ready([nameDefault]));
  const t = s.ui.texts[0];
  t.onChange('del');
  await tick();
  const first = s.server.take('alder/preview');
  assert.deepEqual(first.params.sets, { page: 'Posts.Index', name: 'del' });
  t.onChange('Delete');
  await tick();
  const second = s.server.take('alder/preview');
  // the older answer arrives late: it must not paint anything
  const before = s.sink.shown.length;
  first.resolve({ ...ready([field({ name: 'name', value: 'del', valid: false, why: 'not a message name' })]), ready: false });
  await tick();
  assert.equal(s.sink.shown.length, before, 'stale answer painted the preview');
  assert.equal(t.validation, undefined, 'stale answer set the validation');
  second.resolve({ fields: [field({ name: 'name', value: 'Delete', valid: false, why: 'Delete exists' })], ready: false });
  await tick();
  assert.equal(t.validation, 'Delete exists');
  t.finish('Delete');
  await tick();
  assert.equal(s.ui.form_.model.rows[0].value, 'Delete');
});

test('flow: escape in the text editor restores the previous value', async () => {
  const s = await started(ready([nameDefault]));
  const t = s.ui.texts[0];
  t.onChange('Half');
  await tick();
  s.server.take('alder/preview').resolve(ready([nameYou('Half')]));
  await tick();
  t.finish(undefined);
  await tick();
  const p = s.server.take('alder/preview');
  assert.deepEqual(p.params.sets, { page: 'Posts.Index' }, 'the typed text is gone');
});

test('flow: apply while a preview is in flight does nothing; not ready opens the first invalid field; ready applies', async () => {
  const s = await started({ fields: [field({ name: 'name', required: true, valid: false, why: 'required' })], ready: false });
  // fillFirst opened the invalid field's editor; leave it
  assert.equal(s.ui.texts.length, 1);
  s.ui.texts[0].finish(undefined);
  await tick();
  // Escape re-requested nothing (nothing was typed), so no preview is in flight
  assert.equal(s.server.pending.length, 0);
  await s.flow.answer({ kind: 'apply' });
  await tick();
  assert.equal(s.ui.texts.length, 2, 'not ready: the first invalid field opens');
  s.ui.texts[1].onChange('Delete');
  await tick();
  // in flight: apply does nothing
  await s.flow.answer({ kind: 'apply' });
  assert.equal(s.applied.length, 0);
  s.server.take('alder/preview').resolve(ready([nameYou('Delete')]));
  await tick();
  s.ui.texts[1].finish('Delete');
  await tick();
  await s.flow.answer({ kind: 'apply' });
  await s.flow.done;
  assert.deepEqual(s.applied, [{ id: 'new msg', sets: { page: 'Posts.Index', name: 'Delete' } }]);
  assert.ok(s.sink.disposed);
});

test('flow: a preset skips the picker and overlays the item\'s sets', async () => {
  const s = setup();
  void s.flow.start({ id: 'new msg', sets: { name: 'Archive' } });
  await tick();
  s.server.take('alder/generators').resolve({ generators: [page, msg] });
  await tick();
  assert.ok(!s.ui.log.includes('pick'));
  assert.deepEqual(s.server.take('alder/preview').params.sets, { page: 'Posts.Index', name: 'Archive' });
});

test('flow: unknown preset shows the picker', async () => {
  const s = setup();
  void s.flow.start({ id: 'new widget' });
  await tick();
  s.server.take('alder/generators').resolve({ generators: [msg] });
  await s.flow.done;
  assert.deepEqual(s.ui.log, ['pick']);
});

test('flow: back to the picker drops the in-flight answer', async () => {
  const s = await started();
  s.ui.onPick = () => page;
  // a field change puts a preview in flight
  s.flow['setField']('name', 'X');
  await tick();
  const late = s.server.take('alder/preview');
  await s.flow.answer({ kind: 'back' });
  await tick();
  const fresh = s.server.take('alder/preview');
  assert.equal(fresh.params.id, 'new page');
  const shown = s.sink.shown.length;
  late.resolve(ready([nameYou('X')]));
  await tick();
  assert.equal(s.sink.shown.length, shown);
  assert.equal(s.ui.form_.model.ready, false);
});

test('flow: a bool field picks on/off into "true"/"false"', async () => {
  const s = await started(ready([field({ name: 'example', kind: 'bool', value: 'true', source: 'default' })]));
  s.ui.onPickOne = o => { assert.deepEqual(o.items, ['on', 'off']); assert.equal(o.active, 'on'); return 'off'; };
  await s.flow.answer({ kind: 'field', name: 'example' });
  await tick();
  assert.deepEqual(s.server.take('alder/preview').params.sets, { page: 'Posts.Index', example: 'false' });
});

test('flow: a module field suggests the app\'s folders', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alder-flow-')));
  mkdirSync(join(root, 'app/Sites/Clarity'), { recursive: true });
  const s = setup();
  const flow = new Flow({ server: s.server, ui: s.ui, preview: s.sink, apply: async () => {}, showPlanFile: () => {}, debounceMs: 0 }, { ...origin, root });
  s.ui.onPick = () => page;
  let got: { help: string; suggestions: string[] } | undefined;
  s.ui.onModule = o => { assert.equal(o.value, ''); got = o.suggest('Sites.'); return 'Sites.Clarity.Index'; };
  void flow.start();
  await tick();
  s.server.take('alder/generators').resolve({ generators: [page] });
  await tick();
  s.server.take('alder/preview').resolve(ready([field({ name: 'module', kind: 'module', value: '<Module>', source: 'you' })]));
  await tick();
  await flow.answer({ kind: 'field', name: 'module' });
  await tick();
  assert.deepEqual(got, { help: 'Sites.Index → app/Sites/Index.alder', suggestions: ['Sites.Clarity.'] });
  assert.deepEqual(s.server.take('alder/preview').params.sets, { module: 'Sites.Clarity.Index' });
});

test('flow: review shows the plan, applies with the planned sets; back keeps the form', async () => {
  const s = await started();
  const plan: PlanResult = { files: [{ path: 'app/Posts/Index.alder', action: 'edited', before: 'a', after: 'b' }], holes: [], error: '' };
  s.ui.onReview = (m, o) => { o.onActive(m.files[0]); return 'back'; };
  void s.flow.answer({ kind: 'review' });
  await tick();
  const p = s.server.take('alder/plan');
  assert.deepEqual(p.params.sets, { page: 'Posts.Index' });
  p.resolve(plan);
  await tick();
  assert.deepEqual(s.shownFiles, ['app/Posts/Index.alder']);
  assert.ok(!s.ui.forms.at(-1)!.closed, 'back reopened the form');
  s.ui.onReview = () => 'apply';
  void s.flow.answer({ kind: 'review' });
  await tick();
  s.server.take('alder/plan').resolve(plan);
  await s.flow.done;
  assert.deepEqual(s.applied, [{ id: 'new msg', sets: { page: 'Posts.Index' } }]);
});

test('flow: a plan answer for sets that changed meanwhile is dropped; an empty plan says so', async () => {
  const s = await started();
  void s.flow.answer({ kind: 'review' });
  await tick();
  const p = s.server.take('alder/plan');
  s.flow['setField']('name', 'Other');
  p.resolve({ files: [{ path: 'a', action: 'edited', before: 'a', after: 'b' }] });
  await tick();
  assert.ok(!s.ui.log.includes('review'));
  s.server.take('alder/preview').resolve(ready([nameYou('Other')]));
  await tick();
  void s.flow.answer({ kind: 'review' });
  await tick();
  s.server.take('alder/plan').resolve({ files: [], error: '' });
  await tick();
  assert.ok(s.ui.log.includes('info alder: nothing to change'));
  assert.ok(!s.ui.log.includes('review'));
});

test('flow: a failed preview shows the error; with the server gone the flow closes', async () => {
  const s = await started();
  s.flow['setField']('name', 'X');
  await tick();
  s.server.take('alder/preview').reject(new Error('boom'));
  await tick();
  assert.deepEqual(s.sink.shown.at(-1), ['the preview failed: boom']);
  assert.equal(s.ui.form_.model.updating, false);
  s.flow['setField']('name', 'Y');
  await tick();
  s.server.take('alder/preview').reject(Object.assign(new Error('cancelled'), { code: -32800 }));
  await tick();
  assert.deepEqual(s.sink.shown.at(-1), ['the preview failed: boom'], 'a cancelled preview is swallowed');
  s.server.up = false;
  s.flow['setField']('name', 'Z');
  await tick();
  s.server.take('alder/preview').reject(new Error('connection closed'));
  await s.flow.done;
  assert.ok(s.ui.log.includes('error alder: connection closed'));
  assert.ok(s.sink.disposed);
});

test('flow: closed flow ignores answers; escape closes; close is idempotent', async () => {
  const s = await started();
  s.flow['setField']('name', 'X');
  await tick();
  const late = s.server.take('alder/preview');
  await s.flow.answer({ kind: 'escape' });
  await s.flow.done;
  const shown = s.sink.shown.length;
  late.resolve(ready([nameYou('X')]));
  await tick();
  assert.equal(s.sink.shown.length, shown);
  s.flow.close();
});

test('flow: asPreset', () => {
  assert.deepEqual(asPreset('new msg'), { id: 'new msg' });
  assert.deepEqual(asPreset({ id: 'new msg', sets: { page: 'P', n: 3 }, why: 'x' }), { id: 'new msg', sets: { page: 'P' } });
  assert.equal(asPreset(undefined), undefined);
  assert.equal(asPreset({ sets: {} }), undefined);
  assert.equal(asPreset(42), undefined);
});
```

The tests call `flow['setField']` to stand for a keystroke. That keeps `setField` private while TypeScript still allows the bracket access.

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:unit`
Expected: `tsc` fails because `src/generate/flow` doesn't exist.

- [ ] **Step 3: Write `src/generate/flow.ts`**

```ts
import { current, editorKind, exampleLine, FieldRow, firstInvalid, firstToFill, moduleDirs, moduleHelp, moduleSuggest, moduleText, rows, sets, Typed, visible } from './form';
import { PickerRow, pickerRows } from './picker';
import { firstHunk, render } from './preview';
import { ReviewFile, ReviewModel, reviewModel } from './review';
import type { FieldState, Generator, PlanResult, Preset, PreviewResult, Sets } from './types';

// flow: the generator flow's state, ported from alder.nvim's modal.lua: the picker, the form,
// one preview request per burst of typing with a sequence number so a late answer never
// counts, the enter rules and the review. No vscode here: the UI, the server and the preview
// document come in through FlowEnv, so the unit tests drive it with fakes.

export const DEBOUNCE_MS = 80;

export interface Position { line: number; character: number }
export interface Origin { uri: string; position: Position; root: string }
export interface Server { request<T>(method: string, params: unknown): Promise<T>; running(): boolean }

export interface FormModel { title: string; rows: FieldRow[]; ready: boolean; updating: boolean; active?: string }
export type FormAnswer = { kind: 'field'; name: string } | { kind: 'apply' } | { kind: 'review' } | { kind: 'back' } | { kind: 'escape' };
export interface FormView { update(m: FormModel): void; close(): void }
export interface TextView { setValidation(message: string | undefined): void; result: Promise<string | undefined> }

export interface ApplyUi {
  confirm(message: string, action: string): Promise<boolean>;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface FlowUi extends ApplyUi {
  pickGenerator(rows: PickerRow[]): Promise<Generator | undefined>;
  form(m: FormModel, answer: (a: FormAnswer) => void): FormView;
  pickOne(o: { title: string; items: string[]; active?: string; placeholder?: string }): Promise<string | undefined>;
  module(o: { title: string; value: string; suggest(text: string): { help: string; suggestions: string[] } }): Promise<string | undefined>;
  text(o: { title: string; value: string; prompt?: string; placeholder?: string; onChange(text: string): void }): TextView;
  review(m: ReviewModel, o: { title: string; onActive(f: ReviewFile): void }): Promise<'apply' | 'back'>;
}

export interface PreviewSink { show(lines: string[], firstHunk: number): void; dispose(): void }

export interface FlowEnv {
  server: Server;
  ui: FlowUi;
  preview: PreviewSink;
  apply(id: string, sets: Sets): Promise<unknown>;
  showPlanFile(f: ReviewFile): void;
  debounceMs?: number;
}

// asPreset reads alder.generate's argument: a generator id, or a code action's {id, sets, why}.
export function asPreset(a: unknown): Preset | undefined {
  if (typeof a === 'string') return { id: a };
  if (!a || typeof a !== 'object') return undefined;
  const o = a as { id?: unknown; sets?: unknown };
  if (typeof o.id !== 'string') return undefined;
  const out: Sets = {};
  if (o.sets && typeof o.sets === 'object') {
    for (const [k, v] of Object.entries(o.sets)) if (typeof v === 'string') out[k] = v;
  }
  return { id: o.id, sets: out };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const cancelled = (err: unknown) => !!err && typeof err === 'object' && (err as { code?: unknown }).code === -32800;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function sameSets(a: Sets, b: Sets): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every(k => has(b, k) && a[k] === b[k]);
}

// shared by every flow, so a closed flow's answer never matches a new one's number
let seqCounter = 0;

export class Flow {
  readonly done: Promise<void>;
  private finish!: () => void;
  private closed = false;
  private items: Generator[] = [];
  private sel: Generator | undefined;
  private preset: Sets = {};
  private typed: Typed = {};
  private fields: FieldState[] = [];
  private active: string | undefined;
  private seq = 0;
  private ready = false;
  private updating = false;
  private fillFirst = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private view: FormView | undefined;
  private textView: { name: string; view: TextView } | undefined;
  private dirs: string[] | undefined;

  constructor(private readonly env: FlowEnv, private readonly origin: Origin) {
    this.done = new Promise(r => { this.finish = r; });
  }

  private params(extra: object = {}) {
    return { textDocument: { uri: this.origin.uri }, position: this.origin.position, ...extra };
  }

  private sets(): Sets {
    return sets(this.preset, this.typed);
  }

  async start(preset?: Preset): Promise<void> {
    let res: { generators?: Generator[] | null } | null;
    try {
      res = await this.env.server.request('alder/generators', this.params());
    } catch (err) {
      if (!this.closed) {
        this.env.ui.error(`alder: ${message(err)}`);
        this.close();
      }
      return;
    }
    if (this.closed) return;
    this.items = res?.generators ?? [];
    if (this.items.length === 0) {
      this.env.ui.warn('alder: no generators');
      return this.close();
    }
    const found = preset && this.items.find(i => i.id === preset.id);
    if (found) return this.select(found, preset.sets);
    await this.pick();
  }

  private async pick(): Promise<void> {
    const g = await this.env.ui.pickGenerator(pickerRows(this.items));
    if (this.closed) return;
    if (!g) return this.close();
    this.select(g);
  }

  private select(g: Generator, presetSets?: Sets): void {
    this.sel = g;
    this.preset = { ...(g.sets ?? {}), ...(presetSets ?? {}) };
    this.typed = {};
    this.fields = [];
    this.active = undefined;
    this.fillFirst = true;
    this.env.preview.show([], 0);
    this.openForm();
    void this.sendPreview();
  }

  private model(): FormModel {
    const sel = this.sel!;
    return {
      title: `${sel.id}  ${sel.summary}${this.updating ? '  updating…' : ''}`,
      rows: rows(this.fields, this.typed),
      ready: this.ready,
      updating: this.updating,
      active: this.active,
    };
  }

  private openForm(): void {
    if (this.closed || !this.sel) return;
    this.view = this.env.ui.form(this.model(), a => void this.answer(a));
  }

  private closeForm(): void {
    this.view?.close();
    this.view = undefined;
  }

  private render(): void {
    if (this.sel) this.view?.update(this.model());
  }

  // invalidate makes every preview in flight or waiting stale: the form is not ready until a newer answer.
  private invalidate(): void {
    seqCounter++;
    this.seq = seqCounter;
    this.ready = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private setField(name: string, text: string): void {
    this.typed[name] = text;
    this.requestPreview();
  }

  // requestPreview asks after a pause (one request per burst of typing).
  private requestPreview(): void {
    if (this.closed) return;
    this.invalidate();
    this.updating = true;
    this.render();
    this.timer = setTimeout(() => void this.sendPreview(), this.env.debounceMs ?? DEBOUNCE_MS);
  }

  private async sendPreview(): Promise<void> {
    const sel = this.sel;
    if (this.closed || !sel) return;
    this.invalidate();
    const n = this.seq;
    this.updating = true;
    this.render();
    let r: PreviewResult;
    try {
      r = (await this.env.server.request<PreviewResult | null>('alder/preview', this.params({ id: sel.id, sets: this.sets() }))) ?? {};
    } catch (err) {
      if (this.closed || n !== this.seq || cancelled(err)) return;
      if (!this.env.server.running()) {
        this.env.ui.error(`alder: ${message(err)}`);
        return this.close();
      }
      r = { error: `the preview failed: ${message(err)}`, files: [] };
    }
    this.onPreview(n, r);
  }

  private whyOf(name: string): string | undefined {
    const f = this.fields.find(x => x.name === name);
    return f?.why && f.why !== 'required' ? f.why : undefined;
  }

  private onPreview(n: number, r: PreviewResult): void {
    if (this.closed || n !== this.seq) return;
    this.updating = false;
    if (r.fields) this.fields = visible(r.fields);
    this.ready = r.ready === true;
    const lines = render(r);
    this.env.preview.show(lines, firstHunk(lines));
    if (this.textView) this.textView.view.setValidation(this.whyOf(this.textView.name));
    this.render();
    if (this.fillFirst) {
      this.fillFirst = false;
      const i = firstToFill(this.fields, this.typed);
      if (i !== undefined) void this.edit(this.fields[i].name);
    }
  }

  async answer(a: FormAnswer): Promise<void> {
    if (this.closed) return;
    switch (a.kind) {
      case 'escape':
        return this.close();
      case 'back':
        this.closeForm();
        this.invalidate();
        this.updating = false;
        this.sel = undefined;
        return this.pick();
      case 'field':
        return this.edit(a.name);
      case 'apply':
        return this.enter();
      case 'review':
        return this.review();
    }
  }

  private async edit(name: string): Promise<void> {
    const sel = this.sel;
    const f = this.fields.find(x => x.name === name);
    if (this.closed || !sel || !f) return;
    this.active = name;
    this.closeForm();
    const ui = this.env.ui;
    const title = `${sel.id}: ${name}`;
    const now = current(f, this.typed);
    switch (editorKind(f)) {
      case 'bool': {
        const v = await ui.pickOne({ title, items: ['on', 'off'], active: now === 'true' ? 'on' : 'off' });
        if (v !== undefined && !this.closed) this.setField(name, v === 'on' ? 'true' : 'false');
        break;
      }
      case 'choice': {
        const v = await ui.pickOne({ title, items: f.choices ?? [], active: now, placeholder: f.help });
        if (v !== undefined && !this.closed) this.setField(name, v);
        break;
      }
      case 'module': {
        const dirs = (this.dirs ??= moduleDirs(this.origin.root));
        const v = await ui.module({ title, value: moduleText(f, this.typed), suggest: t => ({ help: moduleHelp(t), suggestions: moduleSuggest(dirs, t) }) });
        if (v !== undefined && !this.closed) this.setField(name, v);
        break;
      }
      case 'text': {
        const had = has(this.typed, name);
        const before = this.typed[name];
        const view = ui.text({ title, value: now, prompt: f.help || undefined, placeholder: exampleLine(f), onChange: t => this.setField(name, t) });
        this.textView = { name, view };
        view.setValidation(this.whyOf(name));
        const v = await view.result;
        this.textView = undefined;
        if (this.closed) return;
        if (v === undefined) {
          if (had ? this.typed[name] !== before : has(this.typed, name)) {
            if (had) this.typed[name] = before;
            else delete this.typed[name];
            this.requestPreview();
          }
        } else if (this.typed[name] !== v) {
          this.setField(name, v);
        }
        break;
      }
    }
    if (!this.closed && this.sel === sel) this.openForm();
  }

  // enter is modal.lua's enter: nothing while a preview is in flight (the sets on screen are not
  // the previewed ones); not ready → the first invalid field; else apply.
  private async enter(): Promise<void> {
    if (!this.sel || this.updating) return;
    if (!this.ready) {
      const i = firstInvalid(this.fields);
      if (i !== undefined) await this.edit(this.fields[i].name);
      return;
    }
    await this.applyWith(this.sel.id, this.sets());
  }

  private async applyWith(id: string, s: Sets): Promise<void> {
    this.teardown();
    try {
      await this.env.apply(id, s);
    } finally {
      this.finish();
    }
  }

  private async review(): Promise<void> {
    const sel = this.sel;
    if (!sel) return;
    const planned = this.sets();
    let plan: PlanResult | null;
    try {
      plan = await this.env.server.request<PlanResult | null>('alder/plan', this.params({ id: sel.id, sets: planned }));
    } catch (err) {
      if (this.closed) return;
      this.env.ui.error(`alder: ${message(err)}`);
      if (!this.env.server.running()) this.close();
      return;
    }
    // the form changed while the plan was in flight: it is not the plan of what is on screen
    if (this.closed || this.sel !== sel || !sameSets(planned, this.sets())) return;
    const m = reviewModel(plan);
    if (m.files.length === 0 && m.canApply) {
      this.env.ui.info('alder: nothing to change');
      return;
    }
    this.closeForm();
    const choice = await this.env.ui.review(m, { title: sel.id, onActive: f => this.env.showPlanFile(f) });
    if (this.closed) return;
    if (choice === 'apply' && m.canApply) return this.applyWith(sel.id, planned);
    this.openForm();
  }

  private teardown(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.closeForm();
    this.env.preview.dispose();
  }

  close(): void {
    this.teardown();
    this.finish();
  }
}
```

Note on `setField`: it does not call `render()` itself, because `requestPreview` renders (title `updating…`). The form row shows the typed value from the same render.

- [ ] **Step 4: Run the tests and fix until green**

Run: `npm run test:unit`
Expected: all pass. If a test fails, the plan's test code is the specification. Change the implementation, not the assertion. If an assertion is self-contradictory, fix it and say so in the report.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/generate/flow.ts test/unit/flow.test.ts
git commit -m "generate: the flow state machine (port of modal.lua's state)"
```

---

### Task 4: Apply

**Files:**
- Create: `src/generate/apply.ts`, `test/e2e/apply.e2e.ts`, `test/e2e/fakeUi.ts`
- Modify: `test/e2e/run.ts` (the `gen` fixture), `src/extension.ts` (expose `generate` on `Api`)

**Interfaces:**
- Consumes: `Server`, `Origin`, `ApplyUi`, `FlowUi`, `FormModel`, `FormAnswer`, `TextView` (flow.ts); `PlanResult`, `PlanDiagnostic`, `Sets` (types.ts); `firstStale`, `firstRemoved`, `landing`, `appliedMessage`, `staleMessage`, `deletePrompt` (planCheck.ts).
- Produces:
  - `interface ApplyEnv { server: Server; root: string; ui: ApplyUi; diagnostics: vscode.DiagnosticCollection }`
  - `applyGenerator(env: ApplyEnv, origin: Origin, id: string, s: Sets): Promise<boolean>`
  - `textOf(path: string): Promise<string | null>` (an open document's text, else the file's, else null)
  - `test/e2e/fakeUi.ts`: `class FakeUi implements FlowUi` (Task 5 uses it too)
  - `Api.generate: { apply(origin: Origin, id: string, s: Sets, ui: ApplyUi): Promise<boolean>; diagnostics: vscode.DiagnosticCollection }` in extension.ts. Task 5 adds `run`.

- [ ] **Step 1: Add the `gen` fixture to `test/e2e/run.ts`.** Put it after the `fill` lines and before `demo`.

```ts
  // gen: a blog copy the generator tests change (created, edited and removed files), with an
  // unlinked page (Tags.Index) for `remove page`.
  copyExample(repo, 'blog', join(ws, 'gen'));
  execFileSync(bin, ['new', 'page', 'Tags.Index', '/tags', '--dir', join(ws, 'gen')], { stdio: 'ignore' });
```

- [ ] **Step 2: Write `test/e2e/fakeUi.ts`**

```ts
import type { ApplyUi, FlowUi, FormAnswer, FormModel, TextView } from '../../src/generate/flow';
import type { PickerRow } from '../../src/generate/picker';
import type { ReviewFile, ReviewModel } from '../../src/generate/review';
import type { Generator } from '../../src/generate/types';

// FakeUi answers the generator flow in a test: each step calls the matching handler; the
// messages land in log. The handlers default to Escape.
export class FakeUi implements FlowUi, ApplyUi {
  log: string[] = [];
  forms: { model: FormModel; answer(a: FormAnswer): void; closed: boolean }[] = [];
  texts: { title: string; value: string; onChange(t: string): void; validation?: string; finish(v: string | undefined): void }[] = [];
  onPick: (rows: PickerRow[]) => Generator | undefined = () => undefined;
  onPickOne: (o: { title: string; items: string[]; active?: string }) => string | undefined = () => undefined;
  onModule: (o: { value: string }) => string | undefined = () => undefined;
  onReview: (m: ReviewModel, o: { onActive(f: ReviewFile): void }) => 'apply' | 'back' = () => 'back';
  onConfirm: (message: string, action: string) => Promise<boolean> | boolean = () => false;

  info(m: string) { this.log.push(`info ${m}`); }
  warn(m: string) { this.log.push(`warn ${m}`); }
  error(m: string) { this.log.push(`error ${m}`); }
  async confirm(message: string, action: string) { this.log.push(`confirm ${message} [${action}]`); return this.onConfirm(message, action); }
  async pickGenerator(rows: PickerRow[]) { return this.onPick(rows); }
  form(model: FormModel, answer: (a: FormAnswer) => void) {
    const call = { model, answer, closed: false };
    this.forms.push(call);
    return { update: (m: FormModel) => { call.model = m; }, close: () => { call.closed = true; } };
  }
  async pickOne(o: { title: string; items: string[]; active?: string }) { return this.onPickOne(o); }
  async module(o: { title: string; value: string }) { return this.onModule(o); }
  text(o: { title: string; value: string; onChange(t: string): void }): TextView {
    let finish!: (v: string | undefined) => void;
    const result = new Promise<string | undefined>(r => { finish = r; });
    const entry = { title: o.title, value: o.value, onChange: o.onChange, validation: undefined as string | undefined, finish };
    this.texts.push(entry);
    return { setValidation: m => { entry.validation = m; }, result };
  }
  async review(m: ReviewModel, o: { title: string; onActive(f: ReviewFile): void }) { return this.onReview(m, o); }
  // form is the open form, if any
  get openForm() { const f = this.forms[this.forms.length - 1]; return f && !f.closed ? f : undefined; }
}
```

- [ ] **Step 3: Write the failing e2e test `test/e2e/apply.e2e.ts`.** It ports `apply_spec.lua` and calls the apply step directly through `Api.generate.apply`.

```ts
import * as assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { State } from 'vscode-languageclient/node';
import type { Origin } from '../../src/generate/flow';
import { FakeUi } from './fakeUi';
import { api, at, open, revert, until, ws } from './helpers';

const gen = () => join(ws(), 'gen');

// originAt is the origin of a generator request at needle in rel (gen/<rel>), the editor open.
async function originAt(rel: string, needle?: string): Promise<{ origin: Origin; editor: vscode.TextEditor }> {
  const editor = await open(`gen/${rel}`);
  const position = needle ? at(editor.document, needle) : new vscode.Position(0, 0);
  editor.selection = new vscode.Selection(position, position);
  // the server answers generators from its last good build: wait for one
  const client = await (await api()).clients.forUri(editor.document.uri);
  assert.ok(client && client.state === State.Running);
  await until(async () => ((await client.sendRequest<{ generators?: unknown[] }>('alder/generators', {
    textDocument: { uri: editor.document.uri.toString() }, position: { line: position.line, character: position.character },
  }))?.generators ?? []).length > 0, 'generators from a good build');
  return { origin: { uri: editor.document.uri.toString(), position: { line: position.line, character: position.character }, root: gen() }, editor };
}

describe('Generate: apply', () => {
  it('new msg edits the open document unsaved, lands on the first hole, one undo restores it', async () => {
    const { origin, editor } = await originAt('app/Posts/Index.alder', 'load params');
    const doc = editor.document;
    const before = doc.getText();
    const ui = new FakeUi();
    try {
      assert.equal(await (await api()).generate.apply(origin, 'new msg', { name: 'Delete' }, ui), true, ui.log.join('\n'));
      assert.deepEqual(ui.log, ['info alder: applied new msg: app/Posts/Index.alder (2 holes)']);
      assert.ok(doc.getText().includes('Delete'));
      assert.ok(doc.isDirty);
      assert.ok(!readFileSync(join(gen(), 'app/Posts/Index.alder'), 'utf8').includes('Delete'), 'wrote to disk');
      const ed = vscode.window.activeTextEditor!;
      assert.equal(ed.document.uri.toString(), doc.uri.toString());
      const line = ed.document.lineAt(ed.selection.active.line).text;
      assert.equal(line.slice(ed.selection.active.character, ed.selection.active.character + '?delete'.length), '?delete', line);
      await vscode.commands.executeCommand('undo');
      assert.equal(doc.getText(), before, 'one undo does not restore the document');
    } finally {
      await revert(doc);
    }
  });

  it('new page creates an unsaved document for the module', async () => {
    const { origin } = await originAt('app/Posts/Index.alder');
    const ui = new FakeUi();
    const rel = 'app/Tags2/Index.alder';
    try {
      assert.equal(await (await api()).generate.apply(origin, 'new page', { module: 'Tags2.Index', path: '/tags2' }, ui), true, ui.log.join('\n'));
      assert.match(ui.log[0], /^info alder: applied new page: .*app\/Tags2\/Index\.alder/);
      const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === join(gen(), rel));
      assert.ok(doc, 'no document for the new page');
      assert.ok(doc.isDirty && doc.getText().includes('module Tags2.Index'));
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, join(gen(), rel));
    } finally {
      for (const d of vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.fsPath.startsWith(gen()))) await revert(d);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      rmSync(join(gen(), 'app/Tags2'), { recursive: true, force: true });
    }
  });

  it('a refusal is the server text, its diagnostics go to the alder generate collection, nothing changes', async () => {
    const { origin, editor } = await originAt('app/Posts/Index.alder');
    const before = editor.document.getText();
    const ui = new FakeUi();
    assert.equal(await (await api()).generate.apply(origin, 'new page', { module: 'Posts.Index', path: '/again' }, ui), false);
    assert.equal(ui.log.length, 1);
    assert.match(ui.log[0], /^error .*Posts\.Index/);
    assert.equal(editor.document.getText(), before);
    assert.ok(!editor.document.isDirty);
  });

  it('remove page asks; No applies nothing', async () => {
    const { origin } = await originAt('app/Tags/Index.alder');
    const ui = new FakeUi();
    ui.onConfirm = () => false;
    assert.equal(await (await api()).generate.apply(origin, 'remove page', { page: 'Tags.Index' }, ui), false);
    assert.deepEqual(ui.log, ['confirm Delete app/Tags/Index.alder from disk? undo cannot restore it [Delete]']);
    assert.ok(existsSync(join(gen(), 'app/Tags/Index.alder')));
  });

  it('remove page re-checks after the confirm: an edit made meanwhile aborts', async () => {
    const { origin, editor } = await originAt('app/Tags/Index.alder');
    const ui = new FakeUi();
    ui.onConfirm = async () => {
      await editor.edit(b => b.insert(new vscode.Position(0, 0), '-- typed meanwhile\n'));
      return true;
    };
    try {
      assert.equal(await (await api()).generate.apply(origin, 'remove page', { page: 'Tags.Index' }, ui), false);
      assert.equal(ui.log[1], 'error alder: app/Tags/Index.alder changed since planning; nothing applied');
      assert.ok(existsSync(join(gen(), 'app/Tags/Index.alder')));
    } finally {
      await revert(editor.document);
    }
  });

  it('remove page with Delete removes the file', async () => {
    const { origin } = await originAt('app/Tags/Index.alder');
    const ui = new FakeUi();
    ui.onConfirm = () => true;
    try {
      assert.equal(await (await api()).generate.apply(origin, 'remove page', { page: 'Tags.Index' }, ui), true, ui.log.join('\n'));
      assert.match(ui.log[1], /^info alder: applied remove page: .*app\/Tags\/Index\.alder/);
      assert.ok(!existsSync(join(gen(), 'app/Tags/Index.alder')));
    } finally {
      for (const d of vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.fsPath.startsWith(gen()))) await revert(d);
    }
  });
});
```

This test must run last among the `gen` tests, because it deletes `Tags/Index.alder`. Mocha runs `it`s in file order, so keep it last.

The refusal sets: if the server accepts `new page` with an existing module differently, for example by naming a different field, run `alder new page Posts.Index /again --dir <copy> --dry-run --json` against a blog copy to see the field names and the refusal text. Then adjust only the sets. Do the same for `remove page`'s `page` field and `new page`'s `module`/`path` fields; `alder help new page --json` lists them.

- [ ] **Step 4: Run it to see it fail**

Run: `ALDER_BIN=$(go env GOPATH)/bin/alder ALDER_REPO=~/projects/alder ALDER_E2E_ONLY=apply npm run test:e2e`
Expected: `tsc` fails because `Api.generate` doesn't exist.

- [ ] **Step 5: Write `src/generate/apply.ts`**

```ts
import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import type { ApplyUi, Origin, Server } from './flow';
import { appliedMessage, deletePrompt, firstRemoved, firstStale, landing, staleMessage } from './planCheck';
import type { PlanDiagnostic, PlanResult, Sets } from './types';

// apply: the port of apply.lua. It plans the generator again with the sets the user saw, checks
// that nothing changed since, and applies every file as one WorkspaceEdit (one undo step):
// edited and created files are left unsaved; a removed file is deleted after a confirm.

export interface ApplyEnv { server: Server; root: string; ui: ApplyUi; diagnostics: vscode.DiagnosticCollection }

// textOf is a file's text as the user sees it: the open document's, else the file's, else null.
export async function textOf(path: string): Promise<string | null> {
  const doc = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === path);
  if (doc) return doc.getText();
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

// refusal is a refused plan's diagnostics by file. They describe the dry-run copy, so they go to
// their own collection, never the server's.
function refusal(root: string, ds: PlanDiagnostic[]): [vscode.Uri, vscode.Diagnostic[]][] {
  const by = new Map<string, vscode.Diagnostic[]>();
  for (const d of ds) {
    const p = new vscode.Position(Math.max(d.line - 1, 0), Math.max(d.col - 1, 0));
    const diag = new vscode.Diagnostic(new vscode.Range(p, p), `${d.code} ${d.message}`,
      d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
    diag.source = 'alder generate';
    const key = join(root, d.file);
    by.set(key, [...(by.get(key) ?? []), diag]);
  }
  return [...by].map(([p, list]) => [vscode.Uri.file(p), list]);
}

export async function applyGenerator(env: ApplyEnv, origin: Origin, id: string, s: Sets): Promise<boolean> {
  env.diagnostics.clear();
  let plan: PlanResult | null;
  try {
    plan = await env.server.request<PlanResult | null>('alder/plan', { textDocument: { uri: origin.uri }, position: origin.position, id, sets: s });
  } catch (err) {
    env.ui.error(`alder: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  if (!plan) return false;
  if (plan.error) {
    env.ui.error(plan.error);
    env.diagnostics.set(refusal(env.root, plan.diagnostics ?? []));
    return false;
  }
  const files = plan.files ?? [];
  // unchanged runs again after the delete confirm: the user may type while it is open
  const unchanged = async () => {
    const stale = await firstStale(files, rel => textOf(join(env.root, rel)));
    if (stale) env.ui.error(staleMessage(stale));
    return !stale;
  };
  if (!(await unchanged())) return false;
  const removed = firstRemoved(files);
  if (removed && (!(await env.ui.confirm(deletePrompt(removed), 'Delete')) || !(await unchanged()))) return false;

  const edit = new vscode.WorkspaceEdit();
  for (const f of files) {
    const uri = vscode.Uri.file(join(env.root, f.path));
    if (f.after === null) {
      edit.deleteFile(uri, { ignoreIfNotExists: true });
    } else if (f.before === null) {
      edit.createFile(uri, { ignoreIfExists: false });
      edit.insert(uri, new vscode.Position(0, 0), f.after);
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), f.after);
    }
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    env.ui.error(`alder: ${id} could not be applied; nothing applied`);
    return false;
  }

  const active = vscode.window.activeTextEditor?.document.uri;
  const activeRel = active?.scheme === 'file' ? relative(env.root, active.fsPath).split(sep).join('/') : undefined;
  const land = landing(plan, activeRel);
  if (land) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(join(env.root, land.kind === 'hole' ? land.file : land.path)));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (land.kind === 'hole') {
      const p = new vscode.Position(land.line, land.col);
      editor.selection = new vscode.Selection(p, p);
      editor.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }
  env.ui.info(appliedMessage(id, plan));
  return true;
}
```

- [ ] **Step 6: Expose it on the `Api` in `src/extension.ts`.** Task 5 moves the collection into `command.ts`; for now create it here.

In `interface Api`, add:

```ts
  generate: {
    apply(origin: Origin, id: string, s: Sets, ui: ApplyUi): Promise<boolean>;
    diagnostics: vscode.DiagnosticCollection;
  };
```

with imports `import { applyGenerator } from './generate/apply';`, `import type { ApplyUi, Origin } from './generate/flow';` and `import type { Sets } from './generate/types';`. In `activate`, before the `return`:

```ts
  const genDiagnostics = vscode.languages.createDiagnosticCollection('alder generate');
  context.subscriptions.push(genDiagnostics);
  const generateApply = async (origin: Origin, id: string, s: Sets, ui: ApplyUi) => {
    const client = await cs.forUri(origin.uri);
    if (!client) {
      ui.error('alder: no alder lsp running for this file');
      return false;
    }
    const server = { request: <T>(m: string, p: unknown) => client.sendRequest<T>(m, p), running: () => client.state === State.Running };
    return applyGenerator({ server, root: origin.root, ui, diagnostics: genDiagnostics }, origin, id, s);
  };
```

and in the returned object `generate: { apply: generateApply, diagnostics: genDiagnostics },`. Import `State` from `vscode-languageclient/node`.

- [ ] **Step 7: Run the apply e2e**

Run: `ALDER_BIN=$(go env GOPATH)/bin/alder ALDER_REPO=~/projects/alder ALDER_E2E_ONLY=apply npm run test:e2e`
Expected: the 6 `Generate: apply` tests pass. Then run the whole e2e suite to check that the `gen` fixture broke no other test.

If `undo` takes more than one step, the edit is reaching the document as several edits. Make sure the edit is a single `WorkspaceEdit` and nothing else edits the document. Then report it; do not loosen the assertion.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint && npm run test:unit
git add src/generate/apply.ts src/extension.ts test/e2e/apply.e2e.ts test/e2e/fakeUi.ts test/e2e/run.ts
git commit -m "generate: apply a plan as one WorkspaceEdit (port of apply.lua)"
```

---

### Task 5: The VS Code UI, preview document, origin, command, docs

**Files:**
- Create: `src/generate/ui.ts`, `src/generate/previewDoc.ts`, `src/generate/origin.ts`, `src/generate/command.ts`, `test/e2e/generate.e2e.ts`
- Modify: `src/extension.ts`, `src/commands.ts`, `package.json`, `test/unit/legend.test.ts`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `Flow`, `FlowUi`, `FormModel`, `FormAnswer`, `PreviewSink`, `Origin`, `asPreset` (flow.ts); `applyGenerator` (apply.ts); `entryFile` (entry.ts); `ReviewFile` (review.ts); `PickerRow` (picker.ts); `Clients` (client.ts), `requireRoot` (project.ts), `findRoot` (root.ts), `VirtualDocs` (virtualDocs.ts), `Deps` (deps.ts).
- Produces:
  - `quickInputUi(): FlowUi`
  - `class PreviewDoc implements PreviewSink { constructor(docs: VirtualDocs, n: number) }`
  - `findOrigin(clients: Clients): Promise<{ origin: Origin; client: LanguageClient } | undefined>`
  - `class Generate { constructor(deps: Deps); register(context): void; run(preset?: Preset, ui?: FlowUi): Promise<void>; apply(origin, id, sets, ui): Promise<boolean>; readonly diagnostics: vscode.DiagnosticCollection }`
  - `Api.generate` becomes `{ run(preset?: unknown, ui?: FlowUi): Promise<void>; apply(...): Promise<boolean>; diagnostics }`

- [ ] **Step 1: Write the failing e2e `test/e2e/generate.e2e.ts`**

```ts
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { FakeUi } from './fakeUi';
import { api, at, open, revert, until, ws } from './helpers';

describe('Generate: the flow', () => {
  it('new msg on a page: the starting-value field opens first, apply writes it unsaved and lands on the first hole', async () => {
    const editor = await open('gen/app/Posts/Index.alder');
    const doc = editor.document;
    const p = at(doc, 'load params');
    editor.selection = new vscode.Selection(p, p);
    const ui = new FakeUi();
    ui.onPick = rows => {
      const g = rows.flatMap(r => ('item' in r ? [r.item] : [])).find(x => x.id === 'new msg');
      assert.ok(g, JSON.stringify(rows));
      return g;
    };
    try {
      const running = vscode.commands.executeCommand('alder.generate', undefined, ui);
      const name = await until(() => ui.texts.find(t => t.title === 'new msg: name'), 'the name editor to open first');
      name.onChange('Delete');
      name.finish('Delete');
      const form = await until(() => (ui.openForm?.model.ready ? ui.openForm : undefined), 'a ready form');
      assert.equal(form.model.rows.find(r => r.name === 'name')?.value, 'Delete');
      const preview = vscode.workspace.textDocuments.find(d => d.uri.path.endsWith('Generate Preview.diff'));
      assert.ok(preview, 'no preview document');
      assert.ok(preview.getText().includes('Delete'), preview.getText());
      form.answer({ kind: 'apply' });
      await running;
      assert.ok(ui.log.includes('info alder: applied new msg: app/Posts/Index.alder (2 holes)'), ui.log.join('\n'));
      assert.ok(doc.isDirty && doc.getText().includes('Delete'));
      assert.ok(!readFileSync(join(ws(), 'gen/app/Posts/Index.alder'), 'utf8').includes('Delete'));
      const ed = vscode.window.activeTextEditor!;
      assert.ok(ed.document.lineAt(ed.selection.active.line).text.slice(ed.selection.active.character).startsWith('?delete'));
      await until(() => !vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.label.includes('Generate Preview'))), 'the preview tab to close');
    } finally {
      await revert(doc);
    }
  });

  it('a code action preset opens the form without the picker', async () => {
    const editor = await open('gen/app/Posts/Index.alder');
    const doc = editor.document;
    const p = at(doc, 'load params');
    const actions = await until(async () => {
      const acts = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, new vscode.Range(p, p));
      return acts?.filter(a => a.command?.command === 'alder.generate').length ? acts : undefined;
    }, 'generator code actions');
    const action = actions.find(a => a.command?.command === 'alder.generate')!;
    const ui = new FakeUi();
    let picked = false;
    ui.onPick = () => { picked = true; return undefined; };
    const running = vscode.commands.executeCommand('alder.generate', ...(action.command!.arguments ?? []), ui);
    const form = await until(() => ui.openForm ?? ui.texts[0], 'the form or its first field');
    assert.ok(!picked);
    assert.ok(form);
    if (ui.texts[0]) ui.texts[0].finish(undefined);
    await until(() => ui.openForm, 'the form');
    ui.openForm!.answer({ kind: 'escape' });
    await running;
  });

  it('the real picker closes the flow on hide', async () => {
    await open('gen/app/Posts/Index.alder');
    let done = false;
    const running = Promise.resolve(vscode.commands.executeCommand('alder.generate')).then(() => { done = true; });
    await new Promise(r => setTimeout(r, 1500));
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    await until(() => done, 'the flow to end after the picker hid', 5000);
    await running;
  });
});
```

The entry-file fallback of `findOrigin` is covered by `entry.test.ts`. An e2e for it would depend on which of the workspace's apps `requireRoot` picks. If lint flags `api` as unused, remove it from the imports.

- [ ] **Step 2: Run it to see it fail**

Run: `ALDER_BIN=$(go env GOPATH)/bin/alder ALDER_REPO=~/projects/alder ALDER_E2E_ONLY=generate npm run test:e2e`
Expected: FAIL. `alder.generate` still shows "Generate is not implemented yet", so `the name editor to open first` times out.

- [ ] **Step 3: Write `src/generate/previewDoc.ts`**

```ts
import * as vscode from 'vscode';
import type { VirtualDocs } from '../virtualDocs';
import type { PreviewSink } from './flow';

// PreviewDoc is a flow's live preview: a read-only diff document opened once beside the origin
// without taking focus; each answer replaces its text and scrolls to the first hunk. dispose
// closes its tab.
export class PreviewDoc implements PreviewSink {
  private readonly path: string;
  private readonly uri: vscode.Uri;
  private opened: Thenable<vscode.TextEditor> | undefined;
  private hunk = 0;
  private readonly sub: vscode.Disposable;
  private disposed = false;

  constructor(private readonly docs: VirtualDocs, n: number) {
    this.path = `generate/${n}/Generate Preview.diff`;
    this.uri = docs.set(this.path, '');
    // the provider's onDidChange reloads the document after show: scroll once the new text is in
    this.sub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === this.uri.toString()) this.reveal();
    });
  }

  show(lines: string[], firstHunk: number): void {
    if (this.disposed) return;
    this.hunk = firstHunk;
    this.docs.set(this.path, lines.join('\n'));
    if (!this.opened) {
      this.opened = vscode.window.showTextDocument(this.uri, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: true });
      this.opened.then(() => this.reveal(), () => undefined);
    }
  }

  private reveal(): void {
    const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === this.uri.toString());
    if (ed) ed.revealRange(new vscode.Range(this.hunk, 0, this.hunk, 0), vscode.TextEditorRevealType.AtTop);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sub.dispose();
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs)
      .filter(t => t.input instanceof vscode.TabInputText && t.input.uri.toString() === this.uri.toString());
    if (tabs.length > 0) void vscode.window.tabGroups.close(tabs);
  }
}
```

- [ ] **Step 4: Write `src/generate/origin.ts`**

```ts
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import type { Clients } from '../client';
import { requireRoot } from '../project';
import { findRoot } from '../root';
import { entryFile } from './entry';
import type { Origin } from './flow';

const WAIT_MS = 5000;

// findOrigin is the document and cursor every generator request carries, as
// project.with_alder_buf: the active editor when it is an alder file with a running client;
// else the root's entry file, opened without showing it (the client sends didOpen), waiting up
// to 5 s for its client.
export async function findOrigin(clients: Clients): Promise<{ origin: Origin; client: LanguageClient } | undefined> {
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document.languageId === 'alder' && ed.document.uri.scheme === 'file') {
    const root = await findRoot(ed.document.uri.fsPath);
    const client = root ? await clients.ensure(ed.document) : undefined;
    if (root && client) {
      const a = ed.selection.active;
      return { origin: { uri: ed.document.uri.toString(), position: { line: a.line, character: a.character }, root }, client };
    }
  }
  const root = await requireRoot(clients);
  if (!root) return undefined;
  const file = await entryFile(root);
  if (!file) {
    void vscode.window.showWarningMessage('alder: no .alder file under app/');
    return undefined;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const client = await Promise.race([clients.ensure(doc), new Promise<undefined>(r => setTimeout(() => r(undefined), WAIT_MS))]);
  if (!client) {
    void vscode.window.showErrorMessage('alder: no alder lsp running for this file');
    return undefined;
  }
  return { origin: { uri: doc.uri.toString(), position: { line: 0, character: 0 }, root }, client };
}
```

- [ ] **Step 5: Write `src/generate/ui.ts`**

```ts
import * as vscode from 'vscode';
import type { FlowUi, FormAnswer, FormModel, TextView } from './flow';
import type { PickerRow } from './picker';
import type { ReviewFile, ReviewModel } from './review';
import type { Generator } from './types';

// ui: the flow's steps as VS Code quick inputs. Every one keeps ignoreFocusOut, so the preview
// and the review's diff can update beside it without closing it. A hide the flow did not ask
// for (Escape) is the step's "nothing".

const reviewButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('diff'), tooltip: 'Review the plan' };
const applyButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('check'), tooltip: 'Apply (Ctrl+Enter)' };

const setFormOpen = (on: boolean) => void vscode.commands.executeCommand('setContext', 'alder.formOpen', on);

// once runs a quick input until it accepts (resolve with a value) or hides (resolve with none).
function once<T, I extends vscode.QuickPickItem>(qp: vscode.QuickPick<I>, accept: (resolve: (v: T) => void) => void, none: T): Promise<T> {
  return new Promise<T>(resolve => {
    let done = false;
    const finish = (v: T) => {
      if (done) return;
      done = true;
      qp.dispose();
      resolve(v);
    };
    qp.onDidAccept(() => accept(finish));
    qp.onDidHide(() => finish(none));
    qp.show();
  });
}

interface FieldItem extends vscode.QuickPickItem { name?: string; apply?: boolean }

export function quickInputUi(): FlowUi {
  return {
    info: m => void vscode.window.showInformationMessage(m),
    warn: m => void vscode.window.showWarningMessage(m),
    error: m => void vscode.window.showErrorMessage(m),
    confirm: async (message, action) => (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action,

    pickGenerator(rows: PickerRow[]) {
      const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { g?: Generator }>();
      qp.title = 'Alder: Generate';
      qp.placeholder = 'a generator';
      qp.matchOnDescription = true;
      qp.ignoreFocusOut = true;
      qp.items = rows.map(r => ('heading' in r
        ? { label: r.heading, kind: vscode.QuickPickItemKind.Separator }
        : { label: r.item.id, description: r.item.summary, detail: r.item.why, g: r.item }));
      return once<Generator | undefined, vscode.QuickPickItem & { g?: Generator }>(qp, done => {
        const g = qp.activeItems[0]?.g;
        if (g) done(g);
      }, undefined);
    },

    form(m: FormModel, answer: (a: FormAnswer) => void) {
      const qp = vscode.window.createQuickPick<FieldItem>();
      qp.ignoreFocusOut = true;
      qp.matchOnDescription = true;
      let closing = false;
      const paint = (model: FormModel) => {
        const keep = qp.activeItems[0];
        const want = keep ? (keep.apply ? '\0apply' : keep.name) : model.active;
        qp.title = model.title;
        qp.busy = model.updating;
        qp.buttons = [vscode.QuickInputButtons.Back, reviewButton, ...(model.ready ? [applyButton] : [])];
        const items: FieldItem[] = model.rows.map(r => ({
          label: r.name,
          description: r.value,
          detail: r.note === undefined ? undefined : r.error ? `$(error) ${r.note}` : r.note,
          name: r.name,
        }));
        items.push({ label: '$(check) Apply', description: model.ready ? '' : 'not ready', apply: true, alwaysShow: true });
        qp.items = items;
        const a = items.find(i => (want === '\0apply' ? i.apply : i.name === want));
        if (a) qp.activeItems = [a];
      };
      paint(m);
      qp.onDidAccept(() => {
        const item = qp.activeItems[0];
        if (!item) return;
        answer(item.apply ? { kind: 'apply' } : { kind: 'field', name: item.name! });
      });
      qp.onDidTriggerButton(b => {
        if (b === vscode.QuickInputButtons.Back) answer({ kind: 'back' });
        else if (b === reviewButton) answer({ kind: 'review' });
        else if (b === applyButton) answer({ kind: 'apply' });
      });
      qp.onDidHide(() => {
        setFormOpen(false);
        if (closing) return;
        closing = true;
        qp.dispose();
        answer({ kind: 'escape' });
      });
      qp.show();
      setFormOpen(true);
      return {
        update: paint,
        close: () => {
          if (closing) return;
          closing = true;
          setFormOpen(false);
          qp.dispose();
        },
      };
    },

    pickOne(o) {
      const qp = vscode.window.createQuickPick();
      qp.title = o.title;
      qp.placeholder = o.placeholder;
      qp.ignoreFocusOut = true;
      qp.items = o.items.map(label => ({ label }));
      const a = qp.items.find(i => i.label === o.active);
      if (a) qp.activeItems = [a];
      return once<string | undefined, vscode.QuickPickItem>(qp, done => {
        const item = qp.activeItems[0];
        if (item) done(item.label);
      }, undefined);
    },

    module(o) {
      type Item = vscode.QuickPickItem & { typed?: boolean };
      const qp = vscode.window.createQuickPick<Item>();
      qp.title = o.title;
      qp.ignoreFocusOut = true;
      qp.value = o.value;
      const paint = () => {
        const s = o.suggest(qp.value);
        qp.items = [
          { label: s.help, description: 'Enter uses this name', alwaysShow: true, typed: true },
          ...s.suggestions.map(x => ({ label: x, description: 'Enter completes', alwaysShow: true })),
        ];
      };
      paint();
      qp.onDidChangeValue(paint);
      return once<string | undefined, Item>(qp, done => {
        const item = qp.activeItems[0];
        if (!item || item.typed) return done(qp.value);
        // a folder prefix goes into the input and the picker stays open
        qp.value = item.label;
        paint();
      }, undefined);
    },

    text(o): TextView {
      const ib = vscode.window.createInputBox();
      ib.title = o.title;
      ib.value = o.value;
      ib.prompt = o.prompt;
      ib.placeholder = o.placeholder;
      ib.ignoreFocusOut = true;
      const result = new Promise<string | undefined>(resolve => {
        let done = false;
        const finish = (v: string | undefined) => {
          if (done) return;
          done = true;
          ib.dispose();
          resolve(v);
        };
        ib.onDidChangeValue(t => o.onChange(t));
        ib.onDidAccept(() => finish(ib.value));
        ib.onDidHide(() => finish(undefined));
      });
      ib.show();
      return { setValidation: m => { ib.validationMessage = m; }, result };
    },

    review(m: ReviewModel, o: { title: string; onActive(f: ReviewFile): void }) {
      type Item = vscode.QuickPickItem & { file?: ReviewFile };
      const qp = vscode.window.createQuickPick<Item>();
      qp.title = `${o.title}: review`;
      qp.placeholder = m.canApply ? 'Enter applies · Escape goes back' : 'cannot apply · Escape goes back';
      qp.ignoreFocusOut = true;
      const applyNow: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('check'), tooltip: 'Apply' };
      qp.buttons = [vscode.QuickInputButtons.Back, ...(m.canApply ? [applyNow] : [])];
      qp.items = [
        { label: 'plan', kind: vscode.QuickPickItemKind.Separator },
        ...(m.notes.length > 0 ? m.notes : ['no holes, no warnings']).map(n => ({ label: n })),
        { label: 'files', kind: vscode.QuickPickItemKind.Separator },
        ...m.files.map(f => ({ label: `${f.mark} ${f.path}`, file: f })),
      ];
      const first = qp.items.find(i => i.file);
      if (first) {
        qp.activeItems = [first];
        o.onActive(first.file!);
      }
      qp.onDidChangeActive(items => { if (items[0]?.file) o.onActive(items[0].file); });
      return new Promise<'apply' | 'back'>(resolve => {
        let done = false;
        const finish = (v: 'apply' | 'back') => {
          if (done) return;
          done = true;
          qp.dispose();
          resolve(v);
        };
        qp.onDidAccept(() => { if (m.canApply) finish('apply'); });
        qp.onDidTriggerButton(b => finish(b === applyNow ? 'apply' : 'back'));
        qp.onDidHide(() => finish('back'));
        qp.show();
      });
    },
  };
}
```

The apply item's label is `$(check) Apply` in both states, with `not ready` in the description.

- [ ] **Step 6: Write `src/generate/command.ts`**

```ts
import * as vscode from 'vscode';
import { State } from 'vscode-languageclient/node';
import type { Deps } from '../deps';
import { applyGenerator } from './apply';
import { ApplyUi, asPreset, Flow, FlowUi, Origin, Server } from './flow';
import { findOrigin } from './origin';
import { PreviewDoc } from './previewDoc';
import type { ReviewFile } from './review';
import type { Sets } from './types';
import { quickInputUi } from './ui';

// Generate owns alder.generate (the flow; a code action's argument presets it) and
// alder.generate.apply (Ctrl+Enter in the form). One flow at a time: a new one closes the old.
export class Generate {
  readonly diagnostics = vscode.languages.createDiagnosticCollection('alder generate');
  private active: Flow | undefined;
  private count = 0;

  constructor(private readonly deps: Deps) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this.diagnostics,
      vscode.commands.registerCommand('alder.generate', (preset?: unknown, ui?: FlowUi) =>
        this.run(preset, ui && typeof ui.form === 'function' ? ui : undefined)),
      vscode.commands.registerCommand('alder.generate.apply', () => this.active?.answer({ kind: 'apply' })),
    );
  }

  private server(origin: Origin): Promise<Server | undefined> {
    return this.deps.clients.forUri(origin.uri).then(client => client && {
      request: <T>(m: string, p: unknown) => client.sendRequest<T>(m, p),
      running: () => client.state === State.Running,
    });
  }

  async apply(origin: Origin, id: string, s: Sets, ui: ApplyUi): Promise<boolean> {
    const server = await this.server(origin);
    if (!server) {
      ui.error('alder: no alder lsp running for this file');
      return false;
    }
    return applyGenerator({ server, root: origin.root, ui, diagnostics: this.diagnostics }, origin, id, s);
  }

  private showPlanFile(n: number, f: ReviewFile): void {
    const before = this.deps.docs.set(`plan/${n}/before/${f.path}`, f.before);
    const after = this.deps.docs.set(`plan/${n}/after/${f.path}`, f.after);
    void vscode.commands.executeCommand('vscode.diff', before, after, `${f.path} (plan)`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: true });
  }

  async run(arg?: unknown, ui: FlowUi = quickInputUi()): Promise<void> {
    this.active?.close();
    const found = await findOrigin(this.deps.clients);
    if (!found) return;
    const n = ++this.count;
    const { origin, client } = found;
    const server: Server = { request: (m, p) => client.sendRequest(m, p), running: () => client.state === State.Running };
    const flow = new Flow({
      server,
      ui,
      preview: new PreviewDoc(this.deps.docs, n),
      apply: (id, s) => applyGenerator({ server, root: origin.root, ui, diagnostics: this.diagnostics }, origin, id, s),
      showPlanFile: f => this.showPlanFile(n, f),
    }, origin);
    this.active = flow;
    try {
      await flow.start(asPreset(arg));
      await flow.done;
    } finally {
      if (this.active === flow) this.active = undefined;
    }
  }
}
```

The `server(origin)` helper serves `apply`. If lint objects to the `.then` form, write it with `async`/`await`.

- [ ] **Step 7: Wire it into `src/extension.ts`.** Replace Task 4's inline collection and `generateApply`.
  - Import `Generate` from `./generate/command`.
  - After `tests.register(context);`, add `const generate = new Generate(deps); generate.register(context);`.
  - Change `Api.generate` to `{ run(preset?: unknown, ui?: FlowUi): Promise<void>; apply(origin: Origin, id: string, s: Sets, ui: ApplyUi): Promise<boolean>; diagnostics: vscode.DiagnosticCollection }`.
  - Return `generate: { run: (p, ui) => generate.run(p, ui), apply: (o, id, s, ui) => generate.apply(o, id, s, ui), diagnostics: generate.diagnostics }`.
  - Remove the Task 4 `genDiagnostics`/`generateApply` code, and the `applyGenerator`/`State` imports if they are now unused.

- [ ] **Step 8: `src/commands.ts`.** Remove `'alder.generate': 'Generate',` from `NOT_YET` and change its comment to `// NOT_YET are the commands a later milestone fills in (6: scratch). Each says so when run.`

- [ ] **Step 9: `package.json`.** Under `contributes.commands`, add:

```json
      {
        "command": "alder.generate.apply",
        "title": "Apply Generator",
        "category": "Alder"
      },
```

Under `contributes.keybindings`, add:

```json
      {
        "command": "alder.generate.apply",
        "key": "ctrl+enter",
        "mac": "cmd+enter",
        "when": "alder.formOpen && inQuickOpen"
      },
```

Add `contributes.menus`, or extend it if it exists:

```json
    "menus": {
      "commandPalette": [
        { "command": "alder.generate.apply", "when": "false" }
      ]
    },
```

`test/unit/legend.test.ts`: rename the test to `package.json contributes the thirteen Alder commands, each with a category` and add `'alder.generate.apply'` after `'alder.generate'` in the expected sorted list.

- [ ] **Step 10: README and CHANGELOG.** In `README.md` under `## Commands`, before **Routes**, add:

```markdown
- **Generate** (`g`): pick a generator (the ones that apply at the cursor first), fill in its
  form while a diff preview updates beside it, review the plan (the diff button), and apply
  (Enter on Apply, or `ctrl+enter` / `cmd+enter` from any field). The result is one undo step:
  edited and new files are left unsaved, and a file the generator removes is deleted only after
  you confirm. The generator code actions (the lightbulb) open the same flow, already filled in.
```

In `CHANGELOG.md` under `## Unreleased`, add `- Generate: the generator flow with a live preview, review and one-step apply (alder#144 milestone 5).`

- [ ] **Step 11: Run everything**

```bash
npm run lint && npm run test:unit
ALDER_BIN=$(go env GOPATH)/bin/alder ALDER_REPO=~/projects/alder npm run test:e2e
npm run package
```

Expected: lint is clean, every unit test passes, every e2e passes (all M3/M4 tests included), and the `.vsix` builds. Check whether `client.e2e.ts` or other tests asserted "Generate is not implemented yet". The earlier grep found no such test; if one exists, update it to the new behaviour.

- [ ] **Step 12: Commit**

```bash
git add -A src test package.json README.md CHANGELOG.md
git commit -m "generate: quick input flow, preview document, review diff, Ctrl+Enter apply"
```

---

## After the tasks

- Whole-branch review (Opus): the diff against `main`, read against the spec section and this plan's Review Focus.
- PR to tapegram/alder-vscode titled "Generator flow (alder#144 M5)". List the deviations: the preview and plan documents use the existing `alder-doc` scheme through `VirtualDocs`, not `alder-preview:`/`alder-plan:`; there is no `sortByLabel` (it is a proposed API); first-to-fill happens when a generator is picked, because a QuickPick has no "Enter from the list" step; Escape in a field editor returns to the form and restores the value; the review is in this PR.
- Wait for CI on all three jobs, then squash-merge.
