import type { PlanFile, PlanResult } from './types';

// planCheck: the pure half of apply.lua: whether the files still read as planned, the files a
// plan removes, where the cursor lands after applying, and the messages.

export const staleMessage = (path: string) => `alder: ${path} changed since planning; nothing applied`;
export const deletePrompt = (paths: string[]) => `Delete ${paths.join(', ')} from disk? undo cannot restore it`;

// firstStale is the first file whose text as the user sees it (textOf: seenText) is not its planned before (null for a created file: it must not exist).
export async function firstStale(files: PlanFile[], textOf: (rel: string) => Promise<string | null>): Promise<string | undefined> {
  for (const f of files) {
    if ((await textOf(f.path)) !== f.before) return f.path;
  }
  return undefined;
}

// seenText is a file's text as the user sees it, from its open document (if any) and disk (its
// text, null when it does not exist): a dirty document's text; else none when the file is not on
// disk, for a clean document of a missing file is stale (a created file reverted and removed);
// else the document's, else the disk's.
export function seenText(doc: { dirty: boolean; text: string } | undefined, disk: string | null): string | null {
  if (doc?.dirty) return doc.text;
  if (disk === null) return null;
  return doc ? doc.text : disk;
}

// emptyDirs are the folders to remove after removing path, while they are empty, innermost
// first, up to app/'s level: the CLI's removeEmptyDirs (app/Posts/ after Posts.Index).
export function emptyDirs(path: string): string[] {
  const parent = (p: string) => p.split('/').slice(0, -1).join('/');
  const out: string[] = [];
  for (let dir = parent(path); dir !== '' && dir !== 'app'; dir = parent(dir)) out.push(dir);
  return out;
}

// removedPaths are the files a plan deletes, in plan order: the confirm names every one.
export function removedPaths(files: PlanFile[]): string[] {
  return files.filter(f => f.after === null).map(f => f.path);
}

export type Landing = { kind: 'hole'; file: string; line: number; col: number } | { kind: 'file'; path: string };

// landing is where the cursor goes after applying (0-based): the first hole, so the lightbulb
// there offers Fill with AI; else the first created .alder file; else the first edited one that
// is not activeRel (the active editor's path relative to the root).
export function landing(plan: PlanResult, activeRel?: string): Landing | undefined {
  const h = (plan.holes ?? [])[0];
  if (h) return { kind: 'hole', file: h.file, line: Math.max(h.line - 1, 0), col: Math.max((h.col || 1) - 1, 0) };
  const files = plan.files ?? [];
  const created = files.find(f => f.before === null && f.after !== null && f.path.endsWith('.alder'));
  if (created) return { kind: 'file', path: created.path };
  const edited = files.find(f => f.before !== null && f.after !== null && f.path !== activeRel);
  if (edited) return { kind: 'file', path: edited.path };
  return undefined;
}

export function appliedMessage(id: string, plan: PlanResult): string {
  const paths = (plan.files ?? []).map(f => f.path).join(', ');
  const n = (plan.holes ?? []).length;
  const left = n === 0 ? '' : ` (${n} hole${n === 1 ? '' : 's'})`;
  return `alder: applied ${id}: ${paths}${left}`;
}
