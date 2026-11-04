import type { PreviewResult } from './types';

// preview: the preview document's lines from an alder/preview answer (the files it would touch,
// a rule, the unified diff, the holes it leaves) or the refusal. Port of preview.lua.

export const RULE = '─'.repeat(40);

const MARK: Record<string, string> = { created: '+ ', removed: '- ' };

export function render(r: PreviewResult | null | undefined): string[] {
  if (!r) return [];
  if (r.error) return r.error.split('\n');
  const lines: string[] = [];
  for (const f of r.files ?? []) {
    const m = MARK[f.action];
    lines.push(m ? m + f.path : `~ ${f.path}  +${f.added ?? 0} −${f.removed ?? 0}`);
  }
  const holes = r.holes ?? [];
  if (lines.length > 0 && (r.diff || holes.length > 0)) lines.push(RULE);
  if (r.diff) {
    const dl = r.diff.split('\n');
    if (dl[dl.length - 1] === '') dl.pop();
    lines.push(...dl);
  }
  for (const h of holes) lines.push(`? ${h.name} : ${h.type}`);
  return lines;
}

// firstHunk is the index of the first `@@` line (the first change), else 0.
export function firstHunk(lines: string[]): number {
  const i = lines.findIndex(l => l.startsWith('@@'));
  return i < 0 ? 0 : i;
}
