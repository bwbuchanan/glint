import { createRequire } from 'node:module';
import * as path from 'node:path';
import {
  ExtensionContext,
  WorkspaceFolder,
  FileSystemWatcher,
  TextEditor,
  Range,
  Uri,
  window,
  commands,
  workspace,
} from 'vscode';
import { Disposable, LanguageClient, ServerOptions } from 'vscode-languageclient/node.js';
import type { Request, GetIRRequest } from '@glint/core/lsp-messages';

///////////////////////////////////////////////////////////////////////////////
// Setup and extension lifecycle

const outputChannel = window.createOutputChannel('Glint Language Server');
const clients = new Map<string, LanguageClient>();
const extensions = ['.js', '.ts', '.gjs', '.gts', '.hbs'];
const filePattern = `**/*{${extensions.join(',')}}`;

export function activate(context: ExtensionContext): void {
  let fileWatcher = workspace.createFileSystemWatcher(filePattern);

  context.subscriptions.push(fileWatcher, createConfigWatcher());
  context.subscriptions.push(
    commands.registerCommand('glint.restart-language-server', restartClients),
    commands.registerTextEditorCommand('glint.show-debug-ir', showDebugIR)
  );

  workspace.workspaceFolders?.forEach((folder) => addWorkspaceFolder(folder, fileWatcher));
  workspace.onDidChangeWorkspaceFolders(({ added, removed }) => {
    added.forEach((folder) => addWorkspaceFolder(folder, fileWatcher));
    removed.forEach((folder) => removeWorkspaceFolder(folder));
  });

  workspace.onDidChangeConfiguration((changeEvent) => {
    if (changeEvent.affectsConfiguration('glint.libraryPath')) {
      reloadAllWorkspaces(fileWatcher);
    }
  });
}

export async function deactivate(): Promise<void> {
  await Promise.all([...clients.values()].map((client) => client.stop()));
}

///////////////////////////////////////////////////////////////////////////////
// Commands

async function restartClients(): Promise<void> {
  outputChannel.appendLine(`Restarting Glint language server...`);
  await Promise.all([...clients.values()].map((client) => client.restart()));
}

async function showDebugIR(editor: TextEditor): Promise<void> {
  let workspaceFolder = workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) {
    return;
  }

  let sourceURI = editor.document.uri;
  let client = clients.get(workspaceFolder.uri.fsPath);
  let request = requestKey<typeof GetIRRequest>('glint/getIR');
  let response = await client?.sendRequest(request, { uri: sourceURI.toString() });

  // Just don't support this command for older @glint/core versions
  if (!response || typeof response === 'string') return;

  let { contents, uri } = response;
  let targetEditor = await window.showTextDocument(Uri.parse(uri));
  let { document } = targetEditor;

  let start = document.positionAt(0);
  let end = document.positionAt(document.getText().length);

  await targetEditor.edit((edit) => {
    edit.replace(new Range(start, end), contents);
  });
}

///////////////////////////////////////////////////////////////////////////////
// Workspace folder management

async function reloadAllWorkspaces(fileWatcher: FileSystemWatcher): Promise<void> {
  let folders = workspace.workspaceFolders ?? [];

  await Promise.all(
    folders.map(async (folder) => {
      await removeWorkspaceFolder(folder);
      await addWorkspaceFolder(folder, fileWatcher);
    })
  );
}

async function addWorkspaceFolder(
  workspaceFolder: WorkspaceFolder,
  watcher: FileSystemWatcher
): Promise<void> {
  let folderPath = workspaceFolder.uri.fsPath;
  if (clients.has(folderPath)) return;

  let serverPath = findLanguageServer(folderPath);
  if (!serverPath) return;

  let serverOptions: ServerOptions = { module: serverPath };
  let client = new LanguageClient('glint', 'Glint', serverOptions, {
    workspaceFolder,
    outputChannel,
    documentSelector: [{ scheme: 'file', pattern: `${folderPath}/${filePattern}` }],
    synchronize: { fileEvents: watcher },
  });

  clients.set(folderPath, client);

  await client.start();
}

async function removeWorkspaceFolder(workspaceFolder: WorkspaceFolder): Promise<void> {
  let folderPath = workspaceFolder.uri.fsPath;
  let client = clients.get(folderPath);
  if (client) {
    clients.delete(folderPath);
    await client.stop();
  }
}

///////////////////////////////////////////////////////////////////////////////
// Utilities

function findLanguageServer(workspaceDir: string): string | null {
  let userLibraryPath = workspace.getConfiguration().get('glint.libraryPath', '.');
  let resolutionDir = path.resolve(workspaceDir, userLibraryPath);
  let require = createRequire(path.join(resolutionDir, 'package.json'));
  try {
    return require.resolve('@glint/core/bin/glint-language-server');
  } catch {
    // Many workspaces with `tsconfig` files won't be Glint projects, so it's totally fine for us to
    // just bail out if we don't see `@glint/core`. If someone IS expecting Glint to run for this
    // project, though, we leave a message in our channel explaining why we didn't launch.
    outputChannel.appendLine(
      `Unable to resolve @glint/core from ${resolutionDir} — not launching Glint for this directory.`
    );

    return null;
  }
}

// Automatically restart running servers when config files in the workspace change
function createConfigWatcher(): Disposable {
  let configWatcher = workspace.createFileSystemWatcher('**/{ts,js}config*.json');

  configWatcher.onDidCreate(restartClients);
  configWatcher.onDidChange(restartClients);
  configWatcher.onDidDelete(restartClients);

  return configWatcher;
}

// This allows us to just use a bare string key for performing a request while maintaining
// type information for the request _without_ forcing us to import runtime code from
// `@glint/core` into the extension.
function requestKey<R extends Request<string, unknown>>(name: R['name']): R['type'] {
  return name as unknown as R['type'];
}
