import * as path from 'path';
import * as vscode from 'vscode';
import { SQLiteManager } from '../db/manager';
import { ActivityTags, HeartbeatInput, HeartbeatKind } from '../models/activity';

const minHeartbeatGapMs = 10 * 1000;
const idleTimeoutMs = 5 * 60 * 1000;
const maxIntervalGapMs = 2 * 60 * 1000;

export class TrackerService implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private queue = Promise.resolve();

    private lastHeartbeat: HeartbeatInput | undefined;
    private lastInteractionMs = Date.now();

    constructor(
        private readonly db: SQLiteManager,
        private readonly onDidRecord: () => void,
    ) {
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                this.captureDocument(event.document, 'edit', true);
            }),

            vscode.workspace.onDidSaveTextDocument(document => {
                this.captureDocument(document, 'save', true);
            }),

            vscode.window.onDidChangeTextEditorSelection(event => {
                if (event.selections.every(sel => sel.isEmpty)) { return; }
                this.captureDocument(event.textEditor.document, 'selection', true);
            }),

            vscode.window.onDidChangeActiveTextEditor(() => { }),
            vscode.window.onDidChangeWindowState(() => { }),
        );
    }

    public async flush(): Promise<void> {
        await this.queue;
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    private static isInteractive(kind: HeartbeatKind): boolean {
        return kind === 'edit' || kind === 'selection' || kind === 'save';
    }

    private captureDocument(
        document: vscode.TextDocument,
        kind: HeartbeatKind,
        markInteraction: boolean
    ): void {
        if (document.uri.scheme !== 'file') { return; }

        const now = Date.now();

        if (markInteraction) {
            this.lastInteractionMs = now;
        }

        // idle — разрываем цепочку
        if (now - this.lastInteractionMs > idleTimeoutMs) {
            this.lastHeartbeat = undefined;
            return;
        }

        const heartbeat: HeartbeatInput = {
            ...this.tagsForDocument(document),
            kind,
            timestamp: now,
        };

        if (this.shouldThrottle(heartbeat)) { return; }

        this.recordHeartbeat(heartbeat);
    }

    private recordHeartbeat(heartbeat: HeartbeatInput): void {
        const previous = this.lastHeartbeat;

        if (TrackerService.isInteractive(heartbeat.kind)) {
            this.lastHeartbeat = heartbeat;
        }

        this.queue = this.queue
            .then(async () => {
                if (TrackerService.isInteractive(heartbeat.kind)) {
                    await this.db.saveHeartbeat(heartbeat);
                }

                if (
                    previous &&
                    TrackerService.isInteractive(previous.kind) &&
                    TrackerService.isInteractive(heartbeat.kind) &&
                    this.shouldCountInterval(previous, heartbeat)
                ) {
                    await this.db.saveInterval({
                        project: previous.project,
                        projectPath: previous.projectPath,
                        filePath: previous.filePath,
                        fileName: previous.fileName,
                        language: previous.language,
                        startMs: previous.timestamp,
                        endMs: heartbeat.timestamp,
                    });
                }
            })
            .then(() => {
                this.onDidRecord();
            })
            .catch(error => {
                console.error('SnipTime failed to persist heartbeat', error);
            });
    }

    private shouldThrottle(heartbeat: HeartbeatInput): boolean {
        if (!this.lastHeartbeat) { return false; }

        if (!TrackerService.isInteractive(heartbeat.kind)) { return true; }

        return (
            heartbeat.timestamp - this.lastHeartbeat.timestamp < minHeartbeatGapMs &&
            TrackerService.sameTags(this.lastHeartbeat, heartbeat)
        );
    }

    private shouldCountInterval(previous: HeartbeatInput, current: HeartbeatInput): boolean {
        const gapMs = current.timestamp - previous.timestamp;

        return (
            gapMs > 0 &&
            gapMs <= maxIntervalGapMs &&
            TrackerService.sameTags(previous, current)
        );
    }

    private tagsForDocument(document: vscode.TextDocument): ActivityTags {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const projectPath = workspaceFolder?.uri.fsPath ?? path.dirname(document.fileName);

        return {
            project: workspaceFolder?.name ?? (path.basename(projectPath) || 'No workspace'),
            projectPath,
            filePath: document.fileName,
            fileName: path.basename(document.fileName),
            language: document.languageId || 'plaintext',
        };
    }

    private static sameTags(left: ActivityTags, right: ActivityTags): boolean {
        return (
            left.project === right.project &&
            left.projectPath === right.projectPath &&
            left.filePath === right.filePath &&
            left.fileName === right.fileName &&
            left.language === right.language
        );
    }
}