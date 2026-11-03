import type { PlanResult } from './types';

// review: the plan as the review step shows it: what it leaves to you (the refusal, diagnostics,
// holes with their address, imports, migration) and the files with both sides for vscode.diff.
// Port of review.lua's model.

export interface ReviewFile { path: string; mark: '+' | '-' | '~'; before: string; after: string }
export interface ReviewModel { notes: string[]; files: ReviewFile[]; canApply: boolean }

export function reviewModel(plan: PlanResult | null | undefined): ReviewModel {
  const p = plan ?? {};
  const notes: string[] = [];
  const canApply = !p.error;
  if (p.error) notes.push(`✗ ${p.error}`);
  for (const d of p.diagnostics ?? []) notes.push(`${d.file ?? ''}:${d.line ?? 0}:${d.col ?? 0} ${d.code ?? ''} ${d.message ?? ''}`);
  for (const h of p.holes ?? []) {
    const addr = `${h.module ?? ''}.${h.decl ?? ''}${h.arm ? `.${h.arm}` : ''}`;
    notes.push(`? ${h.name ?? ''} : ${h.type ?? ''}  (${addr})`);
  }
  for (const i of p.imports ?? []) notes.push(`import ${i}`);
  for (const m of p.migration ?? []) notes.push(`migration: ${m}`);
  const files = (p.files ?? []).map((f): ReviewFile => ({
    path: f.path ?? '',
    mark: f.before === null ? '+' : f.after === null ? '-' : '~',
    before: f.before ?? '',
    after: f.after ?? '',
  }));
  return { notes, files, canApply };
}
