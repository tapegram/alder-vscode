// The release rules, pure, plus a small CLI the workflows run (after `tsc -p .`):
//   node out/scripts/release.js notes <tag>        the CHANGELOG section for the tag's version
//   node out/scripts/release.js check-vsix <file>  the .vsix's entries and its bundle's requires
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

// EXPECTED_VSIX is every file `vsce package` puts in the .vsix (pinned 2026-11-04, vsce 4).
// A change to .vscodeignore or package.json's files changes this list on purpose.
export const EXPECTED_VSIX = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/LICENSE.txt',
  'extension/changelog.md',
  'extension/dist/extension.js',
  'extension/language-configuration.json',
  'extension/package.json',
  'extension/readme.md',
  'extension/syntaxes/alder.tmLanguage.json',
];

// tagVersion is the version a tag names: "v<version>" (or refs/tags/v<version>), equal to the
// package's version.
export function tagVersion(tag: string, pkgVersion: string): string {
  const name = tag.replace(/^refs\/tags\//, '');
  if (!name.startsWith('v')) throw new Error(`tag ${name} is not v<version>`);
  const v = name.slice(1);
  if (v !== pkgVersion) throw new Error(`tag ${name} does not match package.json version ${pkgVersion}`);
  return v;
}

// releaseNotes is the body of the "## <version>" section (the heading may go on with a space and
// more, such as a date), up to the next "## " heading, trimmed. A "## " line inside a fenced code
// block (``` or ~~~) is not a heading.
export function releaseNotes(changelog: string, version: string): string {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  let fence = '';
  const headings: number[] = [];
  lines.forEach((l, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l)?.[1];
    if (f && !fence) fence = f[0];
    else if (f && f[0] === fence) fence = '';
    else if (!fence && l.startsWith('## ')) headings.push(i);
  });
  const start = headings.find(i => lines[i] === `## ${version}` || lines[i].startsWith(`## ${version} `));
  if (start === undefined) throw new Error(`CHANGELOG.md has no "## ${version}" section`);
  const end = headings.find(i => i > start) ?? lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  if (!body) throw new Error(`CHANGELOG.md's "## ${version}" section is empty`);
  return body;
}

// vsixProblems compares a .vsix's file entries (directory entries ignored) with EXPECTED_VSIX.
export function vsixProblems(entries: string[]): string[] {
  const got = new Set(entries.filter(e => !e.endsWith('/')));
  const want = new Set(EXPECTED_VSIX);
  return [
    ...EXPECTED_VSIX.filter(e => !got.has(e)).map(e => `missing from the .vsix: ${e}`),
    ...[...got].filter(e => !want.has(e)).sort().map(e => `unexpected in the .vsix: ${e}`),
  ];
}

// bundleRequires is every module the bundle requires by a string literal, once each, sorted. It
// sees only a literal require("…"): a dynamic require is invisible, and a guarded optional
// require in a bundled dependency (try { require("x") } catch {}) would be a false positive.
export function bundleRequires(js: string): string[] {
  const names = new Set<string>();
  for (const m of js.matchAll(/require\((["'])([^"']+)\1\)/g)) names.add(m[2]);
  return [...names].sort();
}

// bundleProblems refuses any require but vscode and Node's built-ins: the .vsix ships no
// node_modules (vsce package --no-dependencies), so anything else fails at activation.
export function bundleProblems(requires: string[]): string[] {
  const builtin = new Set(builtinModules);
  return requires
    .filter(r => r !== 'vscode' && !r.startsWith('node:') && !builtin.has(r))
    .map(r => `the bundle requires ${r} (not vscode or a Node built-in): bundle it or drop it`);
}

interface Io { out: (s: string) => void; err: (s: string) => void }

// main runs a CLI command against the package at root and returns the exit code.
export function main(argv: string[], root: string, io: Io): number {
  const [cmd, arg] = argv;
  try {
    if (cmd === 'notes' && arg) {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
      const v = tagVersion(arg, pkg.version);
      io.out(releaseNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), v) + '\n');
      return 0;
    }
    if (cmd === 'check-vsix' && arg) {
      const entries = execFileSync('unzip', ['-Z1', arg], { encoding: 'utf8' }).split('\n').filter(Boolean);
      const problems = vsixProblems(entries);
      if (entries.includes('extension/dist/extension.js')) {
        const js = execFileSync('unzip', ['-p', arg, 'extension/dist/extension.js'], { encoding: 'utf8', maxBuffer: 64 << 20 });
        problems.push(...bundleProblems(bundleRequires(js)));
      }
      for (const p of problems) io.err(p + '\n');
      return problems.length ? 1 : 0;
    }
    io.err('usage: release.js notes <tag> | check-vsix <file.vsix>\n');
    return 2;
  } catch (e) {
    io.err(`${(e as Error).message}\n`);
    return 1;
  }
}

if (require.main === module) {
  const io = { out: (s: string) => process.stdout.write(s), err: (s: string) => process.stderr.write(s) };
  process.exitCode = main(process.argv.slice(2), join(__dirname, '..', '..'), io);
}
