import * as path from 'path';
import * as vscode from 'vscode';
import { SQLiteManager } from '../db/manager';
import { ActivityTags, HeartbeatInput, HeartbeatKind } from '../models/activity';

const heartbeatIntervalMs = 30 * 1000;
const minHeartbeatGapMs = 10 * 1000;
const idleTimeoutMs = 5 * 60 * 1000;
const maxIntervalGapMs = 2 * 60 * 1000;

export class TrackerService implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly heartbeatTimer: ReturnType<typeof setInterval>;
    private queue = Promise.resolve();
    private lastHeartbeat: HeartbeatInput | undefined;
    private lastInteractionMs = Date.now();

    constructor(
        private readonly db: SQLiteManager,
        private readonly onDidRecord: () => void,
    ) {
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => this.captureDocument(event.document, 'edit', true)),
            vscode.workspace.onDidSaveTextDocument(document => this.captureDocument(document, 'save', true)),
            vscode.window.onDidChangeTextEditorSelection(event => this.captureDocument(event.textEditor.document, 'selection', true)),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) {
                    this.captureDocument(editor.document, 'focus', false);
                }
            }),
            vscode.window.onDidChangeWindowState(state => {
                if (state.focused) {
                    this.captureActiveEditor('focus', false);
                }
            }),
        );

        this.heartbeatTimer = setInterval(() => this.captureHeartbeatTick(), heartbeatIntervalMs);
        this.captureActiveEditor('focus', false);
    }

    public async flush(): Promise<void> {
        await this.queue;
    }

    public dispose(): void {
        clearInterval(this.heartbeatTimer);
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    private captureActiveEditor(kind: HeartbeatKind, markInteraction: boolean): void {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            this.captureDocument(editor.document, kind, markInteraction);
        }
    }

    private captureHeartbeatTick(): void {
        if (!vscode.window.state.focused || Date.now() - this.lastInteractionMs > idleTimeoutMs) {
            return;
        }

        this.captureActiveEditor('tick', false);
    }

    private captureDocument(document: vscode.TextDocument, kind: HeartbeatKind, markInteraction: boolean): void {
        if (document.uri.scheme !== 'file') {
            return;
        }

        const now = Date.now();
        if (markInteraction) {
            this.lastInteractionMs = now;
        }

        const heartbeat: HeartbeatInput = {
            ...this.tagsForDocument(document),
            kind,
            timestamp: now,
        };

        if (this.shouldThrottle(heartbeat)) {
            return;
        }

        this.recordHeartbeat(heartbeat);
    }

    private recordHeartbeat(heartbeat: HeartbeatInput): void {
        const previous = this.lastHeartbeat;
        this.lastHeartbeat = heartbeat;

        this.queue = this.queue
            .then(async () => {
                await this.db.saveHeartbeat(heartbeat);

                if (previous && this.shouldCountInterval(previous, heartbeat)) {
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
        if (!this.lastHeartbeat || heartbeat.kind === 'save' || heartbeat.kind === 'focus') {
            return false;
        }

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