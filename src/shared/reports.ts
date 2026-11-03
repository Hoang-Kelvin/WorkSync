/**
 * Reports (spec 05): what goes in each one. Built from the information the
 * owner already keeps; the files themselves are made in the main process.
 */
import {
  LEVEL_NAME,
  STATUSES,
  addDays,
  byPriority,
  daysBetween,
  fileDate,
  flags,
  isClosed,
  shownPriority,
  type Level,
  type Project,
  type Status,
  type Task,
} from './model';

export type ReportKind = 'progress' | 'taskList' | 'schedule' | 'briefs';
export type ReportFormat = 'docx' | 'xlsx';
export type ReportLanguage = 'working' | 'original' | 'both';

export const REPORTS: Record<
  ReportKind,
  { name: string; description: string; formats: ReportFormat[] }
> = {
  progress: {
    name: 'Progress report',
    description:
      'An overview of the period, then each task’s brief: what it is, 現状, 課題 and 今後の予定.',
    formats: ['docx', 'xlsx'],
  },
  taskList: {
    name: 'Task list',
    description: 'A table of tasks with the columns you choose.',
    formats: ['xlsx', 'docx'],
  },
  schedule: {
    name: 'Schedule',
    description:
      'Planned and actual dates for each task, drawn as shaded cells.',
    formats: ['xlsx'],
  },
  briefs: {
    name: 'Task briefs',
    description:
      'The brief of each task, for a meeting with your manager or the customer.',
    formats: ['docx'],
  },
};

export interface ReportOptions {
  kind: ReportKind;
  format: ReportFormat;
  projectId: string;
  /** Statuses to include; empty means all. */
  statuses: Status[];
  /** Priority levels to include; empty means all. */
  levels: Level[];
  /** Only tasks with this label, when set. */
  label: string;
  /** Only tasks with this assignee or handler, when set. */
  person: string;
  /** For the progress report: the period, as dates. */
  from: string;
  to: string;
  language: ReportLanguage;
  /** Task list columns, by key. */
  columns: string[];
  includeNotes: boolean;
  preparedBy: string;
}

/** Monday to Sunday of the week that holds `today`, the default period. */
export function thisWeek(today: string): { from: string; to: string } {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const from = addDays(today, -((dow + 6) % 7));
  return { from, to: addDays(from, 6) };
}

/**
 * The tasks a report covers. The progress report covers tasks that are not
 * Done or Cancelled, plus tasks that changed during the period. Removed rows
 * are left out.
 */
export function reportTasks(all: Task[], o: ReportOptions): Task[] {
  const person = o.person.trim().toLowerCase();
  const label = o.label.trim().toLowerCase();
  return all
    .filter((t) => t.projectId === o.projectId && t.fileState !== 'removed')
    .filter((t) => !o.statuses.length || o.statuses.includes(t.status))
    .filter((t) => !o.levels.length || o.levels.includes(shownPriority(t)))
    .filter((t) => !label || t.labels.some((l) => l.toLowerCase() === label))
    .filter(
      (t) =>
        !person ||
        `${t.assignee}\n${t.situation.handledBy}`
          .toLowerCase()
          .includes(person),
    )
    .filter((t) => {
      if (o.kind !== 'progress') return true;
      if (!isClosed(t)) return true;
      const changed = t.updatedAt.slice(0, 10);
      return changed >= o.from && changed <= o.to;
    })
    .sort(byPriority);
}

/** The overview at the top of the progress report. */
export function periodOverview(
  tasks: Task[],
  project: Project,
  o: ReportOptions,
  today: string,
) {
  const open = tasks.filter((t) => !isClosed(t));
  const inPeriod = (d: string | null) => !!d && d >= o.from && d <= o.to;
  return {
    open: open.length,
    finished: tasks.filter(
      (t) =>
        t.status === 'Done' &&
        inPeriod(t.actualEnd ?? t.updatedAt.slice(0, 10)),
    ).length,
    started: tasks.filter((t) => inPeriod(t.actualStart)).length,
    overdue: open.filter((t) => flags(t, today, project.dueSoonDays).overdue)
      .length,
    difficulties: open.reduce(
      (n, t) => n + t.difficulties.filter((d) => d.open).length,
      0,
    ),
    waitingOnCustomer: open.filter((t) => t.situation.waitingOn === 'Customer')
      .length,
    byStatus: STATUSES.map((s) => ({
      status: s,
      count: tasks.filter((t) => t.status === s).length,
    })).filter((x) => x.count),
  };
}

/** A task's title in the chosen language: the working language, the original, or both. */
export function reportTitle(t: Task, language: ReportLanguage): string {
  const tr = t.titleTranslation;
  if (language === 'original' || !tr || tr === t.titleOriginal)
    return t.titleOriginal;
  if (language === 'working') return tr;
  return `${t.titleOriginal}\n${tr}`;
}

/**
 * Text the owner writes, such as summaries, is in the working language. In a
 * report in the original language it is marked as not translated (spec 05).
 */
export function ownerText(
  text: string,
  language: ReportLanguage,
  originalIsJapanese: boolean,
): string {
  if (!text || language !== 'original') return text;
  return `${originalIsJapanese ? '（未翻訳）' : '(not translated) '}${text}`;
}

export interface Column {
  key: string;
  label: string;
  /** The Japanese heading, used when the report is in Japanese or both languages. */
  ja: string;
  width: number;
  value: (t: Task, o: ReportOptions) => string;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export const COLUMNS: Column[] = [
  { key: 'id', label: 'No.', ja: 'No.', width: 8, value: (t) => t.customerId },
  {
    key: 'title',
    label: 'Title',
    ja: '件名',
    width: 44,
    value: (t, o) => reportTitle(t, o.language),
  },
  {
    key: 'status',
    label: 'Status',
    ja: '状態',
    width: 12,
    value: (t) => t.statusWord || t.status,
  },
  {
    key: 'priority',
    label: 'Priority',
    ja: '優先度',
    width: 10,
    value: (t) => LEVEL_NAME[shownPriority(t)],
  },
  {
    key: 'assignee',
    label: 'Assignee',
    ja: '担当者',
    width: 14,
    value: (t) => t.assignee,
  },
  {
    key: 'handledBy',
    label: 'Handled by',
    ja: '対応者',
    width: 18,
    value: (t) => t.situation.handledBy,
  },
  {
    key: 'plannedStart',
    label: 'Planned start',
    ja: '予定開始',
    width: 12,
    value: (t) => fileDate(t.plannedStart),
  },
  {
    key: 'plannedEnd',
    label: 'Planned end',
    ja: '予定終了',
    width: 12,
    value: (t) => fileDate(t.plannedEnd),
  },
  {
    key: 'actualStart',
    label: 'Actual start',
    ja: '実績開始',
    width: 12,
    value: (t) => fileDate(t.actualStart),
  },
  {
    key: 'actualEnd',
    label: 'Actual end',
    ja: '実績終了',
    width: 12,
    value: (t) => fileDate(t.actualEnd),
  },
  {
    key: 'summary',
    label: 'Summary',
    ja: '概要',
    width: 44,
    value: (t, o) => ownerText(t.summary, o.language, true),
  },
  {
    key: 'doingNow',
    label: 'Doing now',
    ja: '現状',
    width: 36,
    value: (t, o) => ownerText(t.situation.doingNow, o.language, true),
  },
  {
    key: 'difficulties',
    label: 'Open difficulties',
    ja: '課題',
    width: 36,
    value: (t, o) =>
      ownerText(
        t.difficulties
          .filter((d) => d.open)
          .map((d) => d.text)
          .join('\n'),
        o.language,
        true,
      ),
  },
  {
    key: 'next',
    label: 'Next step',
    ja: '今後の予定',
    width: 36,
    value: (t, o) =>
      ownerText(
        t.situation.nextStep
          ? `${t.situation.nextStep}${t.situation.nextDate ? ` (${fileDate(t.situation.nextDate)})` : ''}`
          : '',
        o.language,
        true,
      ),
  },
  {
    key: 'waitingOn',
    label: 'Waiting on',
    ja: 'ボール',
    width: 12,
    value: (t) =>
      t.situation.waitingOn === 'Nobody' ? '' : t.situation.waitingOn,
  },
  {
    key: 'labels',
    label: 'Labels',
    ja: 'ラベル',
    width: 18,
    value: (t) => t.labels.join(', '),
  },
  {
    key: 'remarks',
    label: 'Remarks',
    ja: '備考',
    width: 30,
    value: (t) => t.remarks,
  },
  {
    key: 'notes',
    label: 'Notes',
    ja: 'メモ',
    width: 36,
    value: (t, o) => (o.includeNotes ? t.notes : ''),
  },
];

export const DEFAULT_COLUMNS = [
  'id',
  'title',
  'status',
  'priority',
  'assignee',
  'plannedEnd',
  'doingNow',
  'next',
];

/** A column heading in the report's language. */
export const heading = (
  c: Pick<Column, 'label' | 'ja'>,
  language: ReportLanguage,
  originalIsJapanese: boolean,
) =>
  !originalIsJapanese || language === 'working'
    ? c.label
    : language === 'original'
      ? c.ja
      : `${c.ja} ${c.label}`;

/** The three parts of a brief, for the progress report and the briefs. */
export function briefParts(
  t: Task,
  o: ReportOptions,
  today: string,
  dueSoonDays: number,
) {
  const s = t.situation;
  const open = t.difficulties.filter((d) => d.open);
  const where = [
    t.statusWord || t.status,
    s.handledBy &&
      (s.doingNow ? `${s.handledBy}: ${lower(s.doingNow)}` : s.handledBy),
  ]
    .filter(Boolean)
    .join(' · ');
  const f = flags(t, today, dueSoonDays);
  const due =
    t.plannedEnd && !isClosed(t)
      ? `${f.overdue ? 'Overdue, was due' : 'Due'} ${fileDate(t.plannedEnd)}`
      : '';
  const ja = t.language === 'ja';
  return {
    what: ownerText(t.summary || '', o.language, ja),
    doingNow: ownerText(where, o.language, ja),
    difficulties: open.map((d) =>
      ownerText(
        `${d.text}${d.resolver ? ` (${d.resolver})` : ''}`,
        o.language,
        ja,
      ),
    ),
    next: ownerText(
      s.nextStep
        ? `${s.nextStep}${s.nextDate ? ` by ${fileDate(s.nextDate)}` : ''}${s.waitingOn !== 'Nobody' ? ` · waiting on ${s.waitingOn === 'Me' ? 'us' : lower(s.waitingOn)}` : ''}`
        : '',
      o.language,
      ja,
    ),
    due,
    asOf: s.asOf ? fileDate(s.asOf) : '',
    stale: s.asOf ? daysBetween(s.asOf, today) : null,
  };
}

/** The file name for a report, such as "Portal progress report 20261103.docx". */
export function reportFileName(
  project: Project,
  o: Pick<ReportOptions, 'kind' | 'format'>,
  today: string,
): string {
  const safe = project.name
    .replace(/^sample:\s*/i, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim();
  return `${safe} ${REPORTS[o.kind].name.toLowerCase()} ${today.replaceAll('-', '')}.${o.format}`;
}
