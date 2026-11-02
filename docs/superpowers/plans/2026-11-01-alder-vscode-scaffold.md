# alder-vscode scaffold (alder#144, milestone 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `tapegram/alder-vscode` repository whose extension registers the Alder language (with a fallback TextMate grammar), finds and gates the `alder` binary, runs one `alder lsp` client per app root, and is tested against the real server in CI and packaged as a `.vsix`. At the end, everything the stock client gives works: diagnostics, hover, definition, references, completion, code actions, formatting, inlay hints, colour swatches, semantic tokens, folding, selection, and `Fill ?h with AI`.

**Architecture:** TypeScript on `vscode-languageclient`, bundled by esbuild to `dist/extension.js`. Modules that do not need VS Code (`root.ts`, `health.ts`, `clientConfig.ts`, `legend.ts`, `scratch.ts`) have no `vscode` import and are unit-tested with `node --test`. `client.ts` and `extension.ts` hold the VS Code glue and are covered by contract tests that run in a real VS Code (`@vscode/test-electron`) against an `alder` binary built from the pinned alder checkout, on fixtures copied from it.

**Tech Stack:** TypeScript 5.x (`module: node16`), `vscode-languageclient` 11, esbuild, `@vscode/vsce`, `@vscode/test-electron` + mocha (contract), `node:test` (unit), `vscode-textmate` + `vscode-oniguruma` (grammar unit tests), eslint with `typescript-eslint`. Node 22 in CI.

**Spec:** `docs/superpowers/specs/2026-11-01-vscode-extension-design.md` on tapegram/alder main (https://github.com/tapegram/alder/blob/main/docs/superpowers/specs/2026-11-01-vscode-extension-design.md). Sections this plan implements: "Repository and layout", "Language registration", "Binary discovery and the version gate", "The client", "Commands, keys, settings" (registration only), "Packaging", "Extension tests" (harnesses plus the contract cases this milestone can pass), and milestone 3 under "Milestones". Read the spec before starting a task.

## Global Constraints

- Repository `tapegram/alder-vscode`, public (as alder.nvim is), licence Apache-2.0 (copy alder.nvim's `LICENSE`).
- Extension id `tapegram.alder` (`publisher: tapegram`, `name: alder`), display name "Alder", language id `alder`, extension `.alder`, alias `Alder`.
- No runtime dependencies beyond `vscode-languageclient`; everything else is a devDependency.
- **Deviations from the spec, on purpose:** `vscode-languageclient` 11 (the spec says 9; 11 is current and needs `engines.vscode ^1.91.0`, so the floor is `^1.91.0`, not `^1.90`); Node 22 in CI (the spec says 20, which is end-of-life). Say both in the PR description.
- The extension never rewords the compiler: server messages and errors are shown as the server sent them.
- The token legend is pinned in `src/legend.ts` and must equal alder's `internal/semtok` `Types` and `Modifiers`, in order: types `namespace, type, enumMember, function, method, parameter, variable, property, keyword, operator, string, number, comment, decorator, tag, attribute, boolean, hole`; modifiers `declaration, documentation, defaultLibrary`.
- Custom token types and their scopes: `tag` (superType `type`) → `entity.name.tag.alder`; `attribute` (superType `type`) → `entity.other.attribute-name.alder`; `boolean` (superType `enumMember`) → `constant.language.boolean.alder`; `hole` (superType `variable`) → `variable.language.hole.alder`.
- `.alder-ref` holds the alder commit CI builds the server from: `3fb3894a96dd7a1392078d208d8cae0153c88743` (alder main, which contains milestone 1's tokens, folding and selection).
- The TextMate grammar is under 150 lines and names nothing: the server owns name-dependent colour.
- Settings: `alder.path` (default `alder`), `alder.serverEnv` (object, default `{}`), `alder.trace.server` (`off | messages | verbose`), `alder.test.args` (array of strings, default `[]`).
- Commands, category "Alder": `alder.generate`, `alder.routes`, `alder.run`, `alder.explainDiagnostic`, `alder.test.run`, `alder.test.runAtCursor`, `alder.test.mutate`, `alder.scratch.open`, `alder.scratch.send`, `alder.scratch.openValue`, `alder.showHealth`, `alder.restartServer`. In this milestone all but the last two say "not yet" (`Alder: <title> is not implemented yet`).
- Fill environment variables are reported as set or not set, never with their values.
- Working hours (the user's rule): no agent or background work 9am–5pm America/New_York, Monday to Friday.

## Review Focus

1. **Two app roots in one workspace.** The library registers each server-listed command (`alder.explain`, `alder.fill`) globally per client, so a second client's start throws "command already exists". Expected: both servers start, and a fill in either app goes to that app's server. Pinned by the dispatcher in Task 4 (`commandRoot` unit test) and the two-apps contract test in Task 5.
2. **VS Code started from the Dock (short `PATH`).** Expected: `alder` in `~/go/bin` or `~/bin` is found anyway. Pinned by the `candidates`/`resolveBinary` unit tests in Task 3.
3. **An old alder on the path** (exits 0 and prints text for `help --json`, or a tree without `lsp`). Expected: one error with the build instruction, no client started, no crash. Pinned by the fake-binary gate tests in Task 3.
4. **A case-insensitive file system with a module directory `App/`, and a root reached through a symlink.** Expected: `App/` is not a root; the symlinked and real paths give one client. Pinned by the `findRoot` tests in Task 2 and the selector test in Task 4.
5. **A file of the fallback grammar's worst shapes** (`a < b`, `x ?? y`, `"a {b} c"`, `-- a comment with "quotes"`). Expected: comparison is an operator not a tag, `??` is not a hole, the interpolation is embedded, the comment swallows the quotes. Pinned by the grammar unit tests in Task 1.

---

## File structure

```
alder-vscode/
  .alder-ref                       the alder commit CI builds (Task 1)
  .github/workflows/ci.yml         lint, unit, contract (ubuntu + macos), package (Task 6)
  .gitignore, .vscodeignore        (Task 1)
  LICENSE, README.md, CHANGELOG.md (Task 1; README grows in Task 6)
  eslint.config.mjs, tsconfig.json, package.json   (Task 1; package.json grows in Tasks 3, 4)
  language-configuration.json      comments, brackets, word pattern, indentation (Task 1)
  syntaxes/alder.tmLanguage.json   fallback grammar (Task 1)
  src/legend.ts                    pinned token legend + custom types (Task 1)
  src/root.ts                      app root of a path (Task 2)
  src/health.ts                    discovery, gate, health report (Task 3)
  src/clientConfig.ts              pure client helpers: env overlay, selector, command root (Task 4)
  src/scratch.ts                   alder/scratch params store (Task 4; UI in milestone 6)
  src/client.ts                    LanguageClient per root, command dispatch (Task 4)
  src/commands.ts                  "not yet" bodies, keybinding context (Task 4)
  src/extension.ts                 activation, wiring, API for tests (Tasks 1, 4)
  test/unit/*.test.ts              node:test (Tasks 1–4)
  test/e2e/run.ts, index.ts        fixture workspace + VS Code launcher, mocha loader (Task 5)
  test/e2e/*.e2e.ts                contract tests (Task 5)
```

---

### Task 1: Repository, toolchain, legend, language registration, fallback grammar

**Files:**
- Create: `.gitignore`, `.vscodeignore`, `.alder-ref`, `LICENSE`, `README.md`, `CHANGELOG.md`, `package.json`, `tsconfig.json`, `eslint.config.mjs`, `language-configuration.json`, `syntaxes/alder.tmLanguage.json`, `src/legend.ts`, `src/extension.ts`
- Test: `test/unit/legend.test.ts`, `test/unit/language.test.ts`, `test/unit/grammar.test.ts`

**Interfaces:**
- Produces: `TOKEN_TYPES: readonly string[]`, `TOKEN_MODIFIERS: readonly string[]`, `CUSTOM_TYPES: Record<'tag'|'attribute'|'boolean'|'hole', { superType: string; scope: string; description: string }>` from `src/legend.ts`; `npm run lint`, `npm run test:unit`, `npm run build`, `npm run package` scripts; `activate(context): Api` / `deactivate()` in `src/extension.ts` (empty `Api` for now: `{}`).

The repository was created with `git init -b main` at `~/projects/alder-vscode` and this plan is its first file. Work on a branch: `git switch -c scaffold` after the plan commit (Step 1).

- [ ] **Step 1: Commit the plan on main, branch off**

```bash
cd ~/projects/alder-vscode
cp ~/projects/alder.nvim/LICENSE LICENSE
git add LICENSE docs/superpowers/plans/2026-11-01-alder-vscode-scaffold.md
git commit -m "Plan: alder-vscode scaffold (alder#144 milestone 3)"
git switch -c scaffold
```

- [ ] **Step 2: Write the toolchain files**

`.gitignore`:
```
node_modules/
out/
dist/
.vscode-test/
*.vsix
```

`.vscodeignore` (what `vsce` leaves out of the `.vsix`):
```
**
!dist/extension.js
!package.json
!language-configuration.json
!syntaxes/**
!README.md
!CHANGELOG.md
!LICENSE
```

`.alder-ref`:
```
3fb3894a96dd7a1392078d208d8cae0153c88743
```

`CHANGELOG.md`:
```markdown
# Changelog

## Unreleased

- Language registration, fallback grammar, `alder lsp` client per app root, health and restart commands.
```

`README.md` (Task 6 extends it):
```markdown
# Alder for VS Code

Language support for [Alder](https://github.com/tapegram/alder): the `alder lsp` server's
diagnostics, hover, completion, code actions, formatting, highlighting and folding.

Requires an `alder` binary that has the `lsp` command. Build one from a checkout of
tapegram/alder: `go build -o ~/bin/alder ./cmd/alder`.
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "node16",
    "moduleResolution": "node16",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src", "test"]
}
```

`eslint.config.mjs`:
```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', '.vscode-test/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
);
```

`package.json` (the `contributes` block grows in Tasks 3 and 4):
```json
{
  "name": "alder",
  "displayName": "Alder",
  "description": "Alder language support: the alder lsp server in VS Code",
  "publisher": "tapegram",
  "version": "0.0.1",
  "license": "Apache-2.0",
  "repository": { "type": "git", "url": "https://github.com/tapegram/alder-vscode" },
  "engines": { "vscode": "^1.91.0" },
  "categories": ["Programming Languages"],
  "main": "./dist/extension.js",
  "activationEvents": ["onLanguage:alder"],
  "contributes": {
    "languages": [{
      "id": "alder",
      "aliases": ["Alder", "alder"],
      "extensions": [".alder"],
      "configuration": "./language-configuration.json"
    }],
    "grammars": [{ "language": "alder", "scopeName": "source.alder", "path": "./syntaxes/alder.tmLanguage.json" }],
    "semanticTokenTypes": [
      { "id": "tag", "superType": "type", "description": "An element's tag name" },
      { "id": "attribute", "superType": "type", "description": "An element's attribute name" },
      { "id": "boolean", "superType": "enumMember", "description": "True or False" },
      { "id": "hole", "superType": "variable", "description": "A typed hole (?h)" }
    ],
    "semanticTokenScopes": [{
      "language": "alder",
      "scopes": {
        "tag": ["entity.name.tag.alder"],
        "attribute": ["entity.other.attribute-name.alder"],
        "boolean": ["constant.language.boolean.alder"],
        "hole": ["variable.language.hole.alder"]
      }
    }],
    "configurationDefaults": {
      "[alder]": {
        "editor.tabSize": 2,
        "editor.insertSpaces": true,
        "editor.semanticHighlighting.enabled": true
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run build",
    "build": "esbuild src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node --target=node20 --sourcemap",
    "compile": "tsc -p .",
    "lint": "tsc -p . --noEmit && eslint .",
    "test:unit": "tsc -p . && node --test \"out/test/unit/**/*.test.js\"",
    "test:e2e": "npm run build && tsc -p . && node out/test/e2e/run.js",
    "package": "vsce package --no-dependencies"
  }
}
```

- [ ] **Step 3: Install the dependencies**

```bash
npm install vscode-languageclient@^11
npm install -D typescript@^5 esbuild @types/vscode@1.91.0 @types/node@^22 eslint typescript-eslint \
  @vscode/vsce @vscode/test-electron mocha @types/mocha vscode-textmate vscode-oniguruma
```
Expected: `package.json` gains `dependencies` (only `vscode-languageclient`) and `devDependencies`; `package-lock.json` is created. Commit the lock file.

- [ ] **Step 4: Write the failing unit tests**

`test/unit/legend.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_TYPES, TOKEN_MODIFIERS, CUSTOM_TYPES } from '../../src/legend';
import pkg from '../../package.json';

test('the legend is alder internal/semtok, in order', () => {
  assert.deepEqual([...TOKEN_TYPES], ['namespace', 'type', 'enumMember', 'function', 'method', 'parameter',
    'variable', 'property', 'keyword', 'operator', 'string', 'number', 'comment', 'decorator', 'tag',
    'attribute', 'boolean', 'hole']);
  assert.deepEqual([...TOKEN_MODIFIERS], ['declaration', 'documentation', 'defaultLibrary']);
});

test('package.json declares each custom type with its superType and scope', () => {
  const declared = Object.fromEntries(pkg.contributes.semanticTokenTypes.map(t => [t.id, t.superType]));
  const scopes = pkg.contributes.semanticTokenScopes[0].scopes as Record<string, string[]>;
  assert.equal(pkg.contributes.semanticTokenScopes[0].language, 'alder');
  for (const [id, c] of Object.entries(CUSTOM_TYPES)) {
    assert.ok(TOKEN_TYPES.includes(id), `${id} is in the legend`);
    assert.equal(declared[id], c.superType, `${id} superType`);
    assert.deepEqual(scopes[id], [c.scope], `${id} scope`);
  }
  assert.equal(pkg.contributes.semanticTokenTypes.length, Object.keys(CUSTOM_TYPES).length);
});
```

`test/unit/language.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const conf = JSON.parse(readFileSync(join(__dirname, '../../../language-configuration.json'), 'utf8'));
const re = (s: string) => new RegExp(s);

test('line comments are --', () => assert.equal(conf.comments.lineComment, '--'));

test('a word allows primes, and a hole is one word', () => {
  const w = new RegExp(conf.wordPattern, 'g');
  assert.deepEqual('x\' = ?h + fooBar'.match(w), ['x\'', '?h', 'fooBar']);
});

test('indent after an opener, an arrow, then/else, or a lone start tag', () => {
  const inc = re(conf.indentationRules.increaseIndentPattern);
  for (const l of ['load params = {', '  xs = [', '  f = (', 'x =', '  Just p ->', '  let x <-',
    '  if a then', '  else', '  <article>', '  <Layout.Page title={t}>']) assert.ok(inc.test(l), l);
  for (const l of ['  <h1>{x}</h1>', '  x = 1', '  a < b', '  <br/>', '  <br />']) assert.ok(!inc.test(l), l);
});

test('dedent on a closer, else, or an end tag', () => {
  const dec = re(conf.indentationRules.decreaseIndentPattern);
  for (const l of ['  }', ']', '  )', '  else', '  </article>']) assert.ok(dec.test(l), l);
  for (const l of ['  x', '  elsewhere']) assert.ok(!dec.test(l), l);
});

test('enter after a continuation operator indents', () => {
  const rule = conf.onEnterRules[0];
  assert.equal(rule.action.indent, 'indent');
  const before = re(rule.beforeText);
  for (const l of ['  Db.from Comment |>', '  a ??', '  a ||', '  a &&', '  s ++', '  a +', '  a ==',
    '  a !=', '  a <=', '  a >=']) assert.ok(before.test(l), l);
  assert.ok(!before.test('  x = f y'));
});
```

`test/unit/grammar.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vsctm from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';

const root = join(__dirname, '../../..');
const wasm = readFileSync(join(root, 'node_modules/vscode-oniguruma/release/onig.wasm')).buffer;
const onig = oniguruma.loadWASM(wasm).then(() => ({
  createOnigScanner: (p: string[]) => new oniguruma.OnigScanner(p),
  createOnigString: (s: string) => new oniguruma.OnigString(s),
}));
const registry = new vsctm.Registry({
  onigLib: onig,
  loadGrammar: async () => vsctm.parseRawGrammar(
    readFileSync(join(root, 'syntaxes/alder.tmLanguage.json'), 'utf8'), 'alder.tmLanguage.json'),
});

// scopesOf tokenizes one line and returns, for each token text, its innermost scope.
async function scopesOf(line: string): Promise<[string, string][]> {
  const g = await registry.loadGrammar('source.alder');
  assert.ok(g);
  const r = g.tokenizeLine(line, vsctm.INITIAL);
  return r.tokens.map(t => [line.slice(t.startIndex, t.endIndex), t.scopes[t.scopes.length - 1]]);
}
async function scopeOf(line: string, text: string): Promise<string | undefined> {
  return (await scopesOf(line)).find(([t]) => t === text)?.[1];
}

test('comments swallow quotes', async () => {
  assert.equal(await scopeOf('-- a comment with "quotes"', '-- a comment with "quotes"'), 'comment.line.double-dash.alder');
});

test('a string with an interpolation embeds it', async () => {
  const s = await scopesOf('x = "a {b} c"');
  assert.ok(s.some(([t, sc]) => t === '"' && sc.startsWith('string.quoted.double')));
  const b = (await registry.loadGrammar('source.alder'))!.tokenizeLine('x = "a {b} c"', vsctm.INITIAL)
    .tokens.find(t => t.startIndex === 8)!;
  assert.ok(b.scopes.includes('meta.embedded.interpolation.alder'), b.scopes.join(' '));
});

test('keywords by family', async () => {
  assert.equal(await scopeOf('module Posts.Show', 'module'), 'keyword.control.import.alder');
  assert.equal(await scopeOf('import Layout as L', 'as'), 'keyword.control.import.alder');
  assert.equal(await scopeOf('type Model = {', 'type'), 'storage.type.alder');
  assert.equal(await scopeOf('page "/posts/{slug}" { slug: Post.Slug }', 'page'), 'storage.type.alder');
  assert.equal(await scopeOf('deploy fly {', 'deploy'), 'storage.type.alder');
  assert.equal(await scopeOf('  if a then b else c', 'if'), 'keyword.control.conditional.alder');
  assert.equal(await scopeOf('  match found {', 'match'), 'keyword.control.conditional.alder');
  assert.equal(await scopeOf('  for p in posts', 'for'), 'keyword.control.loop.alder');
  assert.equal(await scopeOf('  let x = 1', 'let'), 'keyword.other.alder');
});

test('comparison is an operator, not a tag; ?? is not a hole', async () => {
  assert.equal(await scopeOf('a < b', '<'), 'keyword.operator.alder');
  assert.equal(await scopeOf('x ?? y', '??'), 'keyword.operator.alder');
  assert.equal(await scopeOf('  ?out', '?out'), 'variable.language.hole.alder');
});

test('numbers, booleans, brackets', async () => {
  assert.equal(await scopeOf('x = 42', '42'), 'constant.numeric.alder');
  assert.equal(await scopeOf('x = 1.5', '1.5'), 'constant.numeric.alder');
  assert.equal(await scopeOf('x = True', 'True'), 'constant.language.boolean.alder');
  assert.equal(await scopeOf('f (x)', '('), 'punctuation.bracket.alder');
});

test('a tag and its attribute, by shape', async () => {
  const line = '<Layout.Page title={t}>';
  assert.equal(await scopeOf(line, 'Layout.Page'), 'entity.name.tag.alder');
  assert.equal(await scopeOf(line, 'title'), 'entity.other.attribute-name.alder');
  assert.equal(await scopeOf('</article>', 'article'), 'entity.name.tag.alder');
  const gt = await scopesOf('<p class={if a > b then "x" else "y"}>');
  assert.ok(gt.some(([t, sc]) => t === '>' && sc === 'keyword.operator.alder'), 'a > b inside braces stays an operator');
});
```

`src/extension.ts` (minimal, so the bundle builds):
```ts
import * as vscode from 'vscode';

export interface Api {}

export function activate(_context: vscode.ExtensionContext): Api {
  return {};
}

export function deactivate(): void {}
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `tsc` reports `Cannot find module '../../src/legend'`; after creating an empty `src/legend.ts`, the language and grammar tests fail on the missing JSON files.

- [ ] **Step 6: Write `src/legend.ts`**

```ts
// The semantic token legend, pinned to alder's internal/semtok (Types, Modifiers), in order. A
// change there must change this file too; the contract test compares it with the server's.
export const TOKEN_TYPES: readonly string[] = ['namespace', 'type', 'enumMember', 'function', 'method',
  'parameter', 'variable', 'property', 'keyword', 'operator', 'string', 'number', 'comment', 'decorator',
  'tag', 'attribute', 'boolean', 'hole'];

export const TOKEN_MODIFIERS: readonly string[] = ['declaration', 'documentation', 'defaultLibrary'];

// CUSTOM_TYPES are the legend's types VS Code does not know; package.json declares each with
// its superType (so a theme without a rule still colours it) and maps it to a TextMate scope.
export const CUSTOM_TYPES = {
  tag: { superType: 'type', scope: 'entity.name.tag.alder', description: "An element's tag name" },
  attribute: { superType: 'type', scope: 'entity.other.attribute-name.alder', description: "An element's attribute name" },
  boolean: { superType: 'enumMember', scope: 'constant.language.boolean.alder', description: 'True or False' },
  hole: { superType: 'variable', scope: 'variable.language.hole.alder', description: 'A typed hole (?h)' },
} as const;
```

- [ ] **Step 7: Write `language-configuration.json`**

```json
{
  "comments": { "lineComment": "--" },
  "brackets": [["{", "}"], ["[", "]"], ["(", ")"]],
  "autoClosingPairs": [
    { "open": "{", "close": "}" },
    { "open": "[", "close": "]" },
    { "open": "(", "close": ")" },
    { "open": "\"", "close": "\"", "notIn": ["string"] }
  ],
  "surroundingPairs": [["{", "}"], ["[", "]"], ["(", ")"], ["\"", "\""]],
  "wordPattern": "[A-Za-z_][\\w']*|\\?[a-z]\\w*",
  "indentationRules": {
    "increaseIndentPattern": "^.*(\\{|\\[|\\(|=|->|<-|\\bthen|\\belse)\\s*$|^\\s*<[A-Za-z][\\w.-]*(\\s[^>]*[^/>])?>\\s*$",
    "decreaseIndentPattern": "^\\s*(\\}|\\]|\\)|else\\b|</)"
  },
  "onEnterRules": [
    {
      "beforeText": "(\\|>|\\?\\?|\\|\\||&&|\\+\\+|==|!=|<=|>=|[+\\-*/])\\s*$",
      "action": { "indent": "indent" }
    }
  ]
}
```
Note on `increaseIndentPattern`: the start-tag alternative must reject `<br/>` and `<br />` (self-closing) and `<h1>{x}</h1>` (the line does not end right after the start tag). If a test case fails, fix the regex, not the test; the formatter is the authority on indentation and these rules only place the cursor.

- [ ] **Step 8: Write `syntaxes/alder.tmLanguage.json`**

Rule order matters: comment before operators (so `--` is not two minuses), strings and tags before operators (so `<` of a tag is the tag's), holes before operators (so `?h` is not `?`).

```json
{
  "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  "name": "Alder",
  "scopeName": "source.alder",
  "patterns": [
    { "include": "#comment" },
    { "include": "#string" },
    { "include": "#tag" },
    { "include": "#hole" },
    { "include": "#number" },
    { "include": "#boolean" },
    { "include": "#keyword" },
    { "include": "#operator" },
    { "include": "#punctuation" }
  ],
  "repository": {
    "comment": { "name": "comment.line.double-dash.alder", "match": "--.*$" },
    "string": {
      "name": "string.quoted.double.alder",
      "begin": "\"",
      "end": "\"",
      "patterns": [
        { "name": "constant.character.escape.alder", "match": "\\\\." },
        {
          "name": "meta.embedded.interpolation.alder",
          "begin": "\\{",
          "end": "\\}",
          "beginCaptures": { "0": { "name": "punctuation.section.interpolation.begin.alder" } },
          "endCaptures": { "0": { "name": "punctuation.section.interpolation.end.alder" } },
          "patterns": [{ "include": "$self" }]
        }
      ]
    },
    "braces": {
      "begin": "\\{",
      "end": "\\}",
      "beginCaptures": { "0": { "name": "punctuation.bracket.alder" } },
      "endCaptures": { "0": { "name": "punctuation.bracket.alder" } },
      "patterns": [{ "include": "$self" }]
    },
    "tag": {
      "patterns": [
        {
          "match": "(</)([A-Za-z][\\w.-]*)\\s*(>)",
          "captures": {
            "1": { "name": "punctuation.definition.tag.alder" },
            "2": { "name": "entity.name.tag.alder" },
            "3": { "name": "punctuation.definition.tag.alder" }
          }
        },
        {
          "begin": "(<)([A-Za-z][\\w.-]*)(?=[\\s/>])",
          "beginCaptures": {
            "1": { "name": "punctuation.definition.tag.alder" },
            "2": { "name": "entity.name.tag.alder" }
          },
          "end": "/?>",
          "endCaptures": { "0": { "name": "punctuation.definition.tag.alder" } },
          "patterns": [
            { "name": "entity.other.attribute-name.alder", "match": "[A-Za-z_][\\w:-]*(?=\\s*=)" },
            { "include": "#string" },
            { "include": "#braces" },
            { "name": "keyword.operator.alder", "match": "=" }
          ]
        }
      ]
    },
    "hole": { "name": "variable.language.hole.alder", "match": "\\?[a-z]\\w*" },
    "number": { "name": "constant.numeric.alder", "match": "\\b\\d+(\\.\\d+)?\\b" },
    "boolean": { "name": "constant.language.boolean.alder", "match": "\\b(True|False)\\b" },
    "keyword": {
      "patterns": [
        { "name": "keyword.control.import.alder", "match": "\\b(module|import|as)\\b" },
        { "name": "storage.type.alder", "match": "\\b(type|brand|where|page|msg|form|table|capability|fake|session|login|test|requires)\\b" },
        { "name": "storage.type.alder", "match": "^(deploy|theme|silo)\\b" },
        { "name": "keyword.control.conditional.alder", "match": "\\b(if|then|else|match)\\b" },
        { "name": "keyword.control.loop.alder", "match": "\\b(for|in)\\b" },
        { "name": "keyword.other.alder", "match": "\\blet\\b" }
      ]
    },
    "operator": {
      "name": "keyword.operator.alder",
      "match": "\\|>|->|<-|==|!=|<=|>=|\\+\\+|&&|\\|\\||\\?\\?|\\.\\.|[=+\\-*/%<>|\\\\]"
    },
    "punctuation": {
      "patterns": [
        { "include": "#braces" },
        { "name": "punctuation.bracket.alder", "match": "[()\\[\\]]" },
        { "name": "punctuation.separator.alder", "match": "[,:]" },
        { "name": "punctuation.accessor.alder", "match": "\\." }
      ]
    }
  }
}
```
The contextual words `deploy`, `theme`, `silo` are keywords only at the start of a line (a declaration), so a field named `theme` stays plain; `choose`, `role`, `via` are left to the server.

- [ ] **Step 9: Run the tests to verify they pass, and lint**

Run: `npm run test:unit && npm run lint && npm run build`
Expected: all unit tests PASS; `tsc --noEmit` and eslint report nothing; `dist/extension.js` exists.

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "Scaffold: toolchain, legend, language registration, fallback grammar"
```

---

### Task 2: The app root of a path (`src/root.ts`)

**Files:**
- Create: `src/root.ts`
- Test: `test/unit/root.test.ts`

**Interfaces:**
- Produces: `findRoot(path: string): Promise<string | undefined>` — the nearest ancestor directory (of a file, or the directory itself) whose listing has an entry named exactly `app` that is a directory; returned as given (not resolved). `realRoot(root: string): Promise<string>` — `fs.realpath`, falling back to `path.resolve` on error. Both used by `client.ts` (Task 4) and `commands.ts` (Task 4).

- [ ] **Step 1: Write the failing test**

`test/unit/root.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRoot, realRoot } from '../../src/root';

function tree(): string {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'alder-root-')));
  mkdirSync(join(t, 'blog/app/Posts'), { recursive: true });
  writeFileSync(join(t, 'blog/app/Posts/Show.alder'), 'module Posts.Show\n');
  return t;
}

test('a file under app/ has the directory holding app/ as its root', async () => {
  const t = tree();
  assert.equal(await findRoot(join(t, 'blog/app/Posts/Show.alder')), join(t, 'blog'));
  assert.equal(await findRoot(join(t, 'blog/app')), join(t, 'blog'));
  assert.equal(await findRoot(join(t, 'blog')), join(t, 'blog'));
});

test('no app/ above: undefined', async () => {
  const t = tree();
  writeFileSync(join(t, 'loose.alder'), '');
  assert.equal(await findRoot(join(t, 'loose.alder')), undefined);
});

test('a module directory App/ is not app/ (case-insensitive file systems)', async () => {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'alder-root-')));
  mkdirSync(join(t, 'x/App'), { recursive: true });
  writeFileSync(join(t, 'x/App/Main.alder'), '');
  assert.equal(await findRoot(join(t, 'x/App/Main.alder')), undefined);
});

test('a file named app is not a root', async () => {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'alder-root-')));
  mkdirSync(join(t, 'y'));
  writeFileSync(join(t, 'y/app'), '');
  assert.equal(await findRoot(join(t, 'y/Main.alder')), undefined);
});

test('app/ as a symlink to a directory counts; realRoot resolves the link', async () => {
  const t = tree();
  symlinkSync(join(t, 'blog'), join(t, 'link'));
  assert.equal(await findRoot(join(t, 'link/app/Posts/Show.alder')), join(t, 'link'));
  assert.equal(await realRoot(join(t, 'link')), join(t, 'blog'));
  mkdirSync(join(t, 'z'));
  symlinkSync(join(t, 'blog/app'), join(t, 'z/app'));
  assert.equal(await findRoot(join(t, 'z/app/Posts/Show.alder')), join(t, 'z'));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit`
Expected: FAIL, `Cannot find module '../../src/root'`.

- [ ] **Step 3: Write `src/root.ts`**

```ts
import { promises as fs } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

// hasApp reports whether dir has an entry named exactly `app` that is a directory. It reads
// the listing instead of stat-ing dir/app: on a case-insensitive file system that stat
// succeeds for a module directory named App.
async function hasApp(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  const e = entries.find(x => x.name === 'app');
  if (!e) return false;
  if (e.isDirectory()) return true;
  if (!e.isSymbolicLink()) return false;
  try {
    return (await fs.stat(join(dir, 'app'))).isDirectory();
  } catch {
    return false;
  }
}

// findRoot returns the app root of a file or directory: its nearest ancestor holding app/.
export async function findRoot(path: string): Promise<string | undefined> {
  const p = resolve(path);
  let dir = p;
  try {
    if (!(await fs.stat(p)).isDirectory()) dir = dirname(p);
  } catch {
    dir = dirname(p);
  }
  for (;;) {
    if (await hasApp(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// realRoot is a root's real path: roots are compared by it.
export async function realRoot(root: string): Promise<string> {
  try {
    return await fs.realpath(root);
  } catch {
    return resolve(root);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit && npm run lint`
Expected: PASS, no lint output.

- [ ] **Step 5: Commit**

```bash
git add src/root.ts test/unit/root.test.ts
git commit -m "root: the app root of a path (the app listing rule)"
```

---

### Task 3: Binary discovery, the gate, the health report (`src/health.ts`)

**Files:**
- Create: `src/health.ts`
- Modify: `package.json` (`contributes.configuration`)
- Test: `test/unit/health.test.ts`

**Interfaces:**
- Produces (no `vscode` import):
  - `candidates(setting: string, env: NodeJS.ProcessEnv, home: string): string[]`
  - `resolveBinary(setting: string, env: NodeJS.ProcessEnv, home: string): Promise<string | undefined>`
  - `interface Gate { path?: string; version?: string; ok: boolean; problem?: string }`
  - `checkBinary(setting: string, env: NodeJS.ProcessEnv, home: string): Promise<Gate>`
  - `hasLsp(helpStdout: string): boolean`
  - `interface RootStatus { root: string; running: boolean; tokens: boolean; scratch: boolean }`
  - `report(gate: Gate, roots: RootStatus[], env: NodeJS.ProcessEnv): string[]`
  - `const BUILD_HINT = 'build one from a checkout of tapegram/alder: go build -o ~/bin/alder ./cmd/alder'`
  - `const MISSING_TOKENS = 'update alder for highlighting; the fallback grammar is in use'`
  - `const MISSING_SCRATCH = 'update alder for scratch files'`

- [ ] **Step 1: Write the failing test**

`test/unit/health.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { candidates, resolveBinary, checkBinary, hasLsp, report, BUILD_HINT, MISSING_TOKENS } from '../../src/health';

function dir(): string { return realpathSync(mkdtempSync(join(tmpdir(), 'alder-health-'))); }

// fake writes an executable shell script named alder into d.
function fake(d: string, body: string): string {
  mkdirSync(d, { recursive: true });
  const p = join(d, 'alder');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

const TREE = '{"version":"(devel)","commands":[{"name":"check"},{"name":"lsp"}]}';

test('an absolute setting is the only candidate', () => {
  assert.deepEqual(candidates('/opt/alder', { PATH: '/usr/bin' }, '/home/u'), ['/opt/alder']);
});

test('a bare name searches PATH, then GOBIN, GOPATH/bin, ~/go/bin, ~/bin', () => {
  const env = { PATH: ['/a', '/b'].join(delimiter), GOBIN: '/gobin', GOPATH: ['/gp', '/gp2'].join(delimiter) };
  assert.deepEqual(candidates('alder', env, '/home/u'),
    ['/a/alder', '/b/alder', '/gobin/alder', '/gp/bin/alder', '/home/u/go/bin/alder', '/home/u/bin/alder']);
});

test('the Dock case: not on PATH, found in ~/go/bin', async () => {
  const home = dir();
  const p = fake(join(home, 'go/bin'), `echo '${TREE}'`);
  assert.equal(await resolveBinary('alder', { PATH: '/nonexistent' }, home), p);
});

test('a non-executable file is skipped', async () => {
  const home = dir();
  mkdirSync(join(home, 'bin'), { recursive: true });
  writeFileSync(join(home, 'bin/alder'), 'not executable');
  assert.equal(await resolveBinary('alder', { PATH: '' }, home), undefined);
});

test('hasLsp needs a command tree that lists lsp', () => {
  assert.equal(hasLsp(TREE), true);
  assert.equal(hasLsp('{"commands":[{"name":"check"}]}'), false);
  assert.equal(hasLsp('usage: alder <command>'), false);
  assert.equal(hasLsp('{"commands":"lsp"}'), false);
});

test('the gate passes a current alder and reads its version', async () => {
  const home = dir();
  fake(join(home, 'bin'), `case "$1" in help) echo '${TREE}';; version) echo 'alder 1.2.3 (go 1.27)';; esac`);
  const g = await checkBinary('alder', { PATH: '' }, home);
  assert.equal(g.ok, true, g.problem);
  assert.equal(g.version, 'alder 1.2.3 (go 1.27)');
});

test('an old alder (help --json prints text, exit 0) fails the gate with the build hint', async () => {
  const home = dir();
  fake(join(home, 'bin'), `echo 'usage: alder <command>'`);
  const g = await checkBinary('alder', { PATH: '' }, home);
  assert.equal(g.ok, false);
  assert.match(g.problem!, /help --json/);
  assert.ok(g.problem!.includes(BUILD_HINT));
});

test('a binary that exits non-zero fails the gate', async () => {
  const home = dir();
  fake(join(home, 'bin'), 'exit 3');
  assert.equal((await checkBinary('alder', { PATH: '' }, home)).ok, false);
});

test('no binary: the problem names where it looked and the build hint', async () => {
  const g = await checkBinary('alder', { PATH: '' }, dir());
  assert.equal(g.ok, false);
  assert.equal(g.path, undefined);
  assert.match(g.problem!, /alder\.path/);
  assert.ok(g.problem!.includes(BUILD_HINT));
});

test('the report says what is missing and never prints a secret', () => {
  const lines = report(
    { path: '/bin/alder', version: 'alder 1.2.3', ok: true },
    [{ root: '/w/blog', running: true, tokens: false, scratch: true }],
    { ANTHROPIC_API_KEY: 'sk-secret', ALDER_FILL_COMMAND: '' },
  );
  const text = lines.join('\n');
  assert.match(text, /\/bin\/alder \(alder 1\.2\.3\)/);
  assert.match(text, /alder lsp running for \/w\/blog/);
  assert.ok(text.includes(MISSING_TOKENS));
  assert.match(text, /ANTHROPIC_API_KEY: set/);
  assert.match(text, /ALDER_FILL_COMMAND: not set/);
  assert.ok(!text.includes('sk-secret'));
});

test('the report with no server running says how to start one', () => {
  const text = report({ ok: false, problem: 'x' }, [], {}).join('\n');
  assert.match(text, /no alder lsp running \(open an \.alder file inside an app\)/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit`
Expected: FAIL, `Cannot find module '../../src/health'`.

- [ ] **Step 3: Write `src/health.ts`**

```ts
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
```

- [ ] **Step 4: Add the settings to `package.json`**

Add under `contributes`:
```json
"configuration": {
  "title": "Alder",
  "properties": {
    "alder.path": {
      "type": "string",
      "default": "alder",
      "markdownDescription": "The `alder` binary: an absolute path, or a name looked up on `PATH`, `$GOBIN`, `$GOPATH/bin`, `~/go/bin` and `~/bin`."
    },
    "alder.serverEnv": {
      "type": "object",
      "default": {},
      "additionalProperties": { "type": "string" },
      "markdownDescription": "Environment for `alder lsp`, over VS Code's own: for example `ANTHROPIC_API_KEY`, `ALDER_FILL_MODEL`, `ALDER_FILL_COMMAND`, `ALDER_LSP_LOG`."
    },
    "alder.trace.server": {
      "type": "string",
      "enum": ["off", "messages", "verbose"],
      "default": "off",
      "description": "Trace the LSP traffic with alder lsp into the Alder output channel."
    },
    "alder.test.args": {
      "type": "array",
      "items": { "type": "string" },
      "default": [],
      "markdownDescription": "Extra arguments for `alder test`."
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/health.ts test/unit/health.test.ts package.json
git commit -m "health: binary discovery, the help --json gate, the health report; settings"
```

---

### Task 4: One client per root, command dispatch, commands and keys

**Files:**
- Create: `src/clientConfig.ts`, `src/scratch.ts`, `src/client.ts`, `src/commands.ts`
- Modify: `src/extension.ts`, `package.json` (`contributes.commands`, `contributes.keybindings`)
- Test: `test/unit/clientConfig.test.ts`, `test/unit/scratch.test.ts`

**Interfaces:**
- Consumes: `findRoot`, `realRoot` (Task 2); `checkBinary`, `report`, `RootStatus`, `Gate`, `MISSING_TOKENS`, `MISSING_SCRATCH` (Task 3).
- Produces:
  - `clientConfig.ts` (no `vscode`): `serverEnv(base: NodeJS.ProcessEnv, overlay: unknown): NodeJS.ProcessEnv`; `escapeGlob(path: string): string`; `selectorPatterns(paths: string[]): string[]` (one `<escaped>/**` per distinct path); `commandUri(args: unknown[]): string | undefined` (the `uri` of the first argument when it is an object with a string `uri`); `SERVER_COMMANDS = ['alder.explain', 'alder.fill']`.
  - `scratch.ts` (no `vscode`): `interface ScratchWatch { line: number; end?: number; value?: string; type?: string; error?: string; note?: string; truncated?: boolean }`, `interface ScratchParams { uri: string; version?: number; watches?: ScratchWatch[]; error?: string; note?: string; warning?: string }`, `class ScratchStore { record(p: ScratchParams): void; last(uri: string): ScratchParams | undefined; clear(): void }`.
  - `client.ts`: `class Clients` with `ensure(doc: vscode.TextDocument): Promise<LanguageClient | undefined>`, `forUri(uri: vscode.Uri | string): Promise<LanguageClient | undefined>`, `execute(command: string, args: unknown[]): Promise<unknown>`, `statuses(): RootStatus[]`, `restart(): Promise<void>`, `stopAll(): Promise<void>`, `roots(): string[]`, readonly `scratch: ScratchStore`.
  - `extension.ts`: `interface Api { clients: Clients; health(): Promise<string[]> }` returned from `activate`.

- [ ] **Step 1: Write the failing unit tests**

`test/unit/clientConfig.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverEnv, escapeGlob, selectorPatterns, commandUri, SERVER_COMMANDS } from '../../src/clientConfig';

test('serverEnv overlays strings on the base and ignores everything else', () => {
  const env = serverEnv({ PATH: '/bin', HOME: '/h' }, { ALDER_FILL_COMMAND: 'echo x', PATH: '/x', N: 3, O: {} });
  assert.equal(env.ALDER_FILL_COMMAND, 'echo x');
  assert.equal(env.PATH, '/x');
  assert.equal(env.HOME, '/h');
  assert.equal(env.N, undefined);
  assert.equal(env.O, undefined);
  assert.deepEqual(serverEnv({ A: '1' }, null), { A: '1' });
});

test('escapeGlob protects glob metacharacters in a path', () => {
  assert.equal(escapeGlob('/w/my app [1]/{x}*?'), '/w/my app [[]1]/[{]x[}][*][?]');
});

test('selectorPatterns: one pattern per distinct path', () => {
  assert.deepEqual(selectorPatterns(['/w/link', '/w/blog', '/w/link']), ['/w/link/**', '/w/blog/**']);
});

test('commandUri reads the uri of a fill argument, nothing else', () => {
  assert.equal(commandUri([{ uri: 'file:///w/blog/app/App.alder', hole: 'out' }]), 'file:///w/blog/app/App.alder');
  assert.equal(commandUri(['E0205']), undefined);
  assert.equal(commandUri([]), undefined);
  assert.equal(commandUri([{ uri: 3 }]), undefined);
});

test('the server commands the extension dispatches itself', () => {
  assert.deepEqual(SERVER_COMMANDS, ['alder.explain', 'alder.fill']);
});
```

`test/unit/scratch.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScratchStore } from '../../src/scratch';

test('the store keeps the last params per uri', () => {
  const s = new ScratchStore();
  s.record({ uri: 'file:///a', version: 1, watches: [{ line: 3, value: '2', type: 'Int' }] });
  s.record({ uri: 'file:///a', version: 2, watches: [] });
  s.record({ uri: 'file:///b', error: 'boom' });
  assert.equal(s.last('file:///a')?.version, 2);
  assert.equal(s.last('file:///b')?.error, 'boom');
  assert.equal(s.last('file:///c'), undefined);
  s.clear();
  assert.equal(s.last('file:///a'), undefined);
});

test('a notification without a uri is ignored', () => {
  const s = new ScratchStore();
  s.record({} as never);
  assert.equal(s.last('undefined'), undefined);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:unit`
Expected: FAIL, `Cannot find module '../../src/clientConfig'` and `'../../src/scratch'`.

- [ ] **Step 3: Write `src/clientConfig.ts` and `src/scratch.ts`**

`src/clientConfig.ts`:
```ts
// The commands alder lsp lists in executeCommandProvider. The language client would register
// each globally once per client, so a second app root's client fails to start ("command
// already exists"); the extension registers them once and sends each to the right server.
export const SERVER_COMMANDS = ['alder.explain', 'alder.fill'];

// serverEnv is VS Code's environment overlaid by the alder.serverEnv setting's string values.
export function serverEnv(base: NodeJS.ProcessEnv, overlay: unknown): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  if (overlay && typeof overlay === 'object') {
    for (const [k, v] of Object.entries(overlay)) if (typeof v === 'string') env[k] = v;
  }
  return env;
}

// escapeGlob makes a path a literal in a VS Code glob: each metacharacter in a class of its own.
export function escapeGlob(path: string): string {
  return path.replace(/[*?[{}]/g, c => `[${c}]`);
}

// selectorPatterns are the document selector's patterns for a root reached by these paths
// (the path the documents use and the real path, when a symlink makes them differ).
export function selectorPatterns(paths: string[]): string[] {
  return [...new Set(paths)].map(p => `${escapeGlob(p)}/**`);
}

// commandUri is the document a server command is about, when its argument names one
// (alder.fill's argument carries the uri; alder.explain's is a code).
export function commandUri(args: unknown[]): string | undefined {
  const a = args[0];
  if (a && typeof a === 'object' && typeof (a as { uri?: unknown }).uri === 'string') return (a as { uri: string }).uri;
  return undefined;
}
```

`src/scratch.ts`:
```ts
// The alder/scratch notification: the server's last run of a scratch file. Milestone 6 adds
// the UI (open, send, open value, the file-level decoration); the values themselves are the
// server's inlay hints.
export interface ScratchWatch {
  line: number;
  end?: number;
  value?: string;
  type?: string;
  error?: string;
  note?: string;
  truncated?: boolean;
}

export interface ScratchParams {
  uri: string;
  version?: number;
  watches?: ScratchWatch[];
  error?: string;
  note?: string;
  warning?: string;
}

export class ScratchStore {
  private byUri = new Map<string, ScratchParams>();

  record(p: ScratchParams): void {
    if (p && typeof p.uri === 'string') this.byUri.set(p.uri, p);
  }

  last(uri: string): ScratchParams | undefined {
    return this.byUri.get(uri);
  }

  clear(): void {
    this.byUri.clear();
  }
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Write `src/client.ts`**

```ts
import * as os from 'node:os';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import {
  CloseAction, ErrorAction, ExecuteCommandRequest, LanguageClient, LanguageClientOptions, ServerOptions, State,
} from 'vscode-languageclient/node';
import { findRoot, realRoot } from './root';
import { checkBinary, Gate, MISSING_SCRATCH, MISSING_TOKENS, RootStatus } from './health';
import { commandUri, selectorPatterns, serverEnv } from './clientConfig';
import { ScratchStore, ScratchParams } from './scratch';

interface Entry { root: string; real: string; client: LanguageClient; starting: Promise<void> }

// Clients is one LanguageClient per app root, as alder.nvim has one client per root. Roots are
// compared by real path; the selector covers the path the documents use and the real one.
export class Clients {
  readonly scratch = new ScratchStore();
  private byReal = new Map<string, Entry>();
  private gate: Gate | undefined;
  private gateReported = false;
  private warned = new Set<string>();

  constructor(private readonly output: vscode.OutputChannel) {}

  async checkGate(): Promise<Gate> {
    if (!this.gate) {
      const setting = vscode.workspace.getConfiguration('alder').get<string>('path', 'alder');
      this.gate = await checkBinary(setting, process.env, os.homedir());
    }
    return this.gate;
  }

  // ensure starts (or reuses) the client of the document's root; undefined when the document
  // is not an alder file under an app root, or the binary failed the gate.
  async ensure(doc: vscode.TextDocument): Promise<LanguageClient | undefined> {
    if (doc.languageId !== 'alder' || doc.uri.scheme !== 'file') return undefined;
    const root = await findRoot(doc.uri.fsPath);
    if (!root) return undefined;
    const real = await realRoot(root);
    const gate = await this.checkGate();
    // no await between the lookup and the set: two documents opening at once share one client
    const have = this.byReal.get(real);
    if (have) {
      await have.starting;
      return have.client;
    }
    if (!gate.ok || !gate.path) {
      this.reportGate(gate);
      return undefined;
    }
    const entry = this.create(root, real, gate.path);
    this.byReal.set(real, entry);
    await entry.starting;
    return entry.client;
  }

  private reportGate(gate: Gate): void {
    if (this.gateReported) return;
    this.gateReported = true;
    void vscode.window.showErrorMessage(gate.problem ?? 'alder: the binary failed its check', 'Open Settings').then(pick => {
      if (pick) void vscode.commands.executeCommand('workbench.action.openSettings', 'alder.path');
    });
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    void vscode.window.showWarningMessage(message);
  }

  private create(root: string, real: string, alderPath: string): Entry {
    const config = vscode.workspace.getConfiguration('alder');
    const serverOptions: ServerOptions = {
      command: alderPath,
      args: ['lsp'],
      options: { cwd: real, env: serverEnv(process.env, config.get('serverEnv')) },
    };
    let closes = 0;
    const clientOptions: LanguageClientOptions = {
      documentSelector: selectorPatterns([root, real]).map(pattern => ({ scheme: 'file', language: 'alder', pattern })),
      workspaceFolder: { uri: vscode.Uri.file(real), name: basename(real), index: 0 },
      outputChannel: this.output,
      errorHandler: {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => {
          closes++;
          this.warnOnce(`closed:${real}:${closes > 1 ? 'final' : 'first'}`, 'alder lsp stopped — Alder: Show Health');
          return { action: closes === 1 ? CloseAction.Restart : CloseAction.DoNotRestart, handled: true };
        },
      },
    };
    const client = new LanguageClient('alder', `Alder (${basename(real)})`, serverOptions, clientOptions);
    // The extension registers the server's commands once for all clients (see SERVER_COMMANDS).
    const exec = client.getFeature(ExecuteCommandRequest.method) as unknown as { initialize: (c: unknown) => void };
    exec.initialize = () => {};
    client.onNotification('alder/scratch', (p: ScratchParams) => this.scratch.record(p));
    const starting = client.start().then(() => {
      const caps = client.initializeResult?.capabilities;
      if (!caps?.semanticTokensProvider) this.warnOnce('tokens', `alder: ${MISSING_TOKENS}`);
      if (!(caps?.experimental as { alderScratch?: boolean } | undefined)?.alderScratch) this.warnOnce('scratch', `alder: ${MISSING_SCRATCH}`);
    }, err => {
      this.output.appendLine(`alder lsp for ${real} failed to start: ${err instanceof Error ? err.message : String(err)}`);
    });
    return { root, real, client, starting };
  }

  async forUri(uri: vscode.Uri | string): Promise<LanguageClient | undefined> {
    const u = typeof uri === 'string' ? vscode.Uri.parse(uri) : uri;
    const root = await findRoot(u.fsPath);
    if (!root) return undefined;
    return this.byReal.get(await realRoot(root))?.client;
  }

  // execute sends a server command to the server of the document it names, else the active
  // editor's, else the only one running.
  async execute(command: string, args: unknown[]): Promise<unknown> {
    const target = commandUri(args) ?? vscode.window.activeTextEditor?.document.uri;
    let client = target ? await this.forUri(target) : undefined;
    if (!client && this.byReal.size === 1) client = [...this.byReal.values()][0].client;
    if (!client) {
      void vscode.window.showErrorMessage('alder: no alder lsp running for this file');
      return undefined;
    }
    try {
      return await client.sendRequest(ExecuteCommandRequest.type, { command, arguments: args });
    } catch (err) {
      void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  roots(): string[] {
    return [...this.byReal.keys()];
  }

  statuses(): RootStatus[] {
    return [...this.byReal.values()].map(e => {
      const caps = e.client.initializeResult?.capabilities;
      return {
        root: e.real,
        running: e.client.state === State.Running,
        tokens: !!caps?.semanticTokensProvider,
        scratch: !!(caps?.experimental as { alderScratch?: boolean } | undefined)?.alderScratch,
      };
    });
  }

  async stopAll(): Promise<void> {
    const entries = [...this.byReal.values()];
    this.byReal.clear();
    await Promise.all(entries.map(e => e.client.stop().catch(() => undefined)));
  }

  // restart forgets the gate and the warnings, stops every client, and starts one per root
  // of the open alder documents.
  async restart(): Promise<void> {
    await this.stopAll();
    this.gate = undefined;
    this.gateReported = false;
    this.warned.clear();
    this.scratch.clear();
    for (const doc of vscode.workspace.textDocuments) await this.ensure(doc);
  }
}
```
If `tsc` rejects the `getFeature` cast or `initializeResult` typing in v11, keep the behaviour and adjust only the types; the two-apps contract test (Task 5) is what proves the dispatch works.

- [ ] **Step 6: Write `src/commands.ts`**

```ts
import * as vscode from 'vscode';
import { findRoot } from './root';

// NOT_YET are the commands later milestones fill in (4: routes, run, explain, tests; 5: the
// generator flow; 6: scratch). Each says so when run.
export const NOT_YET: Record<string, string> = {
  'alder.generate': 'Generate',
  'alder.routes': 'Routes',
  'alder.run': 'Run',
  'alder.explainDiagnostic': 'Explain Diagnostic',
  'alder.test.run': 'Run Tests',
  'alder.test.runAtCursor': 'Run Test at Cursor',
  'alder.test.mutate': 'Mutation Testing',
  'alder.scratch.open': 'Open Scratch',
  'alder.scratch.send': 'Send to Scratch',
  'alder.scratch.openValue': 'Open Scratch Value',
};

export function registerNotYet(context: vscode.ExtensionContext): void {
  for (const [id, title] of Object.entries(NOT_YET)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, () =>
      vscode.window.showInformationMessage(`Alder: ${title} is not implemented yet`)));
  }
}

// trackProject keeps the alder.inProject context key: the active editor's file has an app root.
export function trackProject(context: vscode.ExtensionContext): void {
  const update = async (editor: vscode.TextEditor | undefined) => {
    const inProject = !!editor && editor.document.uri.scheme === 'file' && !!(await findRoot(editor.document.uri.fsPath));
    await vscode.commands.executeCommand('setContext', 'alder.inProject', inProject);
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => void update(e)));
  void update(vscode.window.activeTextEditor);
}
```

- [ ] **Step 7: Replace `src/extension.ts`**

```ts
import * as vscode from 'vscode';
import { Clients } from './client';
import { SERVER_COMMANDS, serverEnv } from './clientConfig';
import { registerNotYet, trackProject } from './commands';
import { report } from './health';

export interface Api {
  clients: Clients;
  health(): Promise<string[]>;
}

let clients: Clients | undefined;

export function activate(context: vscode.ExtensionContext): Api {
  const output = vscode.window.createOutputChannel('Alder');
  context.subscriptions.push(output);
  const cs = new Clients(output);
  clients = cs;

  const health = async () => {
    const env = serverEnv(process.env, vscode.workspace.getConfiguration('alder').get('serverEnv'));
    return report(await cs.checkGate(), cs.statuses(), env);
  };

  for (const command of SERVER_COMMANDS) {
    context.subscriptions.push(vscode.commands.registerCommand(command, (...args: unknown[]) => cs.execute(command, args)));
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('alder.showHealth', async () => {
      output.appendLine(`--- Alder health ${new Date().toISOString()}`);
      for (const line of await health()) output.appendLine(line);
      output.show(true);
    }),
    vscode.commands.registerCommand('alder.restartServer', () => cs.restart()),
    vscode.workspace.onDidOpenTextDocument(doc => void cs.ensure(doc)),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('alder.path') || e.affectsConfiguration('alder.serverEnv')) {
        void vscode.window.showInformationMessage('alder: run Alder: Restart Server to apply the new setting');
      }
    }),
  );
  registerNotYet(context);
  trackProject(context);
  for (const doc of vscode.workspace.textDocuments) void cs.ensure(doc);
  return { clients: cs, health };
}

export async function deactivate(): Promise<void> {
  await clients?.stopAll();
}
```

- [ ] **Step 8: Add commands and keybindings to `package.json`**

No `onCommand:` activation events are needed (VS Code ≥1.74 activates on contributed commands). Add under `contributes`:
```json
"commands": [
  { "command": "alder.generate", "title": "Generate…", "category": "Alder" },
  { "command": "alder.routes", "title": "Routes", "category": "Alder" },
  { "command": "alder.run", "title": "Run the App", "category": "Alder" },
  { "command": "alder.explainDiagnostic", "title": "Explain Diagnostic", "category": "Alder" },
  { "command": "alder.test.run", "title": "Run Tests", "category": "Alder" },
  { "command": "alder.test.runAtCursor", "title": "Run Test at Cursor", "category": "Alder" },
  { "command": "alder.test.mutate", "title": "Mutation Testing", "category": "Alder" },
  { "command": "alder.scratch.open", "title": "Open Scratch", "category": "Alder" },
  { "command": "alder.scratch.send", "title": "Send to Scratch", "category": "Alder" },
  { "command": "alder.scratch.openValue", "title": "Open Scratch Value", "category": "Alder" },
  { "command": "alder.showHealth", "title": "Show Health", "category": "Alder" },
  { "command": "alder.restartServer", "title": "Restart Server", "category": "Alder" }
],
"keybindings": [
  { "command": "alder.generate", "key": "ctrl+alt+a g", "mac": "cmd+alt+a g", "when": "alder.inProject" },
  { "command": "alder.routes", "key": "ctrl+alt+a u", "mac": "cmd+alt+a u", "when": "alder.inProject" },
  { "command": "alder.run", "key": "ctrl+alt+a r", "mac": "cmd+alt+a r", "when": "alder.inProject" },
  { "command": "alder.test.run", "key": "ctrl+alt+a t", "mac": "cmd+alt+a t", "when": "alder.inProject" },
  { "command": "alder.scratch.open", "key": "ctrl+alt+a x", "mac": "cmd+alt+a x", "when": "alder.inProject" },
  { "command": "alder.explainDiagnostic", "key": "ctrl+alt+a e", "mac": "cmd+alt+a e", "when": "editorLangId == alder" },
  { "command": "alder.test.runAtCursor", "key": "ctrl+alt+a shift+t", "mac": "cmd+alt+a shift+t", "when": "editorLangId == alder" },
  { "command": "alder.test.mutate", "key": "ctrl+alt+a m", "mac": "cmd+alt+a m", "when": "editorLangId == alder" },
  { "command": "alder.scratch.send", "key": "ctrl+alt+a s", "mac": "cmd+alt+a s", "when": "editorLangId == alder" },
  { "command": "alder.scratch.openValue", "key": "ctrl+alt+a o", "mac": "cmd+alt+a o", "when": "editorLangId == alder" }
]
```
The project-level set (generate, routes, run, test, scratch) follows alder.nvim's `keys.lua` `PROJECT` (plus run); the rest are editor-local there.

Add a unit test to `test/unit/legend.test.ts` that pins the command list against `NOT_YET` without importing `vscode` — instead, assert from `package.json` alone:
```ts
test('package.json contributes the twelve Alder commands, each with a category', () => {
  const ids = pkg.contributes.commands.map(c => c.command).sort();
  assert.deepEqual(ids, ['alder.explainDiagnostic', 'alder.generate', 'alder.restartServer', 'alder.routes',
    'alder.run', 'alder.scratch.open', 'alder.scratch.openValue', 'alder.scratch.send', 'alder.showHealth',
    'alder.test.mutate', 'alder.test.run', 'alder.test.runAtCursor']);
  assert.ok(pkg.contributes.commands.every(c => c.category === 'Alder'));
  assert.ok(!ids.includes('alder.fill') && !ids.includes('alder.explain'), 'server commands are not contributed');
});
```

- [ ] **Step 9: Run unit tests, lint and build**

Run: `npm run test:unit && npm run lint && npm run build`
Expected: PASS, no lint output, `dist/extension.js` rebuilt. (The client itself is proven in Task 5.)

- [ ] **Step 10: Commit**

```bash
git add src test/unit package.json
git commit -m "client: one alder lsp per app root, server-command dispatch, scratch store, commands and keys"
```

---

### Task 5: Contract tests against the real server

**Files:**
- Create: `test/e2e/run.ts`, `test/e2e/index.ts`, `test/e2e/helpers.ts`, `test/e2e/client.e2e.ts`, `test/e2e/editing.e2e.ts`, `test/e2e/fill.e2e.ts`

**Interfaces:**
- Consumes: `Api` from `src/extension.ts` (`clients.roots()`, `clients.statuses()`, `clients.forUri()`, `health()`); `TOKEN_TYPES`, `TOKEN_MODIFIERS` (Task 1).
- Environment: `ALDER_BIN` (an alder built from `.alder-ref`), `ALDER_REPO` (that checkout; fixtures come from it), optional `VSCODE_VERSION` (default `stable`).

Locally, build the binary once: `cd ~/projects/alder && git fetch && git worktree add /tmp/alder-ref $(cat ~/projects/alder-vscode/.alder-ref) 2>/dev/null; (cd /tmp/alder-ref && go build -o /tmp/alder-ref/bin/alder ./cmd/alder)`, then `ALDER_BIN=/tmp/alder-ref/bin/alder ALDER_REPO=/tmp/alder-ref npm run test:e2e`. (Use the session scratchpad instead of `/tmp` when running as an agent; remove the worktree afterwards with `git worktree remove`.)

- [ ] **Step 1: Write the launcher `test/e2e/run.ts`**

It builds a workspace of two apps from the alder checkout: `blog` (examples/blog as is) and `fill` (the blog with App's Logout arm turned into the hole `?out` and a `Helpers` module that fills it, as `internal/lsp/fill_test.go`'s `fillRoot` builds it), plus workspace settings that point at `ALDER_BIN` and give the server a fill command.

```ts
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see the plan's Task 5)`);
  return v;
}

// copyExample copies examples/<name> without build/ or databases, as the server tests do.
function copyExample(repo: string, name: string, to: string): void {
  cpSync(join(repo, 'examples', name), to, {
    recursive: true,
    filter: src => !/[/\\]build([/\\]|$)/.test(src.slice(repo.length)) && !/\.db(-wal|-shm)?$/.test(src),
  });
}

async function main(): Promise<void> {
  const bin = need('ALDER_BIN');
  const repo = resolve(need('ALDER_REPO'));
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'alder-vscode-e2e-')));
  copyExample(repo, 'blog', join(ws, 'blog'));
  copyExample(repo, 'blog', join(ws, 'fill'));
  const app = join(ws, 'fill/app/App.alder');
  const src = readFileSync(app, 'utf8');
  const holed = src.replace('    Task.succeed (Redirect (Auth.Login {}))\n', '    ?out\n');
  if (holed === src) throw new Error('no Logout arm to make a hole of: the blog changed; update the fixture');
  writeFileSync(app, holed);
  writeFileSync(join(ws, 'fill/app/Helpers.alder'),
    'module Helpers\n\ngoLogin : Task Nav\ngoLogin = Task.succeed (Redirect (Auth.Login {}))\n');
  mkdirSync(join(ws, '.vscode'));
  writeFileSync(join(ws, '.vscode/settings.json'), JSON.stringify({
    'alder.path': bin,
    'alder.serverEnv': { ALDER_FILL_COMMAND: 'cat >/dev/null; echo Helpers.goLogin' },
    'security.workspace.trust.enabled': false,
  }, null, 2));

  const root = resolve(__dirname, '../../..');
  await runTests({
    version: process.env.VSCODE_VERSION ?? 'stable',
    extensionDevelopmentPath: root,
    extensionTestsPath: join(__dirname, 'index.js'),
    launchArgs: [ws, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    extensionTestsEnv: { ALDER_E2E_WS: ws },
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Write the mocha loader `test/e2e/index.ts` and helpers**

`test/e2e/index.ts`:
```ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', timeout: 60_000, color: true });
  for (const f of readdirSync(__dirname).filter(f => f.endsWith('.e2e.js')).sort()) mocha.addFile(join(__dirname, f));
  return new Promise((res, rej) => mocha.run(failures => (failures ? rej(new Error(`${failures} failed`)) : res())));
}
```

`test/e2e/helpers.ts`:
```ts
import * as vscode from 'vscode';
import { join } from 'node:path';
import type { Api } from '../../src/extension';

export const ws = () => process.env.ALDER_E2E_WS!;
export const file = (rel: string) => vscode.Uri.file(join(ws(), rel));

export async function api(): Promise<Api> {
  const ext = vscode.extensions.getExtension<Api>('tapegram.alder');
  if (!ext) throw new Error('extension tapegram.alder is not loaded');
  return ext.activate();
}

// open shows a workspace file and waits until its root's client is running.
export async function open(rel: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(file(rel));
  const editor = await vscode.window.showTextDocument(doc);
  const a = await api();
  await until(async () => (await a.clients.ensure(doc)) !== undefined
    && a.clients.statuses().some(s => s.running && doc.uri.fsPath.startsWith(s.root)), `client for ${rel}`);
  return editor;
}

// until polls f every 100 ms until it is truthy or the timeout passes.
export async function until<T>(f: () => Promise<T> | T, what: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

// at is the position of the n-th (0-based) occurrence of needle in the document, plus offset.
export function at(doc: vscode.TextDocument, needle: string, n = 0, offset = 0): vscode.Position {
  let i = -1;
  for (let k = 0; k <= n; k++) {
    i = doc.getText().indexOf(needle, i + 1);
    if (i < 0) throw new Error(`no occurrence ${n} of ${JSON.stringify(needle)}`);
  }
  return doc.positionAt(i + offset);
}

export interface Tok { line: number; char: number; len: number; type: string; mods: string[] }

// decode turns the five-integer stream back into tokens with names.
export function decode(data: Uint32Array, legend: vscode.SemanticTokensLegend): Tok[] {
  const out: Tok[] = [];
  let line = 0, char = 0;
  for (let i = 0; i < data.length; i += 5) {
    line += data[i];
    char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
    const mods = legend.tokenModifiers.filter((_, b) => data[i + 4] & (1 << b));
    out.push({ line, char, len: data[i + 2], type: legend.tokenTypes[data[i + 3]], mods });
  }
  return out;
}
```

- [ ] **Step 3: Write `test/e2e/client.e2e.ts`**

```ts
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { api, at, decode, file, open, until } from './helpers';
import { TOKEN_TYPES, TOKEN_MODIFIERS } from '../../src/legend';

describe('the client', () => {
  it('starts one client for the blog with tokens, folding, selection and scratch', async () => {
    await open('blog/app/Posts/Show.alder');
    const a = await api();
    const st = a.clients.statuses().find(s => s.root.endsWith('/blog'));
    assert.ok(st, JSON.stringify(a.clients.statuses()));
    assert.deepEqual({ running: st.running, tokens: st.tokens, scratch: st.scratch }, { running: true, tokens: true, scratch: true });
    await open('blog/app/Posts/Index.alder');
    assert.equal(a.clients.roots().filter(r => r.endsWith('/blog')).length, 1, 'a second file reuses the client');
  });

  it('the server legend is the pinned legend', async () => {
    const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
      'vscode.provideDocumentSemanticTokensLegend', file('blog/app/Posts/Show.alder'));
    assert.deepEqual(legend.tokenTypes, [...TOKEN_TYPES]);
    assert.deepEqual(legend.tokenModifiers, [...TOKEN_MODIFIERS]);
  });

  it('tokens: tag at <article>, function+declaration at load', async () => {
    const { document: doc } = await open('blog/app/Posts/Show.alder');
    const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>('vscode.provideDocumentSemanticTokensLegend', doc.uri);
    const toks = await until(async () => {
      const t = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentSemanticTokens', doc.uri);
      return t && t.data.length > 0 ? decode(t.data, legend) : undefined;
    }, 'semantic tokens');
    const tokAt = (p: vscode.Position) => toks.find(t => t.line === p.line && t.char === p.character);
    assert.equal(tokAt(at(doc, '<article>', 0, 1))?.type, 'tag');
    const load = tokAt(at(doc, '\nload ', 0, 1));
    assert.equal(load?.type, 'function');
    assert.ok(load?.mods.includes('declaration'));
  });

  it('folding folds load; selection grows through model.post.title', async () => {
    const { document: doc } = await open('blog/app/Posts/Show.alder');
    const loadLine = at(doc, '\nload ', 0, 1).line;
    const folds = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', doc.uri);
    assert.ok(folds.some(f => (f.start === loadLine || f.start === loadLine + 1) && f.end > f.start + 5), JSON.stringify(folds));
    const p = at(doc, 'model.post.title', 0, 'model.post.'.length + 1);
    const [sel] = await vscode.commands.executeCommand<vscode.SelectionRange[]>('vscode.executeSelectionRangeProvider', doc.uri, [p]);
    const chain: vscode.Range[] = [];
    for (let s: vscode.SelectionRange | undefined = sel; s; s = s.parent) chain.push(s.range);
    assert.ok(chain.length >= 4, `chain of ${chain.length}`);
    assert.ok(chain[0].contains(p));
    for (let i = 1; i < chain.length; i++) assert.ok(chain[i].contains(chain[i - 1]) && !chain[i].isEqual(chain[i - 1]), `level ${i} grows`);
  });

  it('two apps in one workspace get two clients, each document its own', async () => {
    await open('blog/app/App.alder');
    await open('fill/app/Helpers.alder');
    const a = await api();
    const roots = a.clients.roots();
    assert.ok(roots.some(r => r.endsWith('/blog')) && roots.some(r => r.endsWith('/fill')), roots.join(', '));
    const c1 = await a.clients.forUri(file('blog/app/App.alder'));
    const c2 = await a.clients.forUri(file('fill/app/Helpers.alder'));
    assert.ok(c1 && c2 && c1 !== c2);
    assert.ok(a.clients.statuses().every(s => s.running), JSON.stringify(a.clients.statuses()));
  });

  it('health names the binary, each running server, and the fill variables without values', async () => {
    const text = (await (await api()).health()).join('\n');
    assert.match(text, /^binary: \//m);
    assert.match(text, /ok: alder lsp running for .*\/blog/);
    assert.match(text, /ALDER_FILL_COMMAND: set/);
    assert.ok(!text.includes('Helpers.goLogin'));
  });
});
```

- [ ] **Step 4: Write `test/e2e/editing.e2e.ts`**

```ts
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { open, until } from './helpers';

describe('editing through the stock client', () => {
  it('a removed import is a diagnostic from alder whose quick fix restores it', async () => {
    const editor = await open('blog/app/Posts/Index.alder');
    const doc = editor.document;
    const i = doc.getText().indexOf('import Layout\n');
    assert.ok(i >= 0);
    const edit = new vscode.WorkspaceEdit();
    edit.delete(doc.uri, new vscode.Range(doc.positionAt(i), doc.positionAt(i + 'import Layout\n'.length)));
    assert.ok(await vscode.workspace.applyEdit(edit));
    const diag = await until(() => vscode.languages.getDiagnostics(doc.uri)
      .find(d => d.source === 'alder' && d.message.includes('Layout')), 'a Layout diagnostic');
    const actions = await until(async () => {
      const acts = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider', doc.uri, diag.range, vscode.CodeActionKind.QuickFix.value);
      return acts?.find(a => a.title.startsWith('Fix: ') && a.edit);
    }, 'the quick fix');
    assert.ok(await vscode.workspace.applyEdit(actions.edit!));
    assert.ok(doc.getText().includes('import Layout\n'));
    await until(() => !vscode.languages.getDiagnostics(doc.uri).some(d => d.source === 'alder' && d.message.includes('Layout')), 'the diagnostic to clear');
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });

  it('formatting answers through the server', async () => {
    const { document: doc } = await open('blog/app/Posts/Show.alder');
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider', doc.uri, { tabSize: 2, insertSpaces: true });
    assert.ok(Array.isArray(edits ?? []), 'a formatting answer (no edits for a formatted file is fine)');
  });

  it('hover answers on a name', async () => {
    const { document: doc } = await open('blog/app/Posts/Show.alder');
    const p = doc.positionAt(doc.getText().indexOf('Post.bySlug') + 'Post.'.length + 1);
    const hovers = await until(async () => {
      const h = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, p);
      return h && h.length > 0 ? h : undefined;
    }, 'a hover');
    assert.ok(hovers.length > 0);
  });
});
```

- [ ] **Step 5: Write `test/e2e/fill.e2e.ts`**

```ts
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { at, open, until } from './helpers';

describe('Fill with AI', () => {
  it('the hole action runs the configured fill command and applies the edit with its import', async () => {
    const { document: doc } = await open('fill/app/App.alder');
    const p = at(doc, '?out', 0, 1);
    const action = await until(async () => {
      const acts = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider', doc.uri, new vscode.Range(p, p));
      return acts?.find(a => a.title.startsWith('Fill ?out with AI'));
    }, 'the fill action');
    assert.ok(action.command, 'the fill action carries a command');
    await vscode.commands.executeCommand(action.command.command, ...(action.command.arguments ?? []));
    await until(() => doc.getText().includes('Helpers.goLogin') && doc.getText().includes('import Helpers\n'), 'the filled hole', 30_000);
    assert.ok(!doc.getText().includes('?out'));
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });
});
```

- [ ] **Step 6: Build the pinned alder and run the contract tests**

Run (adjust the scratch path):
```bash
REF=$(cat .alder-ref); S=<scratchpad>/alder-ref
git -C ~/projects/alder fetch -q && git -C ~/projects/alder worktree add --detach "$S" "$REF"
(cd "$S" && go build -o "$S/bin/alder" ./cmd/alder)
ALDER_BIN="$S/bin/alder" ALDER_REPO="$S" npm run test:e2e
```
Expected: VS Code downloads into `.vscode-test/`, opens the workspace, all contract tests PASS. If one fails, debug it (superpowers:systematic-debugging): read the `Alder` output channel (set `alder.trace.server` to `verbose` in the generated settings) before changing code. A failure in the two-apps test that says "command already exists" means the executeCommand feature was not disabled before `start()`.

- [ ] **Step 7: Commit**

```bash
git add test/e2e
git commit -m "e2e: contract tests against the real server (client, tokens, folding, selection, quick fix, fill, two apps)"
```

---

### Task 6: CI, packaging, README

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

- [ ] **Step 1: Package locally**

Run: `npm run package && unzip -l alder-0.0.1.vsix`
Expected: `alder-0.0.1.vsix`; the listing holds `extension/dist/extension.js`, `extension/package.json`, `extension/language-configuration.json`, `extension/syntaxes/alder.tmLanguage.json`, README, CHANGELOG, LICENSE, and nothing from `src/`, `test/`, `node_modules/` or `out/`. If `vsce` warns about a missing field, add it to `package.json` rather than passing a flag.

- [ ] **Step 2: Write `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - name: alder ref
        id: ref
        run: echo "sha=$(cat .alder-ref)" >> "$GITHUB_OUTPUT"
      - uses: actions/checkout@v4
        with:
          repository: tapegram/alder
          ref: ${{ steps.ref.outputs.sha }}
          path: alder
      - uses: actions/setup-go@v5
        with:
          go-version-file: alder/go.mod
          cache-dependency-path: alder/go.sum
      - name: alder
        run: go build -o "$RUNNER_TEMP/bin/alder" ./cmd/alder
        working-directory: alder
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run test:unit
      - uses: actions/cache@v4
        with:
          path: .vscode-test
          key: vscode-test-${{ runner.os }}
      - name: contract
        run: |
          if [ "$RUNNER_OS" = Linux ]; then xvfb-run -a npm run test:e2e; else npm run test:e2e; fi
        env:
          ALDER_BIN: ${{ runner.temp }}/bin/alder
          ALDER_REPO: ${{ github.workspace }}/alder
      - name: package
        if: matrix.os == 'ubuntu-latest'
        run: npm run package
      - uses: actions/upload-artifact@v4
        if: matrix.os == 'ubuntu-latest'
        with:
          name: vsix
          path: '*.vsix'
```
The test step is the spec's "lint, unit, contract on Linux (xvfb) and macOS, package the `.vsix` as an artifact on every push". `setup-go`'s module cache keyed on alder's `go.sum` stands in for "cached by `go.mod` hash".

- [ ] **Step 3: Extend `README.md`**

Append:
```markdown
## Install

Until the Marketplace listing: download `alder-<version>.vsix` from a release (or a CI run's
`vsix` artifact) and run `code --install-extension alder-<version>.vsix`.

## Requirements

An `alder` binary with the `lsp` command. The extension looks at the `alder.path` setting, then
`PATH`, `$GOBIN`, `$GOPATH/bin`, `~/go/bin` and `~/bin` (VS Code started from the Dock sees a
shorter `PATH` than your shell). `Alder: Show Health` says what it found.

Each folder holding an `app/` directory is an app root and gets its own `alder lsp`.

## Settings

- `alder.path`: the binary.
- `alder.serverEnv`: environment for the server, for example `ANTHROPIC_API_KEY`.
- `alder.trace.server`: LSP traffic into the Alder output channel.
- `alder.test.args`: extra `alder test` arguments.

## Fill with AI

The lightbulb on a hole (`?h`) offers "Fill ?h with AI". It sends the module's source to the
configured model: set `ANTHROPIC_API_KEY` (and optionally `ALDER_FILL_MODEL`), or
`ALDER_FILL_COMMAND` to a command that reads the prompt on stdin, in the environment VS Code
starts from or in `alder.serverEnv`.

## Development

`npm ci`, then `npm run test:unit`. The contract tests need an alder checkout at the commit in
`.alder-ref` and a binary built from it: `ALDER_BIN=<bin> ALDER_REPO=<checkout> npm run test:e2e`.
```

- [ ] **Step 4: Run everything once more**

Run: `npm run lint && npm run test:unit && ALDER_BIN=... ALDER_REPO=... npm run test:e2e && npm run package`
Expected: all PASS, `alder-0.0.1.vsix` built.

- [ ] **Step 5: Commit, create the GitHub repository, push, open the PR**

```bash
git add .github README.md
git commit -m "CI (lint, unit, contract on ubuntu and macos, vsix artifact) and README"
git switch main
gh repo create tapegram/alder-vscode --public --source . --description "Alder language support for VS Code" --push
git switch scaffold && git push -u origin scaffold
gh pr create --base main --title "Scaffold: language, client per root, health, contract tests, CI (alder#144 M3)" --body "<summary; the two deviations (languageclient 11 / vscode ^1.91, Node 22); refs tapegram/alder#144>"
```
Expected: CI green on both runners. Watch CI with `gh pr checks --watch` (foreground, one call). Then link the PR from tapegram/alder#144 with a comment and update the roadmap (#52) only if the user asks.

---

## Self-review notes

- Spec coverage for milestone 3: repository and layout (Task 1, 6); language registration, configuration defaults, TextMate grammar, semantic token types/scopes (Task 1); discovery, gate, health, settings (Task 3); one client per root, env overlay, workspaceFolder, error handler, capability warnings, `alder/scratch` wired (Task 4); commands and keybindings with "not yet" bodies, `alder.inProject` (Task 4); unit and contract harnesses with the blog fixture (Tasks 1–5); CI and `vsce package` (Task 6). "Usable at the end": stock client features and fill are proven by Task 5.
- Not in this milestone (spec milestones 4–7): `cli.ts`, routes, run, explain, Test Explorer, generator flow, scratch UI, release workflow. The `on dispose, close the generator flow and the routes picker` rule arrives with those UIs.
- Left out of the contract set for now: the Apply/Discard question for an effectful fill (a modal VS Code warning a test cannot answer without a UI hook; milestone 5's injected `ui` interface is where it can be driven).
