import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, backupDaily, migrate } from './db';
import { Store } from './store';
import type { TaskInput } from '../shared/model';

const input = (o: Partial<TaskInput> = {}): TaskInput => ({
  customerId: '',
  titleOriginal: 'ログイン画面のタイムアウト',
  titleTranslation: '',
  descriptionOriginal: '',
  descriptionTranslation: '',
  summary: '',
  notes: '',
  status: 'Not started',
  priority: 'N',
  labels: [],
  assignee: '',
  category: '',
  remarks: '',
  plannedStart: null,
  plannedEnd: null,
  actualStart: null,
  actualEnd: null,
  nextAction: '',
  nextActionDate: null,
  ...o,
});

let store: Store;
let db: DatabaseSync;
let clock = '2026-11-03T09:00:00.000Z';

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  store = new Store(db, () => clock);
});

const project = () =>
  store.createProject({
    name: 'Portal',
    customer: 'Hoshizora',
    originalLanguages: ['ja', 'en'],
    workingLanguage: 'en',
  });

describe('Store', () => {
  it('creates projects with the default views and Focus always on', () => {
    const p = project();
    expect(
      p.views.focus && p.views.board && p.views.dashboard && p.views.files,
    ).toBe(true);
    const q = store.updateProject(p.id, {
      views: { board: false, focus: false },
    });
    expect(q.views.board).toBe(false);
    expect(q.views.focus).toBe(true);
  });

  it('numbers hand-added tasks, detects their language and sets the translation state', () => {
    const p = project();
    const a = store.createTask(p.id, input());
    const b = store.createTask(
      p.id,
      input({ titleOriginal: 'Gateway firmware update plan' }),
    );
    expect([a.customerId, b.customerId]).toEqual(['001', '002']);
    expect(a.language).toBe('ja');
    expect(a.translationState).toBe('Not translated');
    expect(b.language).toBe('en');
    expect(b.translationState).toBe('Not needed');
    expect(
      store.updateTask(a.id, { titleTranslation: 'Login screen times out' })
        .translationState,
    ).toBe('Translated');
  });

  it('rejects a task without a title', () => {
    expect(() =>
      store.createTask(project().id, input({ titleOriginal: '  ' })),
    ).toThrow('needs a title');
  });

  it('records what changed in the history, newest first', () => {
    const t = store.createTask(project().id, input());
    clock = '2026-11-03T10:00:00.000Z';
    store.updateTask(t.id, { status: 'In progress' });
    clock = '2026-11-03T11:00:00.000Z';
    store.updateTask(t.id, { summary: 'x', labels: ['Auth', ' Auth ', ''] });
    const h = store.listActivity(t.id).map((e) => e.text);
    expect(h).toEqual([
      'Changed Summary, Labels.',
      'Status Not started → In progress.',
      'Added by hand.',
    ]);
    expect(store.getTask(t.id).labels).toEqual(['Auth']);
    store.updateTask(t.id, { summary: 'x' });
    expect(store.listActivity(t.id)).toHaveLength(3);
  });

  it('carries the situation forward and keeps difficulties', () => {
    const t = store.createTask(project().id, input());
    store.addSituationUpdate(t.id, {
      handledBy: 'Yamada',
      doingNow: 'Reproducing',
      waitingOn: 'Customer',
    });
    clock = '2026-11-05T09:00:00.000Z';
    const u = store.addSituationUpdate(t.id, {
      nextStep: 'Send logs',
      newDifficulty: { text: 'No access', resolver: 'Customer IT' },
    });
    expect(u.situation).toMatchObject({
      handledBy: 'Yamada',
      doingNow: 'Reproducing',
      waitingOn: 'Customer',
      nextStep: 'Send logs',
      asOf: '2026-11-05',
    });
    expect(u.difficulties).toHaveLength(1);
    const r = store.setDifficultyOpen(t.id, u.difficulties[0].id, false);
    expect(r.difficulties[0].open).toBe(false);
  });

  it('treats an override equal to the task level as no override', () => {
    const t = store.createTask(project().id, input({ priority: 'N' }));
    expect(store.setPriorityOverride(t.id, 'U').priorityOverride).toBe('U');
    expect(store.setPriorityOverride(t.id, 'N').priorityOverride).toBeNull();
  });

  it('deletes a task with its history', () => {
    const t = store.createTask(project().id, input());
    store.deleteTask(t.id);
    expect(store.listTasks()).toHaveLength(0);
    expect(store.listActivity(t.id)).toHaveLength(0);
  });
});

describe('Tasks table', () => {
  it('applies one change to several tasks, each with its own history', () => {
    const p = project();
    const a = store.createTask(p.id, input({ labels: ['Auth'] }));
    const b = store.createTask(p.id, input({ labels: ['auth', 'UI'] }));
    const f = store.createTask(p.id, input({ priority: 'L' }));
    const out = store.bulkUpdate([a.id, b.id, f.id], {
      addLabel: 'Release 2',
      removeLabel: 'AUTH',
      status: 'In progress',
      pinned: true,
    });
    expect(out.map((t) => t.labels)).toEqual([
      ['Release 2'],
      ['UI', 'Release 2'],
      ['Release 2'],
    ]);
    expect(out.every((t) => t.status === 'In progress' && t.pinned)).toBe(true);
    // Priority is never changed in bulk.
    expect(out[2]).toMatchObject({ priority: 'L', priorityOverride: null });
    expect(store.listActivity(b.id)[0].text).toMatch(/Changed/);
  });

  it('rolls the whole change back when one task fails', () => {
    const p = project();
    const a = store.createTask(p.id, input());
    expect(() =>
      store.bulkUpdate([a.id, 'missing'], { status: 'Done' }),
    ).toThrow();
    expect(store.getTask(a.id).status).toBe('Not started');
  });

  it('remembers the table settings per project', () => {
    const p = project();
    expect(p.tableSettings).toBeNull();
    const s = {
      columns: ['id', 'title'],
      sort: { key: 'plannedEnd', dir: 'desc' as const },
      filters: { status: 'On hold' },
    };
    expect(store.setTableSettings(p.id, s).tableSettings).toEqual(s);
    expect(store.setTableSettings(p.id, null).tableSettings).toBeNull();
  });
});

describe('glossary and AI batches', () => {
  it('keeps glossary terms per project with their language', () => {
    const p = project();
    const g = store.saveGlossaryTerm({
      projectId: p.id,
      term: '受入テスト',
      translation: 'acceptance test',
      note: '',
      language: 'ja',
    });
    store.saveGlossaryTerm({ ...g, translation: 'user acceptance test' });
    expect(
      store.listGlossary(p.id).map((x) => [x.term, x.translation, x.language]),
    ).toEqual([['受入テスト', 'user acceptance test', 'ja']]);
    expect(() =>
      store.saveGlossaryTerm({
        projectId: p.id,
        term: 'x',
        translation: ' ',
        note: '',
        language: 'ja',
      }),
    ).toThrow('needs the term');
    store.deleteGlossaryTerm(g.id);
    expect(store.listGlossary(p.id)).toHaveLength(0);
  });

  it('fills in accepted translations and summaries, and records it', () => {
    const p = project();
    const t = store.createTask(p.id, input());
    const kept = store.createTask(p.id, input({ summary: 'Mine' }));
    const [a, b] = store.applyAiResults([
      {
        taskId: t.id,
        title: 'Login screen times out',
        description: 'Para 1\n\nPara 2',
        summary: 'Sessions expire too early.',
      },
      { taskId: kept.id, title: 'Second', summary: '' },
    ]);
    expect(a).toMatchObject({
      titleTranslation: 'Login screen times out',
      descriptionTranslation: 'Para 1\n\nPara 2',
      summary: 'Sessions expire too early.',
      translationState: 'Translated',
    });
    expect(b.summary).toBe('Mine');
    expect(store.listActivity(t.id)[0]).toMatchObject({
      kind: 'AI batch',
      text: 'Filled in the translation and summary from a Gemini batch.',
    });
  });
});

describe('backups', () => {
  it('writes one backup a day and keeps the last 14', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worksync-backup-'));
    const file = path.join(dir, 'w.db');
    const disk = new DatabaseSync(file);
    migrate(disk);
    for (let d = 1; d <= 16; d++)
      backupDaily(
        disk,
        path.join(dir, 'b'),
        `2026-10-${String(d).padStart(2, '0')}`,
      );
    expect(backupDaily(disk, path.join(dir, 'b'), '2026-10-16')).toBeNull();
    const kept = fs.readdirSync(path.join(dir, 'b')).sort();
    expect(kept).toHaveLength(14);
    expect(kept[0]).toBe('worksync-2026-10-03.db');
    const copy = new DatabaseSync(path.join(dir, 'b', kept[13]));
    expect(
      (copy.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version,
    ).toBe(SCHEMA_VERSION);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
