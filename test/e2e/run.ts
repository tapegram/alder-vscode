import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
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

// DEMO's line numbers are pinned by tests.e2e.ts (0-based: "answer is positive" on 5, "answer is 42" on 7).
export const DEMO = [
  'module Demo',
  '',
  'answer : Int',
  'answer = 40 + 1',
  '',
  'test "answer is positive" = answer > 0',
  '',
  'test "answer is 42" = answer == 42',
  '',
].join('\n');

// PAD's lines are pinned by scratch.e2e.ts.
export const PAD = [
  'module Pad',
  '',
  'answer : Int',
  'answer =',
  '    20 + 22',
  '',
].join('\n');

// contract runs the contract e2e suite on copies of the alder repo's examples and fresh apps.
async function contract(): Promise<void> {
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
  // gen: a blog copy the generator tests change (created, edited and removed files), with an
  // unlinked page (Tags.Index) for `remove page`.
  copyExample(repo, 'blog', join(ws, 'gen'));
  execFileSync(bin, ['new', 'page', 'Tags.Index', '/tags', '--dir', join(ws, 'gen')], { stdio: 'ignore' });
  // demo: a fresh `alder new` app with one passing and one failing test (Demo), for the test
  // controller, mutation testing, explain and run. The scaffold's own Home tests pass.
  execFileSync(bin, ['new', 'demo'], { cwd: ws, stdio: 'ignore' });
  writeFileSync(join(ws, 'demo/app/Demo.alder'), DEMO);
  // pad: a fresh app for scratch files (its scratch runs build and run a program: kept apart
  // from the apps other tests save in, since a save reruns every open scratch document).
  execFileSync(bin, ['new', 'pad'], { cwd: ws, stdio: 'ignore' });
  // the scaffold writes a scratch.alder: gone, so the e2e sees Open Scratch create it
  rmSync(join(ws, 'pad/scratch.alder'), { force: true });
  // and no migrations: a scratch build globs <root>/migrations/*.sql unescaped, so under the [x]
  // root it finds none and fails (alder internal/buildkit CopyMigrations); pad needs no database
  rmSync(join(ws, 'pad/migrations'), { recursive: true, force: true });
  writeFileSync(join(ws, 'pad/app/Pad.alder'), PAD);
  mkdirSync(join(ws, '.vscode'));
  writeFileSync(join(ws, '.vscode/settings.json'), JSON.stringify({
    'alder.path': bin,
    'alder.serverEnv': { ALDER_FILL_COMMAND: 'cat >/dev/null; echo Helpers.goLogin' },
    'alder.trace.server': process.env.ALDER_E2E_TRACE ?? 'off',
    'security.workspace.trust.enabled': false,
    // the chat view's input editor otherwise keeps the text focus: `undo` would go there
    'chat.disableAIFeatures': true,
  }, null, 2));

  const root = resolve(__dirname, '../../..');
  try {
    await runTests({
      version: process.env.VSCODE_VERSION ?? 'stable',
      extensionDevelopmentPath: root,
      extensionTestsPath: join(__dirname, 'index.js'),
      launchArgs: [ws, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
      extensionTestsEnv: { ALDER_E2E_WS: ws, ALDER_E2E_ONLY: process.env.ALDER_E2E_ONLY ?? '' },
    });
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

// dogfood runs dogfood.e2e.ts alone on a copy of a real app (ALDER_DOGFOOD_ROOT), and fails if
// the real app's git status changed: the pass must never write to it. --ignored catches a new
// build/ or database too (an ignored directory is one `!! dir/` line, so churn inside one is not).
async function dogfood(src: string): Promise<void> {
  const bin = need('ALDER_BIN');
  const status = () => execFileSync('git', ['status', '--porcelain', '--ignored'], { cwd: src, encoding: 'utf8' });
  const before = status();
  // no [x] in this path: a scratch build of a real app needs its migrations (alder#172)
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'alder-vscode-dogfood-')));
  const app = join(ws, basename(src));
  // symlinks are not copied: one pointing back into the real app could be written through
  cpSync(src, app, {
    recursive: true,
    filter: p => {
      const rel = p.slice(src.length);
      return !lstatSync(p).isSymbolicLink() && !/[/\\](\.git|build|node_modules|\.superpowers)([/\\]|$)/.test(rel) && !/\.db(-wal|-shm)?$/.test(rel);
    },
  });
  // Open Scratch must create it, as for a new user
  rmSync(join(app, 'scratch.alder'), { force: true });
  mkdirSync(join(ws, '.vscode'));
  writeFileSync(join(ws, '.vscode/settings.json'), JSON.stringify({
    'alder.path': bin,
    'security.workspace.trust.enabled': false,
    'chat.disableAIFeatures': true,
  }, null, 2));
  const root = resolve(__dirname, '../../..');
  let failed: unknown;
  try {
    await runTests({
      version: process.env.VSCODE_VERSION ?? 'stable',
      extensionDevelopmentPath: root,
      extensionTestsPath: join(__dirname, 'index.js'),
      launchArgs: [ws, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
      extensionTestsEnv: {
        ALDER_E2E_WS: ws,
        ALDER_E2E_ONLY: 'dogfood',
        ALDER_DOGFOOD_APP: app,
        ALDER_DOGFOOD_BIN: bin,
        ALDER_DOGFOOD_OUT: resolve(process.env.ALDER_DOGFOOD_OUT ?? join(root, 'out/dogfood.json')),
      },
    });
  } catch (err) {
    failed = err;
  }
  rmSync(ws, { recursive: true, force: true });
  // the guard's failure goes with the run's own error, never in place of it
  const guard = status() !== before ? new Error(`the dogfood pass changed ${src}: git status differs`) : undefined;
  if (failed && guard) throw new AggregateError([failed, guard], `${guard.message}; and the run failed: ${(failed as Error).message}`);
  if (failed) throw failed;
  if (guard) throw guard;
}

async function main(): Promise<void> {
  const src = process.env.ALDER_DOGFOOD_ROOT;
  // realpath: the symlink filter must not skip a root that is itself a symlink
  await (src ? dogfood(realpathSync(resolve(src))) : contract());
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
