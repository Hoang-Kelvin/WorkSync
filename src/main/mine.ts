import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  MyPriority,
  MyStatus,
  MyTask,
  MyTaskInput,
} from '../shared/myTasks';

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
}
