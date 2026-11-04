// The wire types of alder/generators, alder/preview and alder/plan (alder internal/lsp/generators.go,
// internal/generate/here.go and holes.go). Go sends a nil slice as null, so lists may be null.

export type Sets = Record<string, string>;

// Generator is one item of alder/generators: here is true when it applies at the cursor, and
// sets are the values the cursor fills in.
export interface Generator { id: string; summary: string; here: boolean; why?: string; sets?: Sets }

// FieldState is one field of a preview's form. source is "here", "you", "default" or "".
export interface FieldState {
  name: string;
  kind: string; // text module page table decl fieldList type route path bool choice
  flag: boolean;
  required: boolean;
  value: string;
  source: string;
  valid: boolean;
  why?: string;
  choices?: string[];
  help: string;
  example?: string;
  agent?: boolean;
}

export interface Hole { module: string; decl: string; arm?: string; name: string; type: string; file: string; line: number; col: number }

export interface PlanDiagnostic { file: string; line: number; col: number; code: string; message: string; severity: string }

export interface PreviewFile { path: string; action: string; added: number; removed: number }

export interface PreviewResult {
  fields?: FieldState[] | null;
  files?: PreviewFile[] | null;
  diff?: string;
  warnings?: string[] | null;
  diagnostics?: PlanDiagnostic[] | null;
  holes?: Hole[] | null;
  ready?: boolean;
  error?: string;
}

// PlanFile is a file a plan changes: before is null for a created file, after null for a removed one.
export interface PlanFile { path: string; action: string; before: string | null; after: string | null }

export interface PlanResult {
  files?: PlanFile[] | null;
  diagnostics?: PlanDiagnostic[] | null;
  holes?: Hole[] | null;
  imports?: string[] | null;
  migration?: string[] | null;
  error?: string;
}

// Preset is what a code action (or a caller) opens the flow with: the generator and its values.
export interface Preset { id: string; sets?: Sets }
