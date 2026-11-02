import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { serverEnv, selectorPatterns, commandUri, SERVER_COMMANDS } from '../../src/clientConfig';

test('serverEnv overlays strings on the base and ignores everything else', () => {
  const env = serverEnv({ PATH: '/bin', HOME: '/h' }, { ALDER_FILL_COMMAND: 'echo x', PATH: '/x', N: 3, O: {} });
  assert.equal(env.ALDER_FILL_COMMAND, 'echo x');
  assert.equal(env.PATH, '/x');
  assert.equal(env.HOME, '/h');
  assert.equal(env.N, undefined);
  assert.equal(env.O, undefined);
  assert.deepEqual(serverEnv({ A: '1' }, null), { A: '1' });
});

test('selectorPatterns: one relative pattern per distinct path, the path a base and never a glob', () => {
  assert.deepEqual(selectorPatterns(['/w/link', '/w/blog', '/w/link']), [
    { baseUri: 'file:///w/link', pattern: '**' },
    { baseUri: 'file:///w/blog', pattern: '**' },
  ]);
  const [p] = selectorPatterns(['/w/my app [1]/{x}*?']);
  assert.equal(fileURLToPath(p.baseUri), '/w/my app [1]/{x}*?');
  assert.equal(p.pattern, '**');
});

test('commandUri reads the uri of a fill argument, nothing else', () => {
  assert.equal(commandUri([{ uri: 'file:///w/blog/app/App.alder', hole: 'out' }]), 'file:///w/blog/app/App.alder');
  assert.equal(commandUri(['E0205']), undefined);
  assert.equal(commandUri([]), undefined);
  assert.equal(commandUri([{ uri: 3 }]), undefined);
});

test('the server commands the extension dispatches itself', () => {
  assert.deepEqual(SERVER_COMMANDS, ['alder.explain', 'alder.fill']);
});
