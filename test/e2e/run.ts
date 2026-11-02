import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
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
  // the [x] makes the root a glob metacharacter path: a broken selector escape fails the tests
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'alder-vscode-e2e-[x]-')));
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
    'alder.trace.server': process.env.ALDER_E2E_TRACE ?? 'off',
    'security.workspace.trust.enabled': false,
  }, null, 2));

  const root = resolve(__dirname, '../../..');
  try {
    await runTests({
      version: process.env.VSCODE_VERSION ?? 'stable',
      extensionDevelopmentPath: root,
      extensionTestsPath: join(__dirname, 'index.js'),
      launchArgs: [ws, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
      extensionTestsEnv: { ALDER_E2E_WS: ws },
    });
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
