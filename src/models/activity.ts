export type HeartbeatKind = 'edit' | 'save' | 'selection' | 'focus' | 'tick';
export type TagKind = 'project' | 'language' | 'file';

export interface ActivityTags {
    project: string;
    projectPath: string;
    filePath: string;
    fileName: string;
    language: string;
}

export interface HeartbeatInput extends ActivityTags {
    timestamp: number;
    kind: HeartbeatKind;
}

export interface IntervalInput extends ActivityTags {
    startMs: number;
    endMs: number;
}

export interface IntervalRecord extends IntervalInput {
    id: number;
    durationMs: number;
}

export interface BreakdownItem {
    key: string;
    kind: TagKind;
    label: string;
    secondary?: string;
    durationMs: number;
    color: string;
    icon: string;
    project?: string;
    language?: string;
    filePath?: string;
}

export interface DayBucket {
    dateKey: string;
    label: string;
    startMs: number;
    endMs: number;
    durationMs: number;
    projects: BreakdownItem[];
    languages: BreakdownItem[];
    files: BreakdownItem[];
}

export interface MonthBucket {
    month: number;
    label: string;
    startMs: number;
    endMs: number;
    durationMs: number;
    projects: BreakdownItem[];
    languages: BreakdownItem[];
    files: BreakdownItem[];
}

export interface TimelineItem extends ActivityTags {
    startMs: number;
    endMs: number;
    durationMs: number;
}

export interface DayStats {
    dateKey: string;
    label: string;
    startMs: number;
    endMs: number;
    totalMs: number;
    projects: BreakdownItem[];
    languages: BreakdownItem[];
    files: BreakdownItem[];
    timeline: TimelineItem[];
}

export interface MiniPanelStats {
    generatedAt: number;
    today: DayStats;
    lifetimeMs: number;
}

export interface DashboardStats extends MiniPanelStats {
    selectedDateMs: number;
    day: DayStats;
    week: {
        startMs: number;
        endMs: number;
        totalMs: number;
        days: DayBucket[];
    };
    year: {
        year: number;
        totalMs: number;
        months: MonthBucket[];
    };
}
