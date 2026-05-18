import * as vscode from 'vscode';
import { CsvEditorProvider } from './csvEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CsvEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(CsvEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    })
  );

  const post = (action: string, extra?: Record<string, unknown>): void => {
    provider.postToActive('command', { action, ...extra });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('csvStudio.openFile', async (uri?: vscode.Uri) => {
      const target =
        uri ??
        vscode.window.activeTextEditor?.document.uri ??
        (
          await vscode.window.showOpenDialog({
            filters: { CSV: ['csv', 'tsv'] },
            canSelectMany: false,
          })
        )?.[0];
      if (!target) {
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', target, CsvEditorProvider.viewType);
    }),
    vscode.commands.registerCommand('csvStudio.reload', () => post('reload')),
    vscode.commands.registerCommand('csvStudio.exportCsv', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc) {
        await doc.save();
        void vscode.window.showInformationMessage('CSV saved.');
      } else {
        post('exportCsv');
      }
    }),
    vscode.commands.registerCommand('csvStudio.exportJson', () => post('exportJson')),
    vscode.commands.registerCommand('csvStudio.exportTsv', () => post('exportTsv')),
    vscode.commands.registerCommand('csvStudio.addRow', () => post('addRow')),
    vscode.commands.registerCommand('csvStudio.addColumn', () => post('addColumn')),
    vscode.commands.registerCommand('csvStudio.deleteRow', () => post('deleteRow')),
    vscode.commands.registerCommand('csvStudio.deleteColumn', () => post('deleteColumn')),
    vscode.commands.registerCommand('csvStudio.sortAsc', () => post('sortAsc')),
    vscode.commands.registerCommand('csvStudio.sortDesc', () => post('sortDesc')),
    vscode.commands.registerCommand('csvStudio.toggleFilter', () => post('toggleFilter')),
    vscode.commands.registerCommand('csvStudio.undo', () => provider.postToActive('undo')),
    vscode.commands.registerCommand('csvStudio.redo', () => provider.postToActive('redo'))
  );
}

export function deactivate(): void {}
