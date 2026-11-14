# Changelog

## Unreleased

- Search (`ctrl+alt+a f`): find functions by name or type over `alder/search`, insert or fill a
  typed hole with `alder/searchEdit`, go to an app result's definition; the "Search for `<type>`"
  hole action opens it (alder#166). Needs an alder with `alder/search` (CI pins alder 402f344).

## 0.1.0

- Language registration, fallback grammar, `alder lsp` client per app root, health and restart commands.
- Routes, Run the App, Explain Diagnostic, and the Test Explorer with run and mutation-testing
  profiles (alder#144 milestone 4).
- Generate: the generator flow with a live preview, review and one-step apply (alder#144 milestone 5).
- Scratch files: open, send, open value, the hover and the file-level note (alder#144 milestone 6).
- Binary discovery takes the first `alder` that has `lsp`, skipping an older one earlier on `PATH` (#9).
- Releases: a `v*` tag runs CI and attaches the `.vsix` to a GitHub release.
