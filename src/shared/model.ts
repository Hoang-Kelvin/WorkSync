/**
 * The task model (spec 02) and the rules worked out from it.
 *
 * Imported by the main process and the renderer, so it must stay free of
 * Node.js and Electron imports. Dates are plain `YYYY-MM-DD` strings in the
 * owner's local time; timestamps are ISO strings.
 */

/** Priority levels: Urgent, High, Normal, Low. */
export type Level = 'U' | 'H' | 'N' | 'L';
export const LEVELS: Level[] = ['U', 'H', 'N', 'L'];
export const LEVEL_NAME: Record<Level, string> = {
  U: 'Urgent',
  H: 'High',
  N: 'Normal',
  L: 'Low',
};

export const STATUSES = [
  'Not started',
  'In progress',
  'In review',
  'On hold',
  'Done',
  'Cancelled',
] as const;
export type Status = (typeof STATUSES)[number];

export const WAITING_ON = ['Me', 'Customer', 'Our team', 'Nobody'] as const;
export type WaitingOn = (typeof WAITING_ON)[number];

export type TranslationState =
  | 'Not translated'
  | 'Translated'
  | 'Needs review'
  | 'Not needed';

/** Languages the app knows how to tell apart in the first version. */
export const LANGUAGES = {
  ja: 'Japanese',
  en: 'English',
  vi: 'Vietnamese',
} as const;
export type LanguageCode = keyof typeof LANGUAGES;

/** Views a project can show. */
export const VIEW_KEYS = [
  'focus',
  'board',
  'tasks',
  'timeline',
  'calendar',
  'dashboard',
  'published',
  'files',
] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];
export const BUILT_VIEWS: ViewKey[] = [
  'focus',
  'board',
  'timeline',
  'calendar',
  'tasks',
  'dashboard',
  'files',
];
export const DEFAULT_VIEWS: Record<ViewKey, boolean> = {
  focus: true,
  board: true,
  tasks: false,
  timeline: false,
  calendar: false,
  dashboard: true,
  published: false,
  files: true,
};

export interface Project {
  id: string;
  name: string;
  customer: string;
  originalLanguages: LanguageCode[];
  workingLanguage: LanguageCode;
  views: Record<ViewKey, boolean>;
  /** Days ahead that count as Due soon. */
  dueSoonDays: number;
  /** The folder on the shared drive the project publishes to. */
  publishFolder: string | null;
  /** Whether the published page includes the owner's notes. */
  publishNotes: boolean;
  /** The Tasks table's columns, sort and filters, or null for the defaults. */
  tableSettings: TableSettings | null;
  createdAt: string;
}

/** What the Tasks table remembers per project (spec 03). */
export interface TableSettings {
  columns: string[];
  sort: { key: string; dir: 'asc' | 'desc' };
  filters: Record<string, string>;
}

/**
 * One change applied to several tasks at once from the Tasks table. Priority
 * is left out on purpose: it changes one task at a time.
 */
export interface BulkChange {
  addLabel?: string;
  removeLabel?: string;
  status?: Status;
  pinned?: boolean;
}

export interface Difficulty {
  id: string;
  text: string;
  raisedOn: string;
  /** Who can resolve it. */
  resolver: string;
  open: boolean;
}

/** The current situation: the newest situation update, carried forward. */
export interface Situation {
  handledBy: string;
  doingNow: string;
  waitingOn: WaitingOn;
  nextStep: string;
  nextDate: string | null;
  /** When the situation was last confirmed. Null until the first update. */
  asOf: string | null;
}

export interface Task {
  id: string;
  projectId: string;
  /** The file's ID column, such as No. or 管理番号. For tasks added by hand, the owner's own number. */
  customerId: string;
  /** Tasks in this build are all added by hand. */
  source: 'hand' | 'file';
  /** For tasks from a file: the linked source file, the row and what the file says. */
  sourceFileId: string | null;
  sheetRow: number | null;
  /** In file, Removed from file, or Added by hand. */
  fileState: 'in_file' | 'removed' | 'hand';
  /** The file's own status word and priority value, kept for writing back. */
  statusWord: string;
  priorityWord: string;
  /** Columns that were not matched, by header name. */
  extra: Record<string, string>;
  language: LanguageCode;
  titleOriginal: string;
  titleTranslation: string;
  descriptionOriginal: string;
  descriptionTranslation: string;
  translationState: TranslationState;
  summary: string;
  notes: string;
  status: Status;
  /** The customer field: the level from the file, or the level set by hand. */
  priority: Level;
  /** The owner's own level, shown instead of `priority`. Only for tasks from a file. */
  priorityOverride: Level | null;
  labels: string[];
  assignee: string;
  category: string;
  remarks: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  pinned: boolean;
  nextAction: string;
  nextActionDate: string | null;
  situation: Situation;
  difficulties: Difficulty[];
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEntry {
  id: string;
  taskId: string;
  at: string;
  kind: string;
  text: string;
}

/** Fields the owner fills in when adding or editing a task. */
export type TaskInput = Pick<
  Task,
  | 'customerId'
  | 'titleOriginal'
  | 'titleTranslation'
  | 'descriptionOriginal'
  | 'descriptionTranslation'
  | 'summary'
  | 'notes'
  | 'status'
  | 'priority'
  | 'labels'
  | 'assignee'
  | 'category'
  | 'remarks'
  | 'plannedStart'
  | 'plannedEnd'
  | 'actualStart'
  | 'actualEnd'
  | 'nextAction'
  | 'nextActionDate'
> & { language?: LanguageCode };

export type ProjectInput = Pick<
  Project,
  'name' | 'customer' | 'originalLanguages' | 'workingLanguage'
>;

/** A situation update: only the parts that changed need values. */
export interface SituationInput {
  handledBy?: string;
  doingNow?: string;
  waitingOn?: WaitingOn;
  nextStep?: string;
  nextDate?: string | null;
  newDifficulty?: { text: string; resolver: string };
}

// ---------------------------------------------------------------- dates

export function toIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
/** `2026-11-03` → `3 Nov`. */
export function shortDate(date: string | null): string {
  if (!date) return '';
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
/** `2026-11-03` → `2026/11/03`, the usual format in Japanese files. */
export function fileDate(date: string | null): string {
  return date ? date.replaceAll('-', '/') : '';
}

// ---------------------------------------------------------------- rules

export const isClosed = (t: Pick<Task, 'status'>): boolean =>
  t.status === 'Done' || t.status === 'Cancelled';

/** The level every view shows: the override when there is one. */
export const shownPriority = (t: Task): Level =>
  t.priorityOverride ?? t.priority;

export interface Flags {
  pinned: boolean;
  urgent: boolean;
  overdue: boolean;
  dueSoon: boolean;
  lateToStart: boolean;
  needsMyAction: boolean;
  nextStepOverdue: boolean;
  openDifficulties: number;
  briefIncomplete: boolean;
}

/** The computed flags from spec 02. They are worked out when needed, never stored. */
export function flags(t: Task, today: string, dueSoonDays = 7): Flags {
  const open = !isClosed(t);
  const s = t.situation;
  const toEnd = t.plannedEnd ? daysBetween(today, t.plannedEnd) : null;
  return {
    pinned: t.pinned,
    urgent: open && shownPriority(t) === 'U',
    overdue: open && toEnd !== null && toEnd < 0,
    dueSoon: open && toEnd !== null && toEnd >= 0 && toEnd <= dueSoonDays,
    lateToStart:
      t.status === 'Not started' &&
      t.plannedStart !== null &&
      daysBetween(today, t.plannedStart) < 0,
    needsMyAction:
      open &&
      (s.waitingOn === 'Me' ||
        (t.nextActionDate !== null &&
          daysBetween(today, t.nextActionDate) <= 0)),
    nextStepOverdue:
      open &&
      s.nextDate !== null &&
      daysBetween(today, s.nextDate) < 0 &&
      (s.asOf === null || daysBetween(s.asOf, s.nextDate) >= 0),
    openDifficulties: t.difficulties.filter((d) => d.open).length,
    briefIncomplete: t.summary.trim() === '' || s.asOf === null,
  };
}

/** Whether a task belongs in the focus list. */
export function inFocus(t: Task, today: string, dueSoonDays = 7): boolean {
  if (t.fileState === 'removed') return false;
  if (isClosed(t)) return false;
  const f = flags(t, today, dueSoonDays);
  return (
    f.pinned ||
    f.urgent ||
    f.overdue ||
    f.dueSoon ||
    f.lateToStart ||
    f.needsMyAction ||
    f.nextStepOverdue
  );
}

const LEVEL_ORDER: Record<Level, number> = { U: 0, H: 1, N: 2, L: 3 };
/** Sorted by priority, then by planned end. Tasks without an end date come last. */
export function byPriority(a: Task, b: Task): number {
  const p = LEVEL_ORDER[shownPriority(a)] - LEVEL_ORDER[shownPriority(b)];
  if (p) return p;
  if (a.plannedEnd === b.plannedEnd)
    return a.customerId.localeCompare(b.customerId, undefined, {
      numeric: true,
    });
  if (!a.plannedEnd) return 1;
  if (!b.plannedEnd) return -1;
  return a.plannedEnd < b.plannedEnd ? -1 : 1;
}

/** A deadline in words, as every view shows it. */
export function deadline(
  t: Task,
  today: string,
  dueSoonDays = 7,
): { text: string; tone: 'over' | 'soon' | '' } | null {
  if (!t.plannedEnd || isClosed(t)) return null;
  const n = daysBetween(today, t.plannedEnd);
  if (n < 0)
    return { text: `Overdue by ${-n} day${n < -1 ? 's' : ''}`, tone: 'over' };
  if (n === 0) return { text: 'Due today', tone: 'soon' };
  if (n <= dueSoonDays)
    return { text: `Due in ${n} day${n > 1 ? 's' : ''}`, tone: 'soon' };
  return { text: `Due ${shortDate(t.plannedEnd)}`, tone: '' };
}

/** Reasons a task is in the focus list that the chips on its card do not show. */
export function focusReasons(
  t: Task,
  today: string,
  dueSoonDays = 7,
): string[] {
  const f = flags(t, today, dueSoonDays);
  const r: string[] = [];
  if (f.nextStepOverdue)
    r.push(`Next step was due ${shortDate(t.situation.nextDate)}`);
  if (f.lateToStart) r.push(`Planned to start ${shortDate(t.plannedStart)}`);
  if (
    t.nextActionDate &&
    daysBetween(today, t.nextActionDate) <= 0 &&
    t.nextAction
  )
    r.push(`Your action: ${t.nextAction}`);
  return r;
}

/**
 * Picks the language of a text from the project's original languages, using
 * its characters (spec 02, Languages): kana or kanji mean Japanese, Vietnamese
 * letters mean Vietnamese, and other Latin text means the project's first
 * language that uses Latin letters.
 */
export function detectLanguage(
  text: string,
  projectLanguages: LanguageCode[],
  /** The source file's main language, preferred among languages with the same letters. */
  fileLanguage?: LanguageCode,
): LanguageCode {
  const langs = projectLanguages.length
    ? projectLanguages
    : (['ja'] as LanguageCode[]);
  if (/[぀-ヿ㐀-鿿ｦ-ﾟ]/.test(text) && langs.includes('ja')) return 'ja';
  const latin = langs.filter((l) => l !== 'ja');
  if (
    /[ăâđêôơưàảãạằẳẵặầẩẫậèẻẽẹềểễệìỉĩịòỏõọồổỗộờởỡợùủũụừửữựỳỷỹỵ]/i.test(text) &&
    latin.includes('vi')
  )
    return 'vi';
  if (fileLanguage && fileLanguage !== 'ja' && latin.includes(fileLanguage))
    return fileLanguage;
  return latin[0] ?? langs[0];
}

/** The translation state that follows from the texts and the languages. */
export function translationStateFor(
  t: Pick<Task, 'language' | 'titleTranslation' | 'translationState'>,
  workingLanguage: LanguageCode,
): TranslationState {
  if (t.language === workingLanguage) return 'Not needed';
  if (t.titleTranslation.trim() === '') return 'Not translated';
  return t.translationState === 'Needs review' ? 'Needs review' : 'Translated';
}

/** Text search over everything the owner may remember about a task. */
export function matchesSearch(t: Task, query: string): boolean {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/^no\.?\s*/, '');
  if (!q) return true;
  const s = t.situation;
  return [
    t.customerId,
    t.titleOriginal,
    t.titleTranslation,
    t.summary,
    t.notes,
    t.descriptionOriginal,
    t.descriptionTranslation,
    s.handledBy,
    s.doingNow,
    s.nextStep,
    t.assignee,
    ...t.labels,
  ]
    .join('\n')
    .toLowerCase()
    .includes(q);
}

export interface Brief {
  what: string;
  where: string;
  next: string;
  /** Plain text for chat or email. */
  text: string;
}

/** The task brief (spec 03): what it is, where it stands, what happens next. */
export function brief(t: Task): Brief {
  const s = t.situation;
  const lower = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
  const open = t.difficulties.filter((d) => d.open);
  const where = [t.status as string];
  if (s.handledBy)
    where.push(
      s.doingNow ? `${s.handledBy}: ${lower(s.doingNow)}` : s.handledBy,
    );
  if (open.length)
    where.push(
      `${open.length} open difficult${open.length > 1 ? 'ies' : 'y'}: ${open.map((d) => lower(d.text)).join('; ')}`,
    );
  if (s.asOf) where.push(`as of ${shortDate(s.asOf)}`);
  const next = s.nextStep
    ? `${s.nextStep}${s.nextDate ? ` by ${shortDate(s.nextDate)}` : ''}${s.waitingOn !== 'Nobody' ? ` · waiting on ${s.waitingOn === 'Me' ? 'me' : s.waitingOn.toLowerCase()}` : ''}`
    : 'Not decided yet';
  const what = t.summary || 'No summary yet';
  const title = t.titleTranslation
    ? `${t.titleTranslation} (${t.titleOriginal})`
    : t.titleOriginal;
  return {
    what,
    where: where.join(' · '),
    next,
    text: [
      `No. ${t.customerId}  ${title}`,
      `What it is:         ${what}`,
      `Where it stands:    ${where.join(' · ')}`,
      `What happens next:  ${next}`,
    ].join('\n'),
  };
}

export const EMPTY_SITUATION: Situation = {
  handledBy: '',
  doingNow: '',
  waitingOn: 'Nobody',
  nextStep: '',
  nextDate: null,
  asOf: null,
};

/** A technical term with its preferred translation in the working language (spec 02, Glossary). */
export interface GlossaryTerm {
  id: string;
  projectId: string;
  term: string;
  translation: string;
  language: LanguageCode;
  note: string;
}

/** A translation and summary from an AI batch, accepted by the owner. */
export interface AiResult {
  taskId: string;
  title?: string;
  description?: string;
  summary?: string;
}

/** What the last import of a project's files changed, for the dashboard. */
export interface ImportSummary {
  at: string;
  added: number;
  changed: number;
  removed: number;
}

/** The last publish of a project and what has happened since (spec 05). */
export interface PublishStatus {
  folder: string | null;
  lastAt: string | null;
  /** Tasks changed since the last publish. */
  unpublished: number;
  /** Published files changed or deleted by someone since the last publish. */
  tampered: string[];
  /** A reason the folder should not be used, such as being inside a linked file's folder. */
  folderProblem: string | null;
}
