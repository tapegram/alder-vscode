# Alder for VS Code

Language support for [Alder](https://github.com/tapegram/alder): the `alder lsp` server's
diagnostics, hover, completion, code actions, formatting, highlighting and folding.

Requires an `alder` binary that has the `lsp` command. Build one from a checkout of
tapegram/alder: `go build -o ~/bin/alder ./cmd/alder`.

## Install

Until the Marketplace listing: download `alder-<version>.vsix` from a release (or a CI run's
`vsix` artifact) and run `code --install-extension alder-<version>.vsix`.

## Requirements

An `alder` binary with the `lsp` command. The extension looks at the `alder.path` setting, then
`PATH`, `$GOBIN`, `$GOPATH/bin`, `~/go/bin` and `~/bin` (VS Code started from the Dock sees a
shorter `PATH` than your shell). `Alder: Show Health` says what it found.

Each folder holding an `app/` directory is an app root and gets its own `alder lsp`.

Platforms: macOS and Linux. Windows is untested, and binary discovery does not look for
`alder.exe`.

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
Set `VSCODE_VERSION` (default `stable`) to run them against another VS Code; CI also runs 1.91.0,
the `engines` floor.
