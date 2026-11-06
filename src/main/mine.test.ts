import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './db';
import { Mine } from './mine';

let mine: Mine;
beforeEach(() => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  mine = new Mine(db, () => '2026-11-06T01:00:00.000Z');
});

describe('My tasks', () => {
  it('adds, changes, completes and puts back a task', () => {
    const a = mine.saveMyTask({
      title: '  Renew the pass ',
      dueDate: '2026-11-06',
    });
    expect(a).toMatchObject({
      title: 'Renew the pass',
      status: 'todo',
      priority: 'N',
      reminders: true,
    });
    mine.setReminderKey(a.id, '20261106-morning');
    // A new priority starts the reminders afresh; a new title doesn't.
    expect(
      mine.saveMyTask({ title: 'Renew the commuter pass' }, a.id)
        .lastReminderKey,
    ).toBe('20261106-morning');
    const b = mine.saveMyTask({ priority: 'U' }, a.id);
    expect(b).toMatchObject({
      priority: 'U',
      lastReminderKey: null,
      title: 'Renew the commuter pass',
    });
    const gone = mine.deleteMyTask(a.id);
    expect(mine.listMyTasks()).toHaveLength(0);
    expect(mine.restoreMyTask(gone)).toMatchObject({
      id: a.id,
      title: 'Renew the commuter pass',
    });
  });
  it('refuses a task without a title or with a wrong value', () => {
    expect(() => mine.saveMyTask({ title: ' ' })).toThrow(/needs a title/);
    expect(() => mine.saveMyTask({ title: 'x', dueDate: '6 Nov' })).toThrow(
      /not a date/,
    );
    expect(() =>
      mine.saveMyTask({ title: 'x', priority: 'H' as never }),
    ).toThrow(/Urgent, Normal or Low/);
  });
});

describe('Notes', () => {
  it('keeps a project note when the project is deleted, as a note on its own', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    const m = new Mine(db, () => '2026-11-06T01:00:00.000Z');
    db.prepare(
      "INSERT INTO projects (id, name, customer, original_languages, working_language, views, due_soon_days, created_at) VALUES ('p', 'Portal', '', '[\"ja\"]', 'en', '{}', 7, '2026-11-01')",
    ).run();
    const n = m.saveNote({
      title: 'Minutes',
      body: 'See https://example.com/spec.',
      projectId: 'p',
      tags: ['#meeting', 'Meeting', 'q4'],
    });
    expect(n).toMatchObject({ projectId: 'p', tags: ['meeting', 'q4'] });
    db.prepare("DELETE FROM projects WHERE id = 'p'").run();
    expect(m.getNote(n.id).projectId).toBeNull();
    expect(() => m.saveNote({ projectId: 'gone' }, n.id)).toThrow(
      /no longer exists/,
    );
  });
  it('changes only what is given, and puts a deleted note back', () => {
    const n = mine.saveNote({ title: 'A', body: 'one' });
    const u = mine.saveNote({ body: 'two' }, n.id);
    expect(u).toMatchObject({ title: 'A', body: 'two', favorite: false });
    const gone = mine.deleteNote(n.id);
    expect(mine.listNotes()).toHaveLength(0);
    expect(mine.restoreNote(gone).body).toBe('two');
  });
});
