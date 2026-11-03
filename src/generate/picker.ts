import type { Generator } from './types';

// PickerRow is a picker entry: a heading (`here` above the first item that applies at the
// cursor, `all` above the first other) or a generator, in the server's order (here first).
// Port of picker.lua's grouped lines; the QuickPick does the filtering.
export type PickerRow = { heading: 'here' | 'all' } | { item: Generator };

export function pickerRows(items: Generator[]): PickerRow[] {
  const out: PickerRow[] = [];
  let seenHere = false;
  let seenRest = false;
  for (const item of items) {
    if (item.here && !seenHere) {
      out.push({ heading: 'here' });
      seenHere = true;
    } else if (!item.here && !seenRest) {
      out.push({ heading: 'all' });
      seenRest = true;
    }
    out.push({ item });
  }
  return out;
}
