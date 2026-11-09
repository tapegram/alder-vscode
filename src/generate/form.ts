import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FieldState, Sets } from './types';

// form: the generator's fields as the form shows them (one row per field: its value, and a note
// on where the value came from or what is wrong) and what to send back. Port of alder.nvim's
// form.lua. Pure (moduleDirs reads the app's folders).

export const NOTES: Record<string, string> = { here: 'from the cursor', default: 'default' };
export const MODULE_EXAMPLE = 'Sites.Clarity.Index';

// Typed are the values the user entered, by field name; '' is a field they cleared.
export type Typed = Record<string, string>;

// FieldRow is a field as the form lists it: value is the text (`[x]`/`[ ]` for a switch);
// error marks a note that is the server's why.
export interface FieldRow { name: string; value: string; note?: string; error: boolean }

export type EditorKind = 'bool' | 'choice' | 'module' | 'text';

const isBool = (f: FieldState) => f.kind === 'bool';
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// visible are the fields the form shows: all but the agent-oriented flags (alder#45). A hidden
// field the cursor prefilled still reaches the server through the preset.
export function visible(fields: FieldState[] | null | undefined): FieldState[] {
  return (fields ?? []).filter(f => !f.agent);
}

// current is the text a field shows: what was typed, else the server's value.
export function current(f: FieldState, typed: Typed): string {
  return has(typed, f.name) ? typed[f.name] : (f.value ?? '');
}

function joined(...parts: (string | undefined)[]): string | undefined {
  const p = parts.filter((x): x is string => !!x);
  return p.length > 0 ? p.join(' · ') : undefined;
}

// rows are form.lua's lines and notes: the server's why (not "required") as an error; for a field
// you cleared, the value the server uses instead (`default: Archive`); `required` while empty;
// else where the value came from and the field's help.
export function rows(fields: FieldState[], typed: Typed = {}): FieldRow[] {
  return fields.map(f => {
    const v = current(f, typed);
    const from = f.source ? NOTES[f.source] : undefined;
    let note: string | undefined;
    let error = false;
    if (f.why && f.why !== 'required') {
      note = f.why;
      error = true;
    } else if (!isBool(f) && v === '' && f.value && from) {
      note = `${from}: ${f.value}`;
    } else if (!isBool(f) && v === '' && f.required) {
      note = 'required';
    } else {
      note = joined(from, f.help);
    }
    return { name: f.name, value: isBool(f) ? (v === 'true' ? '[x]' : '[ ]') : v, note, error };
  });
}

// sets is what the server gets: the preset with the typed text over it; an empty text drops the
// key, so the server falls back to the cursor. A preview never echoes the server's own values
// back (shownSets does, for a plan).
export function sets(preset: Sets | undefined, typed: Typed | undefined): Sets {
  const out: Sets = {};
  for (const [k, v] of Object.entries(preset ?? {})) if (v !== '') out[k] = v;
  for (const [k, v] of Object.entries(typed ?? {})) {
    if (v !== '') out[k] = v;
    else delete out[k];
  }
  return out;
}

// shownSets is what a plan or an apply sends: every value the form shows (the server's own, from
// the visible fields), with sets over them. A value the user saw and accepted counts as chosen,
// so a page the form guessed to open with plans (alder#211); previews send only sets, so the
// server goes on re-deciding its values while the user edits.
export function shownSets(fields: FieldState[] | undefined, preset: Sets | undefined, typed: Typed | undefined): Sets {
  const out: Sets = {};
  for (const f of visible(fields)) if (f.value) out[f.name] = f.value;
  for (const [k, v] of Object.entries(typed ?? {})) if (v === '') delete out[k];
  return { ...out, ...sets(preset, typed) };
}

// fuzzy is the strings of list holding query's characters in order (ignoring case), best first:
// the earliest first match, then the fewest gaps, then list order.
export function fuzzy(list: string[], query: string): string[] {
  const q = query.toLowerCase();
  const scored: { s: string; score: number; i: number }[] = [];
  list.forEach((s, i) => {
    const t = s.toLowerCase();
    let at = -1;
    let first = -1;
    let gaps = 0;
    for (const ch of q) {
      const k = t.indexOf(ch, at + 1);
      if (k < 0) return;
      if (first < 0) first = k;
      else gaps += k - at - 1;
      at = k;
    }
    scored.push({ s, score: first + gaps, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map(x => x.s);
}

// options are a choice field's choices matching the typed text (all for none).
export function options(f: FieldState, typed?: string): string[] {
  const all = f.choices ?? [];
  if (!typed) return [...all];
  return fuzzy(all, typed);
}

// firstInvalid is the index of the first field the server marked invalid.
export function firstInvalid(fields: FieldState[] | undefined): number | undefined {
  const i = (fields ?? []).findIndex(f => !f.valid);
  return i < 0 ? undefined : i;
}

// firstToFill is the field a new form opens first: the first invalid one, else the first
// required one still at the server's starting value and untouched (alder#45 starts required
// fields at an example, so nothing is generated unseen).
export function firstToFill(fields: FieldState[] | undefined, typed: Typed = {}): number | undefined {
  const bad = firstInvalid(fields);
  if (bad !== undefined) return bad;
  const i = (fields ?? []).findIndex(f => f.required && f.source === 'default' && !has(typed, f.name));
  return i < 0 ? undefined : i;
}

// exampleLine is a field's example as a hint, undefined when it has none.
export function exampleLine(f: FieldState | undefined): string | undefined {
  return f?.example ? `e.g. ${f.example}` : undefined;
}

// editorKind is the editor a field opens: a switch, a list of choices, a module name, or text.
export function editorKind(f: FieldState): EditorKind {
  if (isBool(f)) return 'bool';
  if (f.choices && f.choices.length > 0) return 'choice';
  if (f.kind === 'module') return 'module';
  return 'text';
}

// moduleText is a module field's current text; the server's placeholder (`<Module>`) is empty.
export function moduleText(f: FieldState, typed: Typed): string {
  const v = current(f, typed);
  return v.startsWith('<') ? '' : v;
}

// moduleDirs are the capitalised folders under root/app as dotted prefixes (`Sites.`,
// `Sites.Clarity.`), shallow first, then alphabetical.
export function moduleDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && /^[A-Z]/.test(e.name)) {
        out.push(`${prefix}${e.name}.`);
        walk(join(dir, e.name), `${prefix}${e.name}.`);
      }
    }
  };
  walk(join(root, 'app'), '');
  const depth = (s: string) => s.split('.').length;
  return out.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// modulePath is the file a module name is written to, relative to the app root.
export function modulePath(name: string): string {
  return `app/${name.replaceAll('.', '/')}.alder`;
}

// moduleHelp says where the name lands: the typed name (a trailing dot gets `Index`), else the example.
export function moduleHelp(text: string): string {
  let name = text || MODULE_EXAMPLE;
  if (name.endsWith('.')) name += 'Index';
  return `${name} → ${modulePath(name)}`;
}

// moduleSuggest are the folder prefixes that complete text: those starting with it (fuzzy when
// none do and text does not end in a dot), never the text itself.
export function moduleSuggest(dirs: string[], text: string): string[] {
  if (!text) return [...dirs];
  const out = dirs.filter(d => d !== text && d.startsWith(text));
  if (out.length === 0 && !text.endsWith('.')) return fuzzy(dirs, text);
  return out;
}
