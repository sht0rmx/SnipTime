import * as fs from 'fs';
import * as vscode from 'vscode';
import { DashboardProvider } from './core/dashboard';
import { TrackerService } from './core/tracker';
import { SQLiteManager } from './db/manager';

let db: SQLiteManager | undefined;
let tracker: TrackerService | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const storagePath = context.globalStorageUri.fsPath;
	if (!fs.existsSync(storagePath)) {
		fs.mkdirSync(storagePath, { recursive: true });
	}

	db = new SQLiteManager(storagePath);
	tracker = new TrackerService(db, () => scheduleStatsRefresh());
	statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusItem.name = 'SnipTime';
	statusItem.command = 'sniptime.showDashboard';
	statusItem.text = '$(clock) 0m';
	statusItem.tooltip = 'SnipTime coding time today';
	statusItem.show();

	context.subscriptions.push(
		tracker,
		statusItem,
		vscode.commands.registerCommand('sniptime.showDashboard', () => {
			if (db) {
				DashboardProvider.show(context.extensionUri, db);
			}
		}),
	);

	scheduleStatsRefresh(0);
}

export async function deactivate(): Promise<void> {
	if (refreshTimer) {
		clearTimeout(refreshTimer);
		refreshTimer = undefined;
	}

	await tracker?.flush();
	tracker?.dispose();
	statusItem?.dispose();
	await db?.close();
}

function scheduleStatsRefresh(delayMs = 750): void {
	if (refreshTimer) {
		return;
	}

	refreshTimer = setTimeout(() => {
		refreshTimer = undefined;
		void refreshStats();
	}, delayMs);
}

async function refreshStats(): Promise<void> {
	if (!db) {
		return;
	}

	const stats = await db.getMiniPanelStats();
	if (statusItem) {
		statusItem.text = `$(clock) ${formatDuration(stats.today.totalMs)}`;
		statusItem.tooltip = `SnipTime: ${formatDuration(stats.today.totalMs)} today, ${formatDuration(stats.lifetimeMs)} total`;
	}

	await Promise.all([
		DashboardProvider.refreshAll(),
	]);
}

function formatDuration(ms: number): string {
	if (ms <= 0) {
		return '0s';
	}

	const totalSeconds = Math.floor(ms / 1000);
	const totalMinutes = Math.floor(totalSeconds / 60);

	if (totalMinutes < 1) {
		return `${totalSeconds}s`;
	}

	if (totalMinutes < 60) {
		return `${totalMinutes}m`;
	}

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}
