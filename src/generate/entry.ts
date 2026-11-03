import { promises as fs } from 'node:fs';
import { join } from 'node:path';

// entryFile is the document a generator flow starts from when no alder editor is active, as
// project.lua's entry: app/App.alder, else the first .alder under app/ (names in order, a
// folder's files before the next sibling), else undefined.
export async function entryFile(root: string): Promise<string | undefined> {
  const app = join(root, 'app');
  const main = join(app, 'App.alder');
  try {
    if ((await fs.stat(main)).isFile()) return main;
  } catch {
    // no App.alder
  }
  const walk = async (dir: string): Promise<string | undefined> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        const found = await walk(p);
        if (found) return found;
      } else if (e.name.endsWith('.alder')) {
        return p;
      }
    }
    return undefined;
  };
  return walk(app);
}
