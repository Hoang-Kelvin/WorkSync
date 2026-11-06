import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  MyPriority,
  MyStatus,
  MyTask,
  MyTaskInput,
} from '../shared/myTasks';
import { parseTags, type Note, type NoteInput } from '../shared/notes';

/**
 * The owner's own things, kept apart from projects: My tasks (and, next,
 * Notes and the Catalog).
 */

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v));
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export class Mine {
  constructor(
    private db: DatabaseSync,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  // ------------------------------------------------------------ My tasks

  private toMyTask(r: Row): MyTask {
    return {
      id: str(r.id),
      title: str(r.title),
      description: str(r.description),
      status: str(r.status) as MyStatus,
      priority: str(r.priority) as MyPriority,
      dueDate: r.due_date == null ? null : str(r.due_date),
      reminders: Number(r.reminders) === 1,
      lastReminderKey:
        r.last_reminder_key == null ? null : str(r.last_reminder_key),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
    };
  }

  listMyTasks(): MyTask[] {
    return (
      this.db
        .prepare('SELECT * FROM my_tasks ORDER BY created_at')
        .all() as Row[]
    ).map((r) => this.toMyTask(r));
  }

  getMyTask(id: string): MyTask {
    const r = this.db.prepare('SELECT * FROM my_tasks WHERE id = ?').get(id) as
      | Row
      | undefined;
    if (!r)
      throw new Error('This task was not found. It may have been completed.');
    return this.toMyTask(r);
  }

  private clean(input: Partial<MyTaskInput>, before?: MyTask): MyTaskInput {
    const v = {
      title: (input.title ?? before?.title ?? '').trim(),
      description: (input.description ?? before?.description ?? '').trim(),
      status: input.status ?? before?.status ?? 'todo',
      priority: input.priority ?? before?.priority ?? 'N',
      dueDate:
        input.dueDate === undefined
          ? (before?.dueDate ?? null)
          : input.dueDate || null,
      reminders: input.reminders ?? before?.reminders ?? true,
    };
    if (!v.title) throw new Error('A task needs a title.');
    if (!['todo', 'ongoing'].includes(v.status))
      throw new Error('The status must be Todo or On-going.');
    if (!['U', 'N', 'L'].includes(v.priority))
      throw new Error('The priority must be Urgent, Normal or Low.');
    if (v.dueDate && !ISO_DAY.test(v.dueDate))
      throw new Error('The due date is not a date.');
    return v;
  }

  /** Adds a task, or changes one when id is given. */
  saveMyTask(input: Partial<MyTaskInput>, id?: string): MyTask {
    const now = this.now();
    if (id) {
      const before = this.getMyTask(id);
      const v = this.clean(input, before);
      // A change of status or priority starts the reminders afresh.
      const resetKey =
        v.status !== before.status || v.priority !== before.priority;
      this.db
        .prepare(
          `UPDATE my_tasks SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, reminders = ?,
             last_reminder_key = CASE WHEN ? THEN NULL ELSE last_reminder_key END, updated_at = ? WHERE id = ?`,
        )
        .run(
          v.title,
          v.description,
          v.status,
          v.priority,
          v.dueDate,
          v.reminders ? 1 : 0,
          resetKey ? 1 : 0,
          now,
          id,
        );
      return this.getMyTask(id);
    }
    const v = this.clean(input);
    const newId = randomUUID();
    this.db
      .prepare(
        'INSERT INTO my_tasks (id, title, description, status, priority, due_date, reminders, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        newId,
        v.title,
        v.description,
        v.status,
        v.priority,
        v.dueDate,
        v.reminders ? 1 : 0,
        now,
        now,
      );
    return this.getMyTask(newId);
  }

  /** Completing a task deletes it; the deleted task comes back for Undo. */
  deleteMyTask(id: string): MyTask {
    const t = this.getMyTask(id);
    this.db.prepare('DELETE FROM my_tasks WHERE id = ?').run(id);
    return t;
  }

  /** Puts back a task deleted a moment ago (Undo). */
  restoreMyTask(t: MyTask): MyTask {
    const v = this.clean(t);
    this.db
      .prepare(
        'INSERT OR REPLACE INTO my_tasks (id, title, description, status, priority, due_date, reminders, last_reminder_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        t.id,
        v.title,
        v.description,
        v.status,
        v.priority,
        v.dueDate,
        v.reminders ? 1 : 0,
        t.lastReminderKey,
        t.createdAt,
        this.now(),
      );
    return this.getMyTask(t.id);
  }

  /** Records that a reminder slot was shown. */
  setReminderKey(id: string, key: string): void {
    this.db
      .prepare('UPDATE my_tasks SET last_reminder_key = ? WHERE id = ?')
      .run(key, id);
  }

  // ------------------------------------------------------------ Notes

  private toNote(r: Row): Note {
    return {
      id: str(r.id),
      projectId: r.project_id == null ? null : str(r.project_id),
      title: str(r.title),
      body: str(r.body),
      tags: JSON.parse(str(r.tags) || '[]'),
      favorite: Number(r.favorite) === 1,
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
      viewedAt: r.viewed_at == null ? null : str(r.viewed_at),
    };
  }

  listNotes(): Note[] {
    return (
      this.db
        .prepare('SELECT * FROM notes ORDER BY updated_at DESC')
        .all() as Row[]
    ).map((r) => this.toNote(r));
  }

  getNote(id: string): Note {
    const r = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as
      | Row
      | undefined;
    if (!r)
      throw new Error('This note was not found. It may have been deleted.');
    return this.toNote(r);
  }

  private checkProject(projectId: string | null) {
    if (
      projectId &&
      !this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)
    )
      throw new Error('That project no longer exists.');
  }

  /** Adds a note, or changes one when id is given. Only the parts given change. */
  saveNote(input: Partial<NoteInput>, id?: string): Note {
    const now = this.now();
    const before = id ? this.getNote(id) : null;
    const v: NoteInput = {
      projectId:
        input.projectId === undefined
          ? (before?.projectId ?? null)
          : input.projectId,
      title: (input.title ?? before?.title ?? '').slice(0, 300),
      body: input.body ?? before?.body ?? '',
      tags: parseTags((input.tags ?? before?.tags ?? []).join(',')),
      favorite: input.favorite ?? before?.favorite ?? false,
    };
    this.checkProject(v.projectId);
    if (before && id) {
      this.db
        .prepare(
          'UPDATE notes SET project_id = ?, title = ?, body = ?, tags = ?, favorite = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          v.projectId,
          v.title,
          v.body,
          JSON.stringify(v.tags),
          v.favorite ? 1 : 0,
          now,
          id,
        );
      return this.getNote(id);
    }
    const newId = randomUUID();
    this.db
      .prepare(
        'INSERT INTO notes (id, project_id, title, body, tags, favorite, created_at, updated_at, viewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        newId,
        v.projectId,
        v.title,
        v.body,
        JSON.stringify(v.tags),
        v.favorite ? 1 : 0,
        now,
        now,
        now,
      );
    return this.getNote(newId);
  }

  /** Records that a note was opened, for Recent; its change time stays. */
  viewNote(id: string): Note {
    this.db
      .prepare('UPDATE notes SET viewed_at = ? WHERE id = ?')
      .run(this.now(), id);
    return this.getNote(id);
  }

  deleteNote(id: string): Note {
    const n = this.getNote(id);
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    return n;
  }

  /** Puts back a note deleted a moment ago (Undo). */
  restoreNote(n: Note): Note {
    const projectId =
      n.projectId &&
      this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(n.projectId)
        ? n.projectId
        : null;
    this.db
      .prepare(
        'INSERT OR REPLACE INTO notes (id, project_id, title, body, tags, favorite, created_at, updated_at, viewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        n.id,
        projectId,
        n.title,
        n.body,
        JSON.stringify(parseTags(n.tags.join(','))),
        n.favorite ? 1 : 0,
        n.createdAt,
        n.updatedAt,
        n.viewedAt,
      );
    return this.getNote(n.id);
  }
}
