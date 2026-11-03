import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', timeout: 60_000, color: true });
  // ALDER_E2E_ONLY=<prefix> runs only the files whose name starts with it (while iterating)
  const only = process.env.ALDER_E2E_ONLY;
  for (const f of readdirSync(__dirname).filter(f => f.endsWith('.e2e.js') && (!only || f.startsWith(only))).sort()) mocha.addFile(join(__dirname, f));
  return new Promise((res, rej) => mocha.run(failures => (failures ? rej(new Error(`${failures} failed`)) : res())));
}
