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
