import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', timeout: 60_000, color: true });
  for (const f of readdirSync(__dirname).filter(f => f.endsWith('.e2e.js')).sort()) mocha.addFile(join(__dirname, f));
  return new Promise((res, rej) => mocha.run(failures => (failures ? rej(new Error(`${failures} failed`)) : res())));
}
