import * as vscode from 'vscode';
import type { Clients } from './client';
import { serverEnv } from './clientConfig';
import type { VirtualDocs } from './virtualDocs';

// Deps is what the commands share.
export interface Deps {
  clients: Clients;
  docs: VirtualDocs;
  output: vscode.LogOutputChannel;
}

// cliEnv is the environment of a CLI run: the server's (VS Code's own overlaid by alder.serverEnv).
export function cliEnv(): NodeJS.ProcessEnv {
  return serverEnv(process.env, vscode.workspace.getConfiguration('alder').get('serverEnv'));
}

// settingEnv is only the alder.serverEnv overlay (a terminal adds it to its own environment).
export function settingEnv(): Record<string, string> {
  return serverEnv({}, vscode.workspace.getConfiguration('alder').get('serverEnv')) as Record<string, string>;
}
