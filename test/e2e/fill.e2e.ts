import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { at, open, revert, until } from './helpers';

describe('Fill with AI', () => {
  it('the hole action runs the configured fill command and applies the edit with its import', async () => {
    const { document: doc } = await open('fill/app/App.alder');
    try {
      const p = at(doc, '?out', 0, 1);
      const action = await until(async () => {
        const acts = await vscode.commands.executeCommand<vscode.CodeAction[]>(
          'vscode.executeCodeActionProvider', doc.uri, new vscode.Range(p, p));
        return acts?.find(a => a.title.startsWith('Fill ?out with AI'));
      }, 'the fill action');
      assert.ok(action.command, 'the fill action carries a command');
      await vscode.commands.executeCommand(action.command.command, ...(action.command.arguments ?? []));
      await until(() => doc.getText().includes('Helpers.goLogin') && doc.getText().includes('import Helpers\n'), 'the filled hole', 30_000);
      assert.ok(!doc.getText().includes('?out'));
    } finally {
      await revert(doc);
    }
  });
});
