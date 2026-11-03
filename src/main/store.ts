import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_VIEWS,
  EMPTY_SITUATION,
  LEVEL_NAME,
  detectLanguage,
  translationStateFor,
  type ActivityEntry,
  type AiResult,
  type GlossaryTerm,
  type Level,
  type Project,
  type ProjectInput,
  type SituationInput,
  type Status,
  type Task,
  type TaskInput,
  type ViewKey,
} from '../shared/model';

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? '' : String(v));
const opt = (v: unknown): string | null =>
  v == null || v === '' ? null : String(v);

/** Field names as the owner sees them, for history entries. */
const FIELD_LABELS: Partial<Record<keyof TaskInput, string>> = {
  customerId: 'No.',
  titleOriginal: 'Original title',
  titleTranslation: 'Title translation',
  descriptionOriginal: 'Original description',
  descriptionTranslation: 'Description translation',
  summary: 'Summary',
  notes: 'Notes',
  status: 'Status',
  priority: 'Priority',
  labels: 'Labels',
  assignee: 'Assignee',
  category: 'Category',
  remarks: 'Remarks',
  plannedStart: 'Planned start',
  plannedEnd: 'Planned end',
  actualStart: 'Actual start',
  actualEnd: 'Actual end',
  nextAction: 'Next action',
  nextActionDate: 'Next action date',
};

/**
 * All reads and writes of WorkSync's data. Takes an open database so it can be
 * used from the main process and from tests alike.
 */
export class Store {
  constructor(
    private readonly db: DatabaseSync,
    /** Returns now as an ISO timestamp; replaceable in tests. */
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private today(): string {
    const d = new Date(this.now());
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // ------------------------------------------------------------ projects

  private toProject(r: Row): Project {
    return {
      id: str(r.id),
      name: str(r.name),
      customer: str(r.customer),
      originalLanguages: JSON.parse(str(r.original_languages)),
      workingLanguage: str(r.working_language) as Project['workingLanguage'],
      views: { ...DEFAULT_VIEWS, ...JSON.parse(str(r.views)), focus: true },
      dueSoonDays: Number(r.due_soon_days),
      createdAt: str(r.created_at),
    };
  }

  listProjects(): Project[] {
    return (
      this.db
        .prepare('SELECT * FROM projects ORDER BY created_at, name')
        .all() as Row[]
    ).map((r) => this.toProject(r));
  }

  getProject(id: string): Project {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | Row
      | undefined;
    if (!r) throw new Error(`Project ${id} not found`);
    return this.toProject(r);
  }

  createProject(input: ProjectInput): Project {
    const name = input.name.trim();
    if (!name) throw new Error('A project needs a name.');
    if (!input.originalLanguages.length)
      throw new Error('Choose at least one original language.');
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO projects (id, name, customer, original_languages, working_language, views, due_soon_days, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 7, ?)`,
      )
      .run(
        id,
        name,
        input.customer.trim(),
        JSON.stringify(input.originalLanguages),
        input.workingLanguage,
        JSON.stringify(DEFAULT_VIEWS),
        this.now(),
      );
    return this.getProject(id);
  }

  updateProject(
    id: string,
    patch: Partial<ProjectInput> & {
      views?: Partial<Record<ViewKey, boolean>>;
      dueSoonDays?: number;
    },
  ): Project {
    const p = this.getProject(id);
    const next = {
      name: patch.name?.trim() || p.name,
      customer: patch.customer?.trim() ?? p.customer,
      originalLanguages: patch.originalLanguages ?? p.originalLanguages,
      workingLanguage: patch.workingLanguage ?? p.workingLanguage,
      views: { ...p.views, ...patch.views, focus: true },
      dueSoonDays: patch.dueSoonDays ?? p.dueSoonDays,
    };
    this.db
      .prepare(
        `UPDATE projects SET name = ?, customer = ?, original_languages = ?, working_language = ?, views = ?, due_soon_days = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.customer,
        JSON.stringify(next.originalLanguages),
        next.workingLanguage,
        JSON.stringify(next.views),
        next.dueSoonDays,
        id,
      );
    return this.getProject(id);
  }

  // ------------------------------------------------------------ tasks

  private toTask(r: Row): Task {
    const difficulties = (
      this.db
        .prepare(
          'SELECT * FROM difficulties WHERE task_id = ? ORDER BY position, raised_on',
        )
        .all(str(r.id)) as Row[]
    ).map((d) => ({
      id: str(d.id),
      text: str(d.text),
      raisedOn: str(d.raised_on),
      resolver: str(d.resolver),
      open: Number(d.open) === 1,
    }));
    return {
      id: str(r.id),
      projectId: str(r.project_id),
      customerId: str(r.customer_id),
      source: str(r.source) as Task['source'],
      sourceFileId: opt(r.source_file_id),
      sheetRow: r.sheet_row == null ? null : Number(r.sheet_row),
      fileState: (str(r.file_state) || 'hand') as Task['fileState'],
      statusWord: str(r.status_word),
      priorityWord: str(r.priority_word),
      extra: JSON.parse(str(r.extra) || '{}'),
      language: str(r.language) as Task['language'],
      titleOriginal: str(r.title_original),
      titleTranslation: str(r.title_translation),
      descriptionOriginal: str(r.description_original),
      descriptionTranslation: str(r.description_translation),
      translationState: str(r.translation_state) as Task['translationState'],
      summary: str(r.summary),
      notes: str(r.notes),
      status: str(r.status) as Status,
      priority: str(r.priority) as Level,
      priorityOverride: opt(r.priority_override) as Level | null,
      labels: JSON.parse(str(r.labels) || '[]'),
      assignee: str(r.assignee),
      category: str(r.category),
      remarks: str(r.remarks),
      plannedStart: opt(r.planned_start),
      plannedEnd: opt(r.planned_end),
      actualStart: opt(r.actual_start),
      actualEnd: opt(r.actual_end),
      pinned: Number(r.pinned) === 1,
      nextAction: str(r.next_action),
      nextActionDate: opt(r.next_action_date),
      situation: {
        handledBy: str(r.handled_by),
        doingNow: str(r.doing_now),
        waitingOn: str(r.waiting_on) as Task['situation']['waitingOn'],
        nextStep: str(r.next_step),
        nextDate: opt(r.next_date),
        asOf: opt(r.as_of),
      },
      difficulties,
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
    };
  }

  listTasks(): Task[] {
    return (
      this.db.prepare('SELECT * FROM tasks ORDER BY created_at').all() as Row[]
    ).map((r) => this.toTask(r));
  }

  getTask(id: string): Task {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | Row
      | undefined;
    if (!r) throw new Error(`Task ${id} not found`);
    return this.toTask(r);
  }

  private nextCustomerId(projectId: string): string {
    const ids = (
      this.db
        .prepare('SELECT customer_id FROM tasks WHERE project_id = ?')
        .all(projectId) as Row[]
    ).map((r) => str(r.customer_id));
    const max = Math.max(
      0,
      ...ids.map((x) => (/^\d+$/.test(x) ? Number(x) : 0)),
    );
    return String(max + 1).padStart(3, '0');
  }

  private clean(input: TaskInput): TaskInput {
    const title = input.titleOriginal.trim();
    if (!title) throw new Error('A task needs a title.');
    const labels = [
      ...new Set(input.labels.map((l) => l.trim()).filter(Boolean)),
    ];
    return { ...input, titleOriginal: title, labels };
  }

  createTask(projectId: string, raw: TaskInput): Task {
    const project = this.getProject(projectId);
    const input = this.clean(raw);
    const id = randomUUID();
    const now = this.now();
    const language =
      input.language ??
      detectLanguage(input.titleOriginal, project.originalLanguages);
    const translationState = translationStateFor(
      {
        language,
        titleTranslation: input.titleTranslation,
        translationState: 'Translated',
      },
      project.workingLanguage,
    );
    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO tasks (id, project_id, customer_id, source, language, title_original, title_translation,
             description_original, description_translation, translation_state, summary, notes, status, priority,
             labels, assignee, category, remarks, planned_start, planned_end, actual_start, actual_end,
             next_action, next_action_date, created_at, updated_at)
           VALUES (?, ?, ?, 'hand', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          projectId,
          input.customerId.trim() || this.nextCustomerId(projectId),
          language,
          input.titleOriginal,
          input.titleTranslation.trim(),
          input.descriptionOriginal,
          input.descriptionTranslation,
          translationState,
          input.summary.trim(),
          input.notes,
          input.status,
          input.priority,
          JSON.stringify(input.labels),
          input.assignee.trim(),
          input.category.trim(),
          input.remarks,
          input.plannedStart,
          input.plannedEnd,
          input.actualStart,
          input.actualEnd,
          input.nextAction.trim(),
          input.nextActionDate,
          now,
          now,
        );
      this.log(id, 'Created', 'Added by hand.');
    });
    return this.getTask(id);
  }

  /** Changes task fields and records which ones changed in the history. */
  updateTask(id: string, patch: Partial<TaskInput>): Task {
    const before = this.getTask(id);
    const project = this.getProject(before.projectId);
    const merged = this.clean({ ...before, ...patch });
    const language =
      patch.language ??
      (patch.titleOriginal !== undefined &&
      patch.titleOriginal !== before.titleOriginal
        ? detectLanguage(merged.titleOriginal, project.originalLanguages)
        : before.language);
    const changed = (Object.keys(FIELD_LABELS) as (keyof TaskInput)[]).filter(
      (k) =>
        k in patch &&
        JSON.stringify(before[k as keyof Task]) !== JSON.stringify(merged[k]),
    );
    if (!changed.length && language === before.language) return before;
    const translationState = translationStateFor(
      {
        language,
        titleTranslation: merged.titleTranslation,
        translationState: before.translationState,
      },
      project.workingLanguage,
    );
    this.tx(() => {
      this.db
        .prepare(
          `UPDATE tasks SET customer_id = ?, language = ?, title_original = ?, title_translation = ?,
             description_original = ?, description_translation = ?, translation_state = ?, summary = ?, notes = ?,
             status = ?, priority = ?, labels = ?, assignee = ?, category = ?, remarks = ?, planned_start = ?,
             planned_end = ?, actual_start = ?, actual_end = ?, next_action = ?, next_action_date = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          merged.customerId.trim() || before.customerId,
          language,
          merged.titleOriginal,
          merged.titleTranslation.trim(),
          merged.descriptionOriginal,
          merged.descriptionTranslation,
          translationState,
          merged.summary.trim(),
          merged.notes,
          merged.status,
          merged.priority,
          JSON.stringify(merged.labels),
          merged.assignee.trim(),
          merged.category.trim(),
          merged.remarks,
          merged.plannedStart,
          merged.plannedEnd,
          merged.actualStart,
          merged.actualEnd,
          merged.nextAction.trim(),
          merged.nextActionDate,
          this.now(),
          id,
        );
      if (changed.includes('status') && changed.length === 1) {
        this.log(id, 'Edit', `Status ${before.status} → ${merged.status}.`);
      } else if (changed.includes('priority') && changed.length === 1) {
        this.log(
          id,
          'Edit',
          `Priority ${LEVEL_NAME[before.priority]} → ${LEVEL_NAME[merged.priority]}.`,
        );
      } else if (changed.length) {
        this.log(
          id,
          'Edit',
          `Changed ${changed.map((k) => FIELD_LABELS[k]).join(', ')}.`,
        );
      }
    });
    return this.getTask(id);
  }

  /** Sets or clears the owner's override. Equal to the task's own level means no override. */
  setPriorityOverride(id: string, level: Level | null): Task {
    const t = this.getTask(id);
    const next = level === t.priority ? null : level;
    if (next === t.priorityOverride) return t;
    this.tx(() => {
      this.db
        .prepare(
          'UPDATE tasks SET priority_override = ?, updated_at = ? WHERE id = ?',
        )
        .run(next, this.now(), id);
      this.log(
        id,
        'Priority override',
        next
          ? `Set to ${LEVEL_NAME[next]} for you. The task's own level is ${LEVEL_NAME[t.priority]}.`
          : 'Removed.',
      );
    });
    return this.getTask(id);
  }

  setPinned(id: string, pinned: boolean): Task {
    this.db
      .prepare('UPDATE tasks SET pinned = ?, updated_at = ? WHERE id = ?')
      .run(pinned ? 1 : 0, this.now(), id);
    return this.getTask(id);
  }

  /**
   * Adds a situation update. Parts left out carry over from the current
   * situation, and As of becomes today.
   */
  addSituationUpdate(id: string, input: SituationInput): Task {
    const t = this.getTask(id);
    const s = { ...EMPTY_SITUATION, ...t.situation };
    const next = {
      handledBy: input.handledBy?.trim() ?? s.handledBy,
      doingNow: input.doingNow?.trim() ?? s.doingNow,
      waitingOn: input.waitingOn ?? s.waitingOn,
      nextStep: input.nextStep?.trim() ?? s.nextStep,
      nextDate: input.nextDate === undefined ? s.nextDate : input.nextDate,
      asOf: this.today(),
    };
    this.tx(() => {
      this.db
        .prepare(
          `UPDATE tasks SET handled_by = ?, doing_now = ?, waiting_on = ?, next_step = ?, next_date = ?, as_of = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          next.handledBy,
          next.doingNow,
          next.waitingOn,
          next.nextStep,
          next.nextDate,
          next.asOf,
          this.now(),
          id,
        );
      this.db
        .prepare(
          `INSERT INTO situation_updates (id, task_id, at, handled_by, doing_now, waiting_on, next_step, next_date, as_of)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          id,
          this.now(),
          next.handledBy,
          next.doingNow,
          next.waitingOn,
          next.nextStep,
          next.nextDate,
          next.asOf,
        );
      const parts = [
        next.doingNow && `Doing now: ${next.doingNow}.`,
        next.nextStep &&
          `Next: ${next.nextStep}${next.nextDate ? ` by ${next.nextDate.replaceAll('-', '/')}` : ''}.`,
        next.waitingOn !== 'Nobody' &&
          `Waiting on ${next.waitingOn === 'Me' ? 'me' : next.waitingOn.toLowerCase()}.`,
      ].filter(Boolean);
      if (input.newDifficulty?.text.trim()) {
        const position = t.difficulties.length;
        this.db
          .prepare(
            'INSERT INTO difficulties (id, task_id, text, raised_on, resolver, open, position) VALUES (?, ?, ?, ?, ?, 1, ?)',
          )
          .run(
            randomUUID(),
            id,
            input.newDifficulty.text.trim(),
            this.today(),
            input.newDifficulty.resolver.trim(),
            position,
          );
        parts.push(`New difficulty: ${input.newDifficulty.text.trim()}.`);
      }
      this.log(
        id,
        'Situation update',
        parts.join(' ') || 'Confirmed the situation.',
      );
    });
    return this.getTask(id);
  }

  setDifficultyOpen(taskId: string, difficultyId: string, open: boolean): Task {
    const t = this.getTask(taskId);
    const d = t.difficulties.find((x) => x.id === difficultyId);
    if (!d || d.open === open) return t;
    this.tx(() => {
      this.db
        .prepare('UPDATE difficulties SET open = ? WHERE id = ?')
        .run(open ? 1 : 0, difficultyId);
      this.db
        .prepare('UPDATE tasks SET updated_at = ? WHERE id = ?')
        .run(this.now(), taskId);
      this.log(
        taskId,
        'Difficulty',
        `${open ? 'Reopened' : 'Resolved'}: ${d.text}.`,
      );
    });
    return this.getTask(taskId);
  }

  deleteTask(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  // ------------------------------------------------------------ history

  /** Adds a history entry. The app never edits entries afterwards. */
  log(taskId: string, kind: string, text: string): void {
    this.db
      .prepare(
        'INSERT INTO activity (id, task_id, at, kind, text) VALUES (?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), taskId, this.now(), kind, text);
  }

  addNote(taskId: string, text: string): void {
    if (!text.trim()) throw new Error('The entry is empty.');
    this.log(taskId, 'Note', text.trim());
  }

  listActivity(taskId: string): ActivityEntry[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM activity WHERE task_id = ? ORDER BY at DESC, rowid DESC',
        )
        .all(taskId) as Row[]
    ).map((r) => ({
      id: str(r.id),
      taskId: str(r.task_id),
      at: str(r.at),
      kind: str(r.kind),
      text: str(r.text),
    }));
  }

  // ------------------------------------------------------------ glossary

  listGlossary(projectId?: string): GlossaryTerm[] {
    const rows = (
      projectId
        ? this.db
            .prepare(
              'SELECT * FROM glossary_terms WHERE project_id = ? ORDER BY term',
            )
            .all(projectId)
        : this.db.prepare('SELECT * FROM glossary_terms ORDER BY term').all()
    ) as Row[];
    return rows.map((r) => ({
      id: str(r.id),
      projectId: str(r.project_id),
      term: str(r.term),
      translation: str(r.translation),
      language: str(r.language) as GlossaryTerm['language'],
      note: str(r.note),
    }));
  }

  saveGlossaryTerm(
    input: Omit<GlossaryTerm, 'id'> & { id?: string },
  ): GlossaryTerm {
    const term = input.term.trim();
    const translation = input.translation.trim();
    if (!term || !translation)
      throw new Error('A glossary entry needs the term and its translation.');
    const project = this.getProject(input.projectId);
    const language =
      input.language ?? detectLanguage(term, project.originalLanguages);
    const id = input.id ?? randomUUID();
    if (input.id) {
      this.db
        .prepare(
          'UPDATE glossary_terms SET term = ?, translation = ?, language = ?, note = ? WHERE id = ?',
        )
        .run(term, translation, language, input.note.trim(), id);
    } else {
      this.db
        .prepare(
          'INSERT INTO glossary_terms (id, project_id, term, translation, language, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          input.projectId,
          term,
          translation,
          language,
          input.note.trim(),
          this.now(),
        );
    }
    return this.listGlossary(input.projectId).find((g) => g.id === id)!;
  }

  deleteGlossaryTerm(id: string): void {
    this.db.prepare('DELETE FROM glossary_terms WHERE id = ?').run(id);
  }

  // ------------------------------------------------------------ AI batches

  /** Fills in what the owner accepted from an AI batch, and records it in each task's history. */
  applyAiResults(results: AiResult[]): Task[] {
    return this.tx(() =>
      results.map((r) => {
        const t = this.getTask(r.taskId);
        const parts: string[] = [];
        const title = r.title?.trim() ? r.title.trim() : t.titleTranslation;
        const description = r.description?.trim()
          ? r.description.trim()
          : t.descriptionTranslation;
        const summary = r.summary?.trim() ? r.summary.trim() : t.summary;
        if (
          title !== t.titleTranslation ||
          description !== t.descriptionTranslation
        )
          parts.push('translation');
        if (summary !== t.summary) parts.push('summary');
        if (!parts.length) return t;
        const project = this.getProject(t.projectId);
        const state =
          t.language === project.workingLanguage
            ? 'Not needed'
            : title
              ? 'Translated'
              : t.translationState;
        this.db
          .prepare(
            'UPDATE tasks SET title_translation = ?, description_translation = ?, summary = ?, translation_state = ?, updated_at = ? WHERE id = ?',
          )
          .run(title, description, summary, state, this.now(), t.id);
        this.log(
          t.id,
          'AI batch',
          `Filled in the ${parts.join(' and ')} from a Gemini batch.`,
        );
        return this.getTask(t.id);
      }),
    );
  }
}
