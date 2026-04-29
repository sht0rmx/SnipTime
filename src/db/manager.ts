import * as path from 'path';
import * as sqlite3 from 'sqlite3';
import {
    ActivityTags,
    BreakdownItem,
    DashboardStats,
    DayBucket,
    DayStats,
    HeartbeatInput,
    IntervalInput,
    IntervalRecord,
    MiniPanelStats,
    MonthBucket,
    TagKind,
    TimelineItem,
} from '../models/activity';

interface IntervalRow {
    id: number;
    start_ms: number;
    end_ms: number;
    duration_ms: number;
    project: string;
    project_path: string;
    file_path: string;
    file_name: string;
    language: string;
}

interface TotalRow {
    totalMs: number | null;
}

interface MapValue {
    key: string;
    kind: TagKind;
    label: string;
    secondary?: string;
    project?: string;
    language?: string;
    filePath?: string;
    durationMs: number;
    color: string;
    icon: string;
}

interface TagMetadata {
    kind: TagKind;
    key: string;
    label: string;
    color: string;
    icon: string;
}

interface MetadataRow {
    kind: TagKind;
    key: string;
    label: string;
    color: string;
    icon: string;
}

const mergeGapMs = 1000;
const projectIcons = ['ri-folder-3-line', 'ri-folder-chart-line', 'ri-stack-line', 'ri-box-3-line', 'ri-terminal-box-line', 'ri-git-branch-line'];
const languageIcons = ['ri-code-s-slash-line', 'ri-braces-line', 'ri-terminal-line', 'ri-code-box-line', 'ri-hashtag', 'ri-file-code-line'];
const fileIcons = ['ri-file-code-line', 'ri-file-text-line', 'ri-file-list-3-line', 'ri-file-settings-line', 'ri-file-paper-2-line'];
const languageIconMap: Record<string, string> = {
    bat: 'ri-terminal-line',
    c: 'ri-code-s-slash-line',
    clojure: 'ri-braces-line',
    coffeescript: 'ri-cup-line',
    cpp: 'ri-code-s-slash-line',
    csharp: 'ri-hashtag',
    css: 'ri-css3-line',
    dart: 'ri-flutter-line',
    dockerfile: 'ri-instance-line',
    fsharp: 'ri-hashtag',
    go: 'ri-code-s-slash-line',
    graphql: 'ri-node-tree',
    handlebars: 'ri-braces-line',
    html: 'ri-html5-line',
    java: 'ri-cup-line',
    javascript: 'ri-javascript-line',
    javascriptreact: 'ri-reactjs-line',
    json: 'ri-braces-line',
    jsonc: 'ri-braces-line',
    kotlin: 'ri-code-s-slash-line',
    less: 'ri-css3-line',
    lua: 'ri-moon-line',
    makefile: 'ri-tools-line',
    markdown: 'ri-markdown-line',
    'objective-c': 'ri-code-s-slash-line',
    'objective-cpp': 'ri-code-s-slash-line',
    perl: 'ri-code-s-slash-line',
    php: 'ri-php-line',
    plaintext: 'ri-file-text-line',
    powershell: 'ri-terminal-line',
    pug: 'ri-code-box-line',
    python: 'ri-python-line',
    r: 'ri-code-s-slash-line',
    razor: 'ri-code-s-slash-line',
    ruby: 'ri-gemini-line',
    rust: 'ri-code-s-slash-line',
    scss: 'ri-css3-line',
    shellscript: 'ri-terminal-line',
    sql: 'ri-database-2-line',
    swift: 'ri-code-s-slash-line',
    typescript: 'ri-javascript-line',
    typescriptreact: 'ri-reactjs-line',
    vue: 'ri-vuejs-line',
    xml: 'ri-code-box-line',
    yaml: 'ri-settings-3-line',
};
const fileIconMap: Record<string, string> = {
    css: 'ri-css3-line',
    dockerfile: 'ri-instance-line',
    env: 'ri-key-2-line',
    gitignore: 'ri-git-branch-line',
    html: 'ri-html5-line',
    js: 'ri-javascript-line',
    jsx: 'ri-reactjs-line',
    json: 'ri-braces-line',
    lock: 'ri-lock-line',
    md: 'ri-markdown-line',
    mjs: 'ri-javascript-line',
    scss: 'ri-css3-line',
    sh: 'ri-terminal-line',
    sql: 'ri-database-2-line',
    svg: 'ri-image-line',
    ts: 'ri-javascript-line',
    tsx: 'ri-reactjs-line',
    txt: 'ri-file-text-line',
    vue: 'ri-vuejs-line',
    yaml: 'ri-settings-3-line',
    yml: 'ri-settings-3-line',
};

export class SQLiteManager {
    private readonly db: sqlite3.Database;
    private readonly ready: Promise<void>;

    constructor(storagePath: string) {
        const dbFile = path.join(storagePath, 'sniptime.sqlite');
        this.db = new sqlite3.Database(dbFile);
        this.ready = this.init();
    }

    public async saveHeartbeat(heartbeat: HeartbeatInput): Promise<void> {
        await this.ready;
        await this.ensureTagMetadata('project', heartbeat.project, heartbeat.project);
        await this.ensureTagMetadata('language', heartbeat.language, heartbeat.language);

        await this.run(`
            INSERT INTO heartbeats (
                at_ms, project, project_path, file_path, file_name, language, kind
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            heartbeat.timestamp,
            heartbeat.project,
            heartbeat.projectPath,
            heartbeat.filePath,
            heartbeat.fileName,
            heartbeat.language,
            heartbeat.kind,
        ]);
    }

    public async saveInterval(interval: IntervalInput): Promise<void> {
        await this.ready;
        await this.ensureTagMetadata('project', interval.project, interval.project);
        await this.ensureTagMetadata('language', interval.language, interval.language);

        const normalized = this.normalizeInterval(interval);
        if (!normalized) {
            return;
        }

        const last = await this.get<IntervalRow>(`
            SELECT *
            FROM coding_intervals
            ORDER BY end_ms DESC, id DESC
            LIMIT 1
        `);

        if (last && this.canMerge(last, normalized)) {
            const endMs = Math.max(last.end_ms, normalized.endMs);
            await this.run(`
                UPDATE coding_intervals
                SET end_ms = ?, duration_ms = ?
                WHERE id = ?
            `, [endMs, endMs - last.start_ms, last.id]);
            return;
        }

        await this.run(`
            INSERT INTO coding_intervals (
                start_ms, end_ms, duration_ms, project, project_path, file_path, file_name, language
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            normalized.startMs,
            normalized.endMs,
            normalized.endMs - normalized.startMs,
            normalized.project,
            normalized.projectPath,
            normalized.filePath,
            normalized.fileName,
            normalized.language,
        ]);
    }

    public async getMiniPanelStats(referenceMs = Date.now()): Promise<MiniPanelStats> {
        const todayBounds = SQLiteManager.dayBounds(referenceMs);
        const [todayRows, lifetimeMs] = await Promise.all([
            this.getIntervalsBetween(todayBounds.startMs, todayBounds.endMs),
            this.getLifetimeTotal(),
        ]);
        await this.ensureMetadataForRows(todayRows);
        const metadata = await this.getMetadataMap();

        return {
            generatedAt: Date.now(),
            today: this.buildDayStats(referenceMs, todayRows, metadata),
            lifetimeMs,
        };
    }

    public async getDashboardStats(referenceMs = Date.now()): Promise<DashboardStats> {
        const todayBounds = SQLiteManager.dayBounds(Date.now());
        const selectedDayBounds = SQLiteManager.dayBounds(referenceMs);
        const weekBounds = SQLiteManager.weekBounds(referenceMs);
        const yearBounds = SQLiteManager.yearBounds(referenceMs);

        const [todayRows, selectedRows, weekRows, yearRows, lifetimeMs] = await Promise.all([
            this.getIntervalsBetween(todayBounds.startMs, todayBounds.endMs),
            this.getIntervalsBetween(selectedDayBounds.startMs, selectedDayBounds.endMs),
            this.getIntervalsBetween(weekBounds.startMs, weekBounds.endMs),
            this.getIntervalsBetween(yearBounds.startMs, yearBounds.endMs),
            this.getLifetimeTotal(),
        ]);
        await this.ensureMetadataForRows([...todayRows, ...selectedRows, ...weekRows, ...yearRows]);
        const metadata = await this.getMetadataMap();

        const weekDays = this.buildWeekBuckets(weekRows, weekBounds.startMs, metadata);
        const yearMonths = this.buildYearBuckets(yearRows, yearBounds.year, metadata);

        return {
            generatedAt: Date.now(),
            selectedDateMs: referenceMs,
            today: this.buildDayStats(Date.now(), todayRows, metadata),
            day: this.buildDayStats(referenceMs, selectedRows, metadata),
            lifetimeMs,
            week: {
                startMs: weekBounds.startMs,
                endMs: weekBounds.endMs,
                totalMs: weekDays.reduce((total, day) => total + day.durationMs, 0),
                days: weekDays,
            },
            year: {
                year: yearBounds.year,
                totalMs: yearMonths.reduce((total, month) => total + month.durationMs, 0),
                months: yearMonths,
            },
        };
    }

    public async renameTag(kind: TagKind, key: string, label: string): Promise<void> {
        await this.ready;

        if (kind !== 'project' && kind !== 'language') {
            return;
        }

        const normalizedLabel = label.trim();
        if (!key || !normalizedLabel) {
            return;
        }

        await this.ensureTagMetadata(kind, key, key);
        await this.run(`
            UPDATE tag_metadata
            SET label = ?, updated_at_ms = ?
            WHERE kind = ? AND key = ?
        `, [normalizedLabel, Date.now(), kind, key]);
    }

    public async close(): Promise<void> {
        await this.ready.catch(() => undefined);
        await new Promise<void>((resolve, reject) => {
            this.db.close(err => err ? reject(err) : resolve());
        });
    }

    private async init(): Promise<void> {
        await this.run('PRAGMA journal_mode = WAL');
        await this.run('PRAGMA foreign_keys = ON');

        await this.run(`
            CREATE TABLE IF NOT EXISTS heartbeats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at_ms INTEGER NOT NULL,
                project TEXT NOT NULL,
                project_path TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                language TEXT NOT NULL,
                kind TEXT NOT NULL
            )
        `);

        await this.run(`
            CREATE TABLE IF NOT EXISTS coding_intervals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_ms INTEGER NOT NULL,
                end_ms INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                project TEXT NOT NULL,
                project_path TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                language TEXT NOT NULL
            )
        `);

        await this.run(`
            CREATE TABLE IF NOT EXISTS tag_metadata (
                kind TEXT NOT NULL,
                key TEXT NOT NULL,
                label TEXT NOT NULL,
                color TEXT NOT NULL,
                icon TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (kind, key)
            )
        `);

        await this.run('CREATE INDEX IF NOT EXISTS idx_heartbeats_at_ms ON heartbeats (at_ms)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_intervals_range ON coding_intervals (start_ms, end_ms)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_intervals_project ON coding_intervals (project)');
        await this.run('CREATE INDEX IF NOT EXISTS idx_intervals_language ON coding_intervals (language)');
    }

    private run(sql: string, params: unknown[] = []): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, err => err ? reject(err) : resolve());
        });
    }

    private get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => err ? reject(err) : resolve(row as T | undefined));
        });
    }

    private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows as T[]));
        });
    }

    private async ensureMetadataForRows(rows: IntervalRecord[]): Promise<void> {
        const seen = new Set<string>();

        for (const row of rows) {
            const projectKey = `project:${row.project}`;
            const languageKey = `language:${row.language}`;

            if (!seen.has(projectKey)) {
                seen.add(projectKey);
                await this.ensureTagMetadata('project', row.project, row.project);
            }

            if (!seen.has(languageKey)) {
                seen.add(languageKey);
                await this.ensureTagMetadata('language', row.language, row.language);
            }
        }
    }

    private async ensureTagMetadata(kind: TagKind, key: string, fallbackLabel: string): Promise<void> {
        if (kind !== 'project' && kind !== 'language') {
            return;
        }

        const seed = `${kind}:${key}`;
        const icon = this.iconForSeed(kind, key);
        await this.run(`
            INSERT OR IGNORE INTO tag_metadata (
                kind, key, label, color, icon, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            kind,
            key,
            fallbackLabel || key,
            this.colorForSeed(seed),
            icon,
            Date.now(),
            Date.now(),
        ]);

        await this.run(`
            UPDATE tag_metadata
            SET icon = ?, updated_at_ms = ?
            WHERE kind = ?
                AND key = ?
                AND (
                    icon = ''
                    OR icon LIKE 'data:%'
                    OR icon LIKE 'http:%'
                    OR icon LIKE 'https:%'
                    OR icon LIKE 'vscode-resource:%'
                    OR icon LIKE 'vscode-webview-resource:%'
                    OR icon NOT LIKE 'ri-%'
                )
        `, [icon, Date.now(), kind, key]);
    }

    private async getMetadataMap(): Promise<Map<string, TagMetadata>> {
        const rows = await this.all<MetadataRow>(`
            SELECT kind, key, label, color, icon
            FROM tag_metadata
        `);

        return new Map(rows.map(row => [
            `${row.kind}:${row.key}`,
            {
                kind: row.kind,
                key: row.key,
                label: row.label,
                color: row.color,
                icon: row.icon,
            },
        ]));
    }

    private async getIntervalsBetween(startMs: number, endMs: number): Promise<IntervalRecord[]> {
        await this.ready;

        const rows = await this.all<IntervalRow>(`
            SELECT *
            FROM coding_intervals
            WHERE end_ms > ? AND start_ms < ?
            ORDER BY start_ms ASC, end_ms ASC
        `, [startMs, endMs]);

        return rows.map(row => ({
            id: row.id,
            startMs: row.start_ms,
            endMs: row.end_ms,
            durationMs: row.duration_ms,
            project: row.project,
            projectPath: row.project_path,
            filePath: row.file_path,
            fileName: row.file_name,
            language: row.language,
        }));
    }

    private async getLifetimeTotal(): Promise<number> {
        await this.ready;

        const row = await this.get<TotalRow>(`
            SELECT COALESCE(SUM(duration_ms), 0) AS totalMs
            FROM coding_intervals
        `);

        return row?.totalMs ?? 0;
    }

    private buildDayStats(
        referenceMs: number,
        rows: IntervalRecord[],
        metadata: Map<string, TagMetadata>,
    ): DayStats {
        const bounds = SQLiteManager.dayBounds(referenceMs);
        const label = new Intl.DateTimeFormat(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        }).format(new Date(referenceMs));

        const projects = new Map<string, MapValue>();
        const languages = new Map<string, MapValue>();
        const files = new Map<string, MapValue>();
        const timeline: TimelineItem[] = [];

        for (const row of rows) {
            const startMs = Math.max(row.startMs, bounds.startMs);
            const endMs = Math.min(row.endMs, bounds.endMs);

            if (endMs <= startMs) {
                continue;
            }

            const durationMs = endMs - startMs;

            const projectMeta = this.metaFor('project', row.project, row.project, metadata);
            const languageMeta = this.metaFor('language', row.language, row.language, metadata);
            const fileMeta = this.fileMeta(row.filePath, row.fileName);

            this.addBreakdown(projects, row.project, {
                key: row.project,
                kind: 'project',
                label: projectMeta.label,
                secondary: row.projectPath,
                durationMs,
                color: projectMeta.color,
                icon: projectMeta.icon,
                project: row.project,
            });
            this.addBreakdown(languages, row.language, {
                key: row.language,
                kind: 'language',
                label: languageMeta.label,
                durationMs,
                color: languageMeta.color,
                icon: languageMeta.icon,
                language: row.language,
            });
            this.addBreakdown(files, row.filePath, {
                key: row.filePath,
                kind: 'file',
                label: row.fileName,
                secondary: row.filePath,
                durationMs,
                color: fileMeta.color,
                icon: fileMeta.icon,
                project: row.project,
                language: row.language,
                filePath: row.filePath,
            });

            this.addTimelineItem(timeline, {
                startMs,
                endMs,
                durationMs,
                project: row.project,
                projectPath: row.projectPath,
                filePath: row.filePath,
                fileName: row.fileName,
                language: row.language,
            });
        }

        return {
            dateKey: SQLiteManager.dateKey(new Date(referenceMs)),
            label,
            startMs: bounds.startMs,
            endMs: bounds.endMs,
            totalMs: timeline.reduce((total, item) => total + item.durationMs, 0),
            projects: this.sortedBreakdown(projects),
            languages: this.sortedBreakdown(languages),
            files: this.sortedBreakdown(files),
            timeline,
        };
    }

    private buildWeekBuckets(rows: IntervalRecord[], weekStartMs: number, metadata: Map<string, TagMetadata>): DayBucket[] {
        return Array.from({ length: 7 }, (_, index) => {
            const startMs = SQLiteManager.addDays(weekStartMs, index);
            const endMs = SQLiteManager.addDays(startMs, 1);
            const bucketRows = this.rowsOverlappingRange(rows, startMs, endMs);
            const durationMs = this.durationInRange(rows, startMs, endMs);
            const date = new Date(startMs);

            return {
                dateKey: SQLiteManager.dateKey(date),
                label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date),
                startMs,
                endMs,
                durationMs,
                ...this.buildRangeBreakdowns(bucketRows, startMs, endMs, metadata),
            };
        });
    }

    private buildYearBuckets(rows: IntervalRecord[], year: number, metadata: Map<string, TagMetadata>): MonthBucket[] {
        return Array.from({ length: 12 }, (_, month) => {
            const startMs = new Date(year, month, 1).getTime();
            const endMs = new Date(year, month + 1, 1).getTime();
            const date = new Date(startMs);
            const bucketRows = this.rowsOverlappingRange(rows, startMs, endMs);

            return {
                month,
                label: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date),
                startMs,
                endMs,
                durationMs: this.durationInRange(rows, startMs, endMs),
                ...this.buildRangeBreakdowns(bucketRows, startMs, endMs, metadata),
            };
        });
    }

    private durationInRange(rows: IntervalRecord[], startMs: number, endMs: number): number {
        return rows.reduce((total, row) => {
            const overlapStart = Math.max(row.startMs, startMs);
            const overlapEnd = Math.min(row.endMs, endMs);

            return overlapEnd > overlapStart ? total + (overlapEnd - overlapStart) : total;
        }, 0);
    }

    private rowsOverlappingRange(rows: IntervalRecord[], startMs: number, endMs: number): IntervalRecord[] {
        return rows.filter(row => row.endMs > startMs && row.startMs < endMs);
    }

    private buildRangeBreakdowns(
        rows: IntervalRecord[],
        startMs: number,
        endMs: number,
        metadata: Map<string, TagMetadata>,
    ): Pick<DayBucket, 'projects' | 'languages' | 'files'> {
        const projects = new Map<string, MapValue>();
        const languages = new Map<string, MapValue>();
        const files = new Map<string, MapValue>();

        for (const row of rows) {
            const overlapStart = Math.max(row.startMs, startMs);
            const overlapEnd = Math.min(row.endMs, endMs);

            if (overlapEnd <= overlapStart) {
                continue;
            }

            const durationMs = overlapEnd - overlapStart;

            const projectMeta = this.metaFor('project', row.project, row.project, metadata);
            const languageMeta = this.metaFor('language', row.language, row.language, metadata);
            const fileMeta = this.fileMeta(row.filePath, row.fileName);

            this.addBreakdown(projects, row.project, {
                key: row.project,
                kind: 'project',
                label: projectMeta.label,
                secondary: row.projectPath,
                durationMs,
                color: projectMeta.color,
                icon: projectMeta.icon,
                project: row.project,
            });

            this.addBreakdown(languages, row.language, {
                key: row.language,
                kind: 'language',
                label: languageMeta.label,
                durationMs,
                color: languageMeta.color,
                icon: languageMeta.icon,
                language: row.language,
            });

            this.addBreakdown(files, row.filePath, {
                key: row.filePath,
                kind: 'file',
                label: row.fileName,
                secondary: row.filePath,
                durationMs,
                color: fileMeta.color,
                icon: fileMeta.icon,
                project: row.project,
                language: row.language,
                filePath: row.filePath,
            });
        }

        return {
            projects: this.sortedBreakdown(projects),
            languages: this.sortedBreakdown(languages),
            files: this.sortedBreakdown(files),
        };
    }

    private addBreakdown(map: Map<string, MapValue>, key: string, item: MapValue): void {
        const current = map.get(key);

        if (current) {
            current.durationMs += item.durationMs;
            return;
        }

        map.set(key, { ...item });
    }

    private sortedBreakdown(map: Map<string, MapValue>): BreakdownItem[] {
        return Array.from(map.values())
            .sort((left, right) => right.durationMs - left.durationMs)
            .map(item => ({ ...item }));
    }

    private addTimelineItem(timeline: TimelineItem[], item: TimelineItem): void {
        const last = timeline.at(-1);

        if (
            last &&
            item.startMs - last.endMs <= mergeGapMs &&
            SQLiteManager.sameTags(last, item)
        ) {
            last.endMs = Math.max(last.endMs, item.endMs);
            last.durationMs = last.endMs - last.startMs;
            return;
        }

        timeline.push(item);
    }

    private normalizeInterval(interval: IntervalInput): IntervalInput | undefined {
        const startMs = Math.floor(interval.startMs);
        const endMs = Math.floor(interval.endMs);

        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
            return undefined;
        }

        return {
            ...interval,
            startMs,
            endMs,
        };
    }

    private canMerge(row: IntervalRow, interval: IntervalInput): boolean {
        return (
            interval.startMs - row.end_ms <= mergeGapMs &&
            interval.startMs >= row.start_ms &&
            row.project === interval.project &&
            row.project_path === interval.projectPath &&
            row.file_path === interval.filePath &&
            row.file_name === interval.fileName &&
            row.language === interval.language
        );
    }

    private metaFor(
        kind: TagKind,
        key: string,
        fallbackLabel: string,
        metadata: Map<string, TagMetadata>,
    ): TagMetadata {
        const compositeKey = `${kind}:${key}`;
        const existing = metadata.get(compositeKey);
        if (existing) {
            return {
                ...existing,
                icon: this.normalizeIcon(kind, key, existing.icon),
            };
        }

        const colorSeed = compositeKey;
        const iconSeed = key;

        return {
            kind,
            key,
            label: fallbackLabel || key,
            color: this.colorForSeed(colorSeed),
            icon: this.iconForSeed(kind, iconSeed),
        };
    }

    private fileMeta(
        filePath: string,
        fileName: string,
    ): Pick<TagMetadata, 'label' | 'color' | 'icon'> {

        const colorSeed = `file:${filePath}`;

        return {
            label: fileName,
            color: this.colorForSeed(colorSeed),
            icon: this.iconForSeed('file', filePath),
        };
    }

    private colorForSeed(seed: string): string {
        const hashNum = this.hash(seed);
        const hue = Math.abs(hashNum * 137.5) % 360;
        return this.hslToHex(hue, 70, 60);
    }

    private hslToHex(h: number, s: number, l: number): string {
        l /= 100;
        const a = s * Math.min(l, 1 - l) / 100;
        const f = (n: number) => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
    }

    private iconForSeed(kind: TagKind, seed: string): string {
        if (kind === 'project') {
            return projectIcons[this.hash(seed) % projectIcons.length];
        }

        if (kind === 'language') {
            return languageIconMap[seed.toLowerCase()] ?? languageIcons[this.hash(seed) % languageIcons.length];
        }

        const extension = SQLiteManager.fileExtension(seed);
        if (extension && fileIconMap[extension]) {
            return fileIconMap[extension];
        }

        const basename = path.basename(seed).toLowerCase();
        if (fileIconMap[basename]) {
            return fileIconMap[basename];
        }

        return fileIcons[this.hash(seed) % fileIcons.length];
    }

    private normalizeIcon(kind: TagKind, key: string, icon: string): string {
        if (icon.startsWith('ri-')) {
            return icon;
        }

        return this.iconForSeed(kind, key);
    }

    private hash(value: string): number {
        let hash = 0;

        for (let index = 0; index < value.length; index += 1) {
            hash = ((hash << 5) - hash) + value.charCodeAt(index);
            hash |= 0;
        }

        return Math.abs(hash);
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

    private static dayBounds(referenceMs: number): { startMs: number; endMs: number } {
        const reference = new Date(referenceMs);
        const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
        const end = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1);

        return {
            startMs: start.getTime(),
            endMs: end.getTime(),
        };
    }

    private static weekBounds(referenceMs: number): { startMs: number; endMs: number } {
        const reference = new Date(referenceMs);
        const dayOffset = (reference.getDay() + 6) % 7;
        const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - dayOffset);
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);

        return {
            startMs: start.getTime(),
            endMs: end.getTime(),
        };
    }

    private static yearBounds(referenceMs: number): { startMs: number; endMs: number; year: number } {
        const reference = new Date(referenceMs);
        const year = reference.getFullYear();

        return {
            startMs: new Date(year, 0, 1).getTime(),
            endMs: new Date(year + 1, 0, 1).getTime(),
            year,
        };
    }

    private static addDays(referenceMs: number, days: number): number {
        const reference = new Date(referenceMs);
        return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + days).getTime();
    }

    private static fileExtension(filePath: string): string {
        return path.extname(filePath).replace('.', '').toLowerCase();
    }

    private static dateKey(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        return `${year}-${month}-${day}`;
    }
}
