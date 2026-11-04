# Dogfood pass: nightvote-replay (2026-11-04)

This is the release plan's dogfooding pass for alder-vscode 0.1.0 (alder#144 milestone 7). It runs the extension over a copy of nightvote-replay, a private Alder app with 48 modules and 375 tests. The harness is `test/e2e/dogfood.e2e.ts`. It writes a JSON report, which is not committed because it names the app's private paths and tests. This page summarises it.

## Setup

- VS Code 1.145.0 (`@vscode/test-electron`, stable).
- nightvote-replay at `56f707c`. The pass copies the app (without `.git`, `build/` and databases) into a temp workspace and fails if the real app's `git status` changes. It did not change in any run.
- Command:
  `ALDER_BIN=<bin> ALDER_DOGFOOD_ROOT=~/projects/nightvote-replay npm run test:e2e`
- Three runs:
  1. **The user's binary** (`command -v alder`): `/opt/homebrew/bin/alder`, `alder v0.1.0 (go 1.27.2)`, the Homebrew tap's only release.
  2. **alder main** `5a35e5ad` (`alder devel+5a35e5ad3a26`), the build `.alder-ref` pins, on the unchanged app.
  3. **alder main** `5a35e5ad` on a scratch copy of the app, patched to compile on main. The patch renames its `Json` module to `AppJson` and wraps two `File.json` arguments in `Json.string`; see finding 3. The real repo was not touched.

## Results

Run 1 stopped at the gate: the extension refuses v0.1.0 because it has no `lsp`. There are no numbers to report beyond that.

Run 2 failed: the app does not compile on main (finding 3). Tokens and folding still worked on all 48 files. The editor showed exactly the one error `alder check` reports. Routes, tests and scratch failed, as expected for an app that does not compile: routes were empty on both sides, the test run ended as `compile`, and the scratch watch never evaluated.

Run 3 is the one that measures the extension:

| Area | Number | Status |
|---|---|---|
| Files: client, semantic tokens, folding | 48 of 48 files; 55k tokens; every file has folding ranges | ok |
| Slowest file to first tokens | 42 ms (median 14 ms) | ok |
| Diagnostics vs `alder check` | check exits 0; the editor shows 0 errors | ok |
| Routes: server vs `alder routes --json` | 21 vs 21 | ok |
| Tests: discovered vs results | 375 vs 375 (364 passed, 11 failed, the same as `alder test`) | ok |
| Generators at a page's first line | 21 listed, 6 apply here | ok |
| Scratch: Open Scratch to `⇒ 2 : Int` (first build of the program) | 2.3 s | ok |

All 11 failed tests check the two endpoints whose `File.json` argument the patch changed. They fail because of the patch, not the extension, and the CLI run gives the same 364/11.

## Findings

- **The extension ignores a working binary when an older one comes first** (extension side): tapegram/alder-vscode#9. With `alder.path` unset, discovery stops at the first `alder` found: Homebrew's v0.1.0 on `PATH`. The gate refuses it, even though `~/go/bin/alder` (the README's build) has `lsp`. Every feature is off until the user sets `alder.path`. This is the default setup on the maintainer's machine. **Release blocker candidate.**
- **No released alder has `alder lsp`** (server and release side): tapegram/alder#174. Homebrew ships v0.1.0 (2026-10-17), which predates editor support. Until a newer alder is released, every user must build alder from a checkout.
- **Stdlib `Json` breaks existing apps** (server side): tapegram/alder#175. On main, a user module named `Json` is now E0017. `File.json` now takes `Json.Value`, and there is no way to pass already-encoded text. An app written against an earlier alder stops compiling on upgrade. That leaves no routes, a compile-error test run and no scratch until the app is ported.
- **Harness only:** when the gate fails, a file-by-file pass would wait 60 s per file. The pass now checks the gate first and reports the refusal at once.
