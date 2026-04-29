import * as fs from 'fs';
import * as vscode from 'vscode';
import { SQLiteManager } from '../db/manager';
import { TagKind } from '../models/activity';

interface DashboardState {
    db: SQLiteManager;
    selectedDateMs: number;
}

export class DashboardProvider {
    private static readonly panels = new Map<vscode.WebviewPanel, DashboardState>();

    public static show(extensionUri: vscode.Uri, db: SQLiteManager): void {
        const panel = vscode.window.createWebviewPanel(
            'sniptime.dashboard',
            'SnipTime Dashboard',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true,
            },
        );

        const state: DashboardState = {
            db,
            selectedDateMs: Date.now(),
        };
        DashboardProvider.panels.set(panel, state);

        panel.iconPath = {
            light: vscode.Uri.joinPath(extensionUri, 'resources', 'l.dashboard.svg'),
            dark: vscode.Uri.joinPath(extensionUri, 'resources', 'd.dashboard.svg'),
        };
        panel.webview.html = DashboardProvider.html(extensionUri, panel.webview);
        panel.webview.onDidReceiveMessage(async message => {
            if (message?.command === 'fetch') {
                if (typeof message.selectedDateMs === 'number') {
                    state.selectedDateMs = message.selectedDateMs;
                }

                void DashboardProvider.postStats(panel, state);
            }

            if (message?.command === 'renameTag') {
                const kind = message.kind as TagKind;
                const key = typeof message.key === 'string' ? message.key : '';
                const currentLabel = typeof message.label === 'string' ? message.label : key;

                if ((kind === 'project' || kind === 'language') && key) {
                    const label = await vscode.window.showInputBox({
                        title: kind === 'project' ? 'Rename project' : 'Rename language',
                        prompt: 'This changes the display name in SnipTime statistics.',
                        value: currentLabel,
                    });

                    if (label !== undefined) {
                        await state.db.renameTag(kind, key, label);
                        await DashboardProvider.postStats(panel, state);
                        void vscode.commands.executeCommand('sniptime.refreshStats');
                    }
                }
            }
        });
        panel.onDidDispose(() => DashboardProvider.panels.delete(panel));

        void DashboardProvider.postStats(panel, state);
    }

    public static async refreshAll(): Promise<void> {
        await Promise.all(Array.from(DashboardProvider.panels.entries()).map(([panel, state]) => {
            return DashboardProvider.postStats(panel, state);
        }));
    }

    private static async postStats(panel: vscode.WebviewPanel, state: DashboardState): Promise<void> {
        const data = await state.db.getDashboardStats(state.selectedDateMs);
        await panel.webview.postMessage({
            command: 'stats',
            data,
        });
    }

    private static html(extensionUri: vscode.Uri, webview: vscode.Webview): string {
        const nonce = nonceValue();
        const htmlUri = vscode.Uri.joinPath(extensionUri, 'webviews', 'dashboard.html');
        const csp = [
            "default-src 'none'",
            `img-src ${webview.cspSource} https: data:`,
            `font-src ${webview.cspSource} https://cdn.jsdelivr.net`,
            `style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.tailwindcss.com`,
            `script-src 'nonce-${nonce}' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com`,
        ].join('; ');

        return fs.readFileSync(htmlUri.fsPath, 'utf8')
            .replaceAll('{{csp}}', csp)
            .replaceAll('{{nonce}}', nonce);
    }
}

function nonceValue(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';

    for (let index = 0; index < 32; index += 1) {
        value += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return value;
}
