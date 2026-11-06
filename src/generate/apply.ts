import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import type { ApplyUi, Origin, Server } from './flow';
import { appliedMessage, deletePrompt, emptyDirs, firstStale, landing, removedPaths, seenText, staleMessage } from './planCheck';
import type { PlanDiagnostic, PlanResult, Sets } from './types';

// apply: the port of apply.lua. It plans the generator again with the sets the user saw, checks
// that nothing changed since, and applies every file as one WorkspaceEdit (one undo step):
// edited and created files are left unsaved; a removed file is deleted after a confirm.

export interface ApplyEnv { server: Server; root: string; ui: ApplyUi; diagnostics: vscode.DiagnosticCollection }

// textOf is a file's text as the user sees it (seenText): a clean document left open for a file
// no longer on disk is not the file.
export async function textOf(path: string): Promise<string | null> {
  const doc = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === path);
  if (doc?.isDirty) return doc.getText();
  let disk: string | null;
  try {
    disk = await fs.readFile(path, 'utf8');
  } catch {
    disk = null;
  }
  return seenText(doc && { dirty: doc.isDirty, text: doc.getText() }, disk);
}

// removeEmptyDirs removes the folders a removed file leaves empty (emptyDirs), as the CLI does.
async function removeEmptyDirs(root: string, removed: string[]): Promise<void> {
  for (const path of removed) {
    for (const dir of emptyDirs(path)) {
      try {
        await fs.rmdir(join(root, dir));
      } catch {
        break; // not empty
      }
    }
  }
}

// refusal is a refused plan's diagnostics by file. They describe the dry-run copy, so they go to
// their own collection, never the server's.
function refusal(root: string, ds: PlanDiagnostic[]): [vscode.Uri, vscode.Diagnostic[]][] {
  const by = new Map<string, vscode.Diagnostic[]>();
  for (const d of ds) {
    const p = new vscode.Position(Math.max(d.line - 1, 0), Math.max(d.col - 1, 0));
    const diag = new vscode.Diagnostic(new vscode.Range(p, p), `${d.code} ${d.message}`,
      d.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
    diag.source = 'alder generate';
    const key = join(root, d.file);
    by.set(key, [...(by.get(key) ?? []), diag]);
  }
  return [...by].map(([p, list]) => [vscode.Uri.file(p), list]);
}

export async function applyGenerator(env: ApplyEnv, origin: Origin, id: string, s: Sets): Promise<boolean> {
  env.diagnostics.clear();
  let plan: PlanResult | null;
  try {
    plan = await env.server.request<PlanResult | null>('alder/plan', { textDocument: { uri: origin.uri }, position: origin.position, id, sets: s });
  } catch (err) {
    env.ui.error(`alder: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  if (!plan) return false;
  if (plan.error) {
    env.ui.error(plan.error);
    env.diagnostics.set(refusal(env.root, plan.diagnostics ?? []));
    return false;
  }
  const files = plan.files ?? [];
  // unchanged runs again after the delete confirm (the user may type while it is open) and
  // right before the edit is applied
  const unchanged = async () => {
    const stale = await firstStale(files, rel => textOf(join(env.root, rel)));
    if (stale) env.ui.error(staleMessage(stale));
    return !stale;
  };
  if (!(await unchanged())) return false;
  const removed = removedPaths(files);
  if (removed.length > 0 && (!(await env.ui.confirm(deletePrompt(removed), 'Delete')) || !(await unchanged()))) return false;

  const edit = new vscode.WorkspaceEdit();
  // versions: each replaced document's version when its range was taken
  const versions: { path: string; doc: vscode.TextDocument; version: number }[] = [];
  for (const f of files) {
    const uri = vscode.Uri.file(join(env.root, f.path));
    if (f.after === null) {
      edit.deleteFile(uri, { ignoreIfNotExists: true });
    } else if (f.before === null) {
      edit.createFile(uri, { ignoreIfExists: false });
      edit.insert(uri, new vscode.Position(0, 0), f.after);
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      versions.push({ path: f.path, doc, version: doc.version });
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), f.after);
    }
  }
  // building the edit awaited openTextDocument and replace took each document's range then:
  // check once more right before applying, so nothing typed meanwhile is overwritten
  if (!(await unchanged())) return false;
  // unchanged awaited (a created file reads the disk): after the last await, check synchronously
  // that no replaced document moved past the version its range was taken at
  const moved = versions.find(v => v.doc.version !== v.version);
  if (moved) {
    env.ui.error(staleMessage(moved.path));
    return false;
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    env.ui.error(`alder: ${id} could not be applied; nothing applied`);
    return false;
  }
  await removeEmptyDirs(env.root, removed);

  const active = vscode.window.activeTextEditor?.document.uri;
  const activeRel = active?.scheme === 'file' ? relative(env.root, active.fsPath).split(sep).join('/') : undefined;
  const land = landing(plan, activeRel);
  if (land) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(join(env.root, land.kind === 'hole' ? land.file : land.path)));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (land.kind === 'hole') {
      const p = new vscode.Position(land.line, land.col);
      editor.selection = new vscode.Selection(p, p);
      editor.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }
  env.ui.info(appliedMessage(id, plan));
  return true;
}
