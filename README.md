# Alder for VS Code

Language support for [Alder](https://github.com/tapegram/alder): the `alder lsp` server's
diagnostics, hover, completion, code actions, formatting, highlighting and folding.

Requires an `alder` binary that has the `lsp` command (alder v0.2.0 or later). Install it with
Homebrew: `brew install tapegram/alder/alder`, or `brew upgrade alder` if an older one is
installed.

## Install

Download `alder-<version>.vsix` from the
[latest release](https://github.com/tapegram/alder-vscode/releases/latest) (or
`gh release download -R tapegram/alder-vscode -p '*.vsix'`) and run
`code --install-extension alder-<version>.vsix`. The extension is not on the Marketplace or
Open VSX yet.

## Requirements

An `alder` binary with the `lsp` command. The extension looks at the `alder.path` setting, then
`PATH`, `$GOBIN`, `$GOPATH/bin`, `~/go/bin` and `~/bin` (VS Code started from the Dock sees a
shorter `PATH` than your shell); an `alder.path` that is a path is used alone and turns off the
search. It takes the first `alder` there that has the `lsp` command: an
older one earlier on `PATH`, such as a release before v0.2.0, is skipped and listed by
`Alder: Show Health`, which says what it found.

Any alder new enough to have `lsp` works: the extension checks what the binary offers when it
starts rather than asking for a version. An alder without highlighting or scratch support
says so once, and the rest keeps working; `Alder: Show Health` lists what is missing.

Each folder holding an `app/` directory is an app root and gets its own `alder lsp`.

Platforms: macOS and Linux.

## Settings

- `alder.path`: the binary.
- `alder.serverEnv`: environment for the server, for example `ANTHROPIC_API_KEY`.
- `alder.trace.server`: LSP traffic into the Alder output channel.
- `alder.test.args`: extra `alder test` arguments.

## Commands

All under "Alder" in the command palette; the chord is `ctrl+alt+a` (`cmd+alt+a` on macOS).

- **Generate** (`g`): pick a generator (the ones that apply at the cursor first), fill in its
  form while a diff preview updates beside it, review the plan (the diff button), and apply
  (Enter on Apply, or `ctrl+enter` / `cmd+enter` from any field). The result is one undo step:
  edited and new files are left unsaved, and a file the generator removes is deleted only after
  you confirm. The generator code actions (the lightbulb) open the same flow, already filled in.
- **Routes** (`u`): the app's pages and messages; pick one to open its declaration.
- **Run the App** (`r`): `alder run` in a terminal at the app root, reused while it is open.
- **Explain Diagnostic** (`e`): the explanation of the diagnostic under the cursor (or a code you
  type) in a markdown preview.
- **Run Tests** (`t`), **Run Test at Cursor** (`shift+t`), **Mutation Testing** (`m`): also in the
  Test Explorer, where "Mutation testing" is a second run profile. Unsaved `.alder` files of the
  app are saved first (the tests read disk). A failing test shows its two sides as a diff, the
  right side as expected; mutants that survive are warnings in Problems until the next mutation
  run. `alder.test.args` is added to every run.
- **Open Scratch** (`x`): the app's `scratch.alder`, created when missing. Each `> expr` line is a
  watch: saving runs the file, and each watch's value shows at the end of its line. **Send to
  Scratch** (`s`) appends the selected lines (or the cursor's line) and saves: an expression
  becomes a watch, a definition goes in as written. **Open Scratch Value** (`o`) opens the full
  value of the watch under the cursor beside it; hovering a watch whose value does not fit on its
  line shows it too. An error or note about the whole file shows at the end of its first line.

## Fill with AI

The lightbulb on a hole (`?h`) offers "Fill ?h with AI". It sends the module's source, the names
and types of the values in scope (including those of the app modules it imports), the type
declarations of those imported app modules with their constructors, the source text of their
table definitions, and the standard library's signatures to the configured model, together with the whole file named by
`ALDER_FILL_REFERENCE` when that is set. Set `ANTHROPIC_API_KEY` (and optionally
`ALDER_FILL_MODEL`), or `ALDER_FILL_COMMAND` to a command that reads the prompt on stdin
(it receives the same text), in the environment VS Code starts from or in `alder.serverEnv`.
Put `ANTHROPIC_API_KEY` in your user settings or your shell's environment, never in a
committed `.vscode/settings.json`.

## Known limitations

- Windows is untested, and binary discovery does not look for `alder.exe`.
- No highlighting inside `<script>` and `<style>`.
- The Test Explorer finds tests by a pattern (`test "name" =` at the start of a line), so a test
  written another way shows up only after it has run.
- No packaged alder release has `lsp` yet, so build alder from source as in Requirements
  ([tapegram/alder#174](https://github.com/tapegram/alder/issues/174)).

## Development

`npm ci`, then `npm run test:unit`. The contract tests need an alder checkout at the commit in
`.alder-ref` and a binary built from it: `ALDER_BIN=<bin> ALDER_REPO=<checkout> npm run test:e2e`.
Set `VSCODE_VERSION` (default `stable`) to run them against another VS Code; CI also runs 1.91.0,
the `engines` floor.

### Releasing

Set the version (`npm version <x.y.z> --no-git-tag-version`), give CHANGELOG.md a `## <x.y.z>`
section, merge, then tag the merge commit `v<x.y.z>` and push the tag. The release workflow
runs CI and attaches the `.vsix` with that section as the notes; a tag that does not match
`package.json`, or a missing section, fails before anything is published.
