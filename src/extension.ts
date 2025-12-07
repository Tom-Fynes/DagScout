import * as vscode from 'vscode';
import { scanWorkspaceForPipelines, ParsedNode, ParsedEdge } from './parser';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('dagscout.openGraph', async () => {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) {
      vscode.window.showErrorMessage('Open a workspace folder first.');
      return;
    }

    const { nodes, edges, mapping } = await scanWorkspaceForPipelines(root.uri.fsPath);

    if (nodes.length === 0) {
      vscode.window.showInformationMessage('No pipeline tasks found. Supported: Airflow, dbt, GitHub Actions.');
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'dagscoutGraph',
      'DagScout Pipeline Graph',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))],
      }
    );

    panel.webview.html = getWebviewContent(panel.webview, buildMermaid(nodes, edges));

    // Listen for clicks from the webview
    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === 'requestReveal') {
        // find node by label
        const id = Object.keys(mapping).find((k) => k.endsWith(msg.label));
        if (!id) return;
        const entry = mapping[id];
        if (!entry.file) return;

        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(entry.file));
          const editor = await vscode.window.showTextDocument(doc);
          const pos = new vscode.Position(Math.max(0, (entry.line || 1) - 1), 0);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          editor.selection = new vscode.Selection(pos, pos);
        } catch (e) {
          vscode.window.showErrorMessage('Failed to open file: ' + (e as Error).message);
        }
      }
    });
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}

// Build a simple Mermaid flowchart from nodes and edges
function buildMermaid(nodes: ParsedNode[], edges: ParsedEdge[]): string {
  const lines: string[] = ['flowchart TD'];
  nodes.forEach((n) => lines.push(`  ${n.id}["${escapeMermaid(n.label || n.id)}"]`));
  edges.forEach((e) => lines.push(`  ${e.from} --> ${e.to}`));
  return lines.join('\n');
}

function escapeMermaid(s: string) {
  return s.replace(/"/g, '\\"');
}

// Generate webview HTML with embedded Mermaid graph
function getWebviewContent(webview: vscode.Webview, mermaidSrc: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:;">
<title>DagScout Pipeline Graph</title>
</head>
<body>
<div id="graphDiv">Loading graph...</div>
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script>
const vscode = acquireVsCodeApi();
let mermaidCode = ${JSON.stringify(mermaidSrc)};
mermaid.initialize({ startOnLoad: false });

function render() {
  const graphDiv = document.getElementById('graphDiv');
  graphDiv.innerHTML = '<div class="mermaid">' + mermaidCode + '</div>';
  setTimeout(() => { mermaid.init(undefined, graphDiv); attachClicks(); }, 50);
}

function attachClicks() {
  const texts = document.querySelectorAll('g[class^="node"] > title');
  texts.forEach(t => {
    const txt = t.textContent || '';
    const g = t.parentElement;
    if (!g) return;
    g.style.cursor = 'pointer';
    g.onclick = () => { vscode.postMessage({ command: 'requestReveal', label: txt }); };
  });
}

render();
</script>
</body>
</html>`;
}
