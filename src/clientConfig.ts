import { pathToFileURL } from 'node:url';

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

// selectorPatterns are the document selector's patterns for a root reached by these paths
// (the path the documents use and the real path, when a symlink makes them differ). Each is a
// relative pattern with the root as its base: VS Code compares a base as a path, so a root
// with [ ] { } in its name needs no glob escaping (and none would do: its glob reads a bare ]
// as an empty class, and a { as a brace that stops it splitting the rest at /).
export function selectorPatterns(paths: string[]): { baseUri: string; pattern: string }[] {
  return [...new Set(paths)].map(p => ({ baseUri: pathToFileURL(p).href, pattern: '**' }));
}

// commandUri is the document a server command is about, when its argument names one
// (alder.fill's argument carries the uri; alder.explain's is a code).
export function commandUri(args: unknown[]): string | undefined {
  const a = args[0];
  if (a && typeof a === 'object' && typeof (a as { uri?: unknown }).uri === 'string') return (a as { uri: string }).uri;
  return undefined;
}
