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
// more, such as a date), up to the next "## " heading, trimmed.
export function releaseNotes(changelog: string, version: string): string {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(l => l === `## ${version}` || l.startsWith(`## ${version} `));
  if (start < 0) throw new Error(`CHANGELOG.md has no "## ${version}" section`);
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
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

// bundleRequires is every module the bundle requires by a string literal, once each, sorted.
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

function main(argv: string[]): number {
  const [cmd, arg] = argv;
  const root = join(__dirname, '..', '..');
  try {
    if (cmd === 'notes' && arg) {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
      const v = tagVersion(arg, pkg.version);
      process.stdout.write(releaseNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), v) + '\n');
      return 0;
    }
    if (cmd === 'check-vsix' && arg) {
      const entries = execFileSync('unzip', ['-Z1', arg], { encoding: 'utf8' }).split('\n').filter(Boolean);
      const problems = vsixProblems(entries);
      if (entries.includes('extension/dist/extension.js')) {
        const js = execFileSync('unzip', ['-p', arg, 'extension/dist/extension.js'], { encoding: 'utf8', maxBuffer: 64 << 20 });
        problems.push(...bundleProblems(bundleRequires(js)));
      }
      for (const p of problems) process.stderr.write(p + '\n');
      return problems.length ? 1 : 0;
    }
    process.stderr.write('usage: release.js notes <tag> | check-vsix <file.vsix>\n');
    return 2;
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
