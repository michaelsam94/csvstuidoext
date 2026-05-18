import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  delimiterLabel,
  gridToObjects,
  parseCsv,
  type DelimiterSetting,
  type ParsedCsv,
} from './csvParser';

export interface WebviewToExtensionMessage {
  type: string;
  csv?: string;
  message?: string;
  headers?: string[];
  rows?: string[][];
  hasHeader?: boolean;
}

interface PanelState {
  suppressReload: boolean;
  webviewPanel: vscode.WebviewPanel;
}

export class CsvEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'csvStudio.csvEditor';

  private readonly panels = new Map<string, PanelState>();
  private activeKey: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public postToActive(type: string, data?: Record<string, unknown>): void {
    const key = this.activeKey;
    if (!key) {
      return;
    }
    const state = this.panels.get(key);
    if (state) {
      state.webviewPanel.webview.postMessage({ type, ...data });
    }
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const key = document.uri.toString();
    const state: PanelState = { suppressReload: false, webviewPanel };
    this.panels.set(key, state);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };

    webviewPanel.webview.html = this.getWebviewHtml(webviewPanel.webview);

    const postInit = (): void => {
      webviewPanel.webview.postMessage({ type: 'init', data: this.buildInitPayload(document) });
    };

    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case 'ready':
          postInit();
          break;
        case 'documentChanged':
          if (typeof message.csv === 'string') {
            await this.applyDocumentText(document, message.csv, state);
          }
          break;
        case 'exportJson': {
          const headers = message.headers ?? this.parseDocument(document).headers;
          const rows = message.rows ?? this.parseDocument(document).rows;
          const json = JSON.stringify(gridToObjects(headers, rows), null, 2);
          const doc = await vscode.workspace.openTextDocument({ content: json, language: 'json' });
          await vscode.window.showTextDocument(doc, { preview: false });
          break;
        }
        case 'exportTsvRequest': {
          const { serializeCsv } = await import('./csvParser');
          const { headers, rows, hasHeader } = message;
          if (!headers || !rows) {
            break;
          }
          const tsv = serializeCsv(headers, rows, {
            delimiter: '\t',
            hasHeader: hasHeader ?? true,
          });
          const base = path.basename(document.uri.fsPath, path.extname(document.uri.fsPath));
          const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(
              path.join(path.dirname(document.uri.fsPath), `${base}-export.tsv`)
            ),
            filters: { TSV: ['tsv'] },
          });
          if (target) {
            await vscode.workspace.fs.writeFile(target, Buffer.from(tsv, 'utf8'));
            await vscode.window.showTextDocument(target);
          }
          break;
        }
        case 'showError':
          if (message.message) {
            void vscode.window.showErrorMessage(message.message);
          }
          break;
        default:
          break;
      }
    });

    webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) {
        this.activeKey = key;
      }
    });
    if (webviewPanel.active) {
      this.activeKey = key;
    }

    webviewPanel.onDidDispose(() => {
      this.panels.delete(key);
      if (this.activeKey === key) {
        this.activeKey = undefined;
      }
    });

    const docChangeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString() || state.suppressReload) {
        return;
      }
      const parsed = this.parseDocument(document);
      webviewPanel.webview.postMessage({
        type: 'reload',
        data: {
          headers: parsed.headers,
          rows: parsed.rows,
          delimiter: parsed.delimiter,
          hasHeader: parsed.hasHeader,
        },
      });
    });

    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('csvStudio')) {
        postInit();
      }
    });

    webviewPanel.onDidDispose(() => {
      docChangeSub.dispose();
      configSub.dispose();
    });
  }

  public parseDocument(
    document: vscode.TextDocument
  ): ParsedCsv & { warnings: { line: number; message: string }[] } {
    const text = document.getText();
    if (text.includes('\0')) {
      void vscode.window.showWarningMessage(
        'CSV Studio: file appears to contain binary data. Open as plain text if needed.'
      );
    }
    const cfg = this.getConfig();
    const result = parseCsv(text, {
      delimiter: cfg.delimiter,
      hasHeader: cfg.hasHeader,
      fileName: path.basename(document.uri.fsPath),
    });
    for (const w of result.warnings) {
      void vscode.window.showWarningMessage(`CSV parse warning (line ${w.line}): ${w.message}`);
    }
    return { ...result.data, warnings: result.warnings };
  }

  private buildInitPayload(document: vscode.TextDocument): Record<string, unknown> {
    const parsed = this.parseDocument(document);
    const cfg = this.getConfig();
    return {
      headers: parsed.headers,
      rows: parsed.rows,
      delimiter: parsed.delimiter,
      hasHeader: parsed.hasHeader,
      delimiterLabel: delimiterLabel(parsed.delimiter),
      encoding: cfg.encoding,
      maxRowsBeforeVirtualScroll: cfg.maxRowsBeforeVirtualScroll,
      fileName: path.basename(document.uri.fsPath),
      isDirty: document.isDirty,
    };
  }

  private async applyDocumentText(
    document: vscode.TextDocument,
    csv: string,
    state: PanelState
  ): Promise<void> {
    const normalized = csv.endsWith('\n') ? csv : `${csv}\n`;
    if (document.getText() === normalized || document.getText() === csv) {
      return;
    }
    state.suppressReload = true;
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, this.fullRange(document), normalized);
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        void vscode.window.showErrorMessage('CSV Studio: failed to apply changes.');
      }
    } finally {
      setTimeout(() => {
        state.suppressReload = false;
      }, 150);
    }
  }

  private fullRange(document: vscode.TextDocument): vscode.Range {
    if (document.lineCount === 0) {
      return new vscode.Range(0, 0, 0, 0);
    }
    const lastLine = document.lineAt(document.lineCount - 1);
    return new vscode.Range(0, 0, document.lineCount - 1, lastLine.text.length);
  }

  private getConfig(): {
    delimiter: DelimiterSetting;
    hasHeader: boolean;
    maxRowsBeforeVirtualScroll: number;
    encoding: string;
  } {
    const config = vscode.workspace.getConfiguration('csvStudio');
    return {
      delimiter: config.get<DelimiterSetting>('delimiter', 'auto'),
      hasHeader: config.get<boolean>('hasHeader', true),
      maxRowsBeforeVirtualScroll: config.get<number>('maxRowsBeforeVirtualScroll', 5000),
      encoding: config.get<string>('encoding', 'utf8'),
    };
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'editor.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'editor.css'));
    const htmlPath = path.join(this.context.extensionPath, 'media', 'editor.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource}`,
    ].join('; ');
    html = html
      .replace('{{scriptUri}}', scriptUri.toString())
      .replace('{{styleUri}}', styleUri.toString())
      .replace(
        '<head>',
        `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}" />`
      );
    return html;
  }
}
