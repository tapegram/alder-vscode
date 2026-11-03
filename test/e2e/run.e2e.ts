import * as assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { open, until, ws } from './helpers';

describe('Alder: Run the App', () => {
  it('opens one terminal per root in the root, and reuses it while it is alive', async () => {
    await open('demo/app/Demo.alder');
    const t = await vscode.commands.executeCommand<vscode.Terminal>('alder.run');
    try {
      assert.ok(t);
      assert.equal(t.name, 'alder run (demo)');
      const cwd = (t.creationOptions as vscode.TerminalOptions).cwd;
      assert.equal(typeof cwd === 'string' ? cwd : cwd?.fsPath, join(ws(), 'demo'));
      assert.equal(await vscode.commands.executeCommand<vscode.Terminal>('alder.run'), t, 'not reused');
    } finally {
      t?.dispose();
    }
    await until(() => !vscode.window.terminals.includes(t), 'the terminal to close');
    const again = await vscode.commands.executeCommand<vscode.Terminal>('alder.run');
    try {
      assert.ok(again && again !== t, 'a closed terminal was reused');
    } finally {
      again?.dispose();
    }
  });
});
