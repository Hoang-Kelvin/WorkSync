import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FileFormat, Grid } from '../shared/importRules';
import { migrate } from './db';
import { Sources, type ReadVersion } from './sources';
import { Store } from './store';

const FORMAT: FileFormat = {
  name: 'WBS',
  sheet: 'WBS',
  headerRows: [0],
  columns: { customerId: 0, title: 1, status: 2, priority: 3, plannedEnd: 4 },
  statusWords: { 未着手: 'Not started', 対応中: 'In progress', 完了: 'Done' },
  priorityWords: { 高: 'H', 中: 'N' },
};
const HEAD = ['No.', '件名', '状態', '優先度', '期限', '備考'];

const version = (grid: Grid, fp: string): ReadVersion => ({
  file: '/box/WBS.xlsx',
  grid,
  snapshot: `/data/${fp}.xlsx`,
  fingerprint: fp,
  size: 100,
  mtimeMs: 1,
  readDay: '2026-11-03',
});

let store: Store;
let sources: Sources;
let projectId: string;

beforeEach(() => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  store = new Store(db);
  sources = new Sources(db, store);
  projectId = store.createProject({
    name: 'P',
    customer: '',
    originalLanguages: ['ja', 'en'],
    workingLanguage: 'en',
  }).id;
});

const v1: Grid = [
  HEAD,
  ['1', 'ログイン', '対応中', '高', '2026/11/10', ''],
  ['2', '出荷CSV', '未着手', '中', '2026/11/20', ''],
  ['3', '帳票', '完了', '中', '2026/10/30', ''],
];

const link = () =>
  sources.link(
    {
      projectId,
      file: '/box/WBS.xlsx',
      pattern: null,
      format: FORMAT,
      mainLanguage: 'ja',
    },
    version(v1, 'a'),
  );

describe('Sources', () => {
  it('links a file and adds its rows as tasks from the file', () => {
    const r = link();
    expect(r).toMatchObject({ added: 3, skipped: 0 });
    const t = store.listTasks().find((x) => x.customerId === '1')!;
    expect(t).toMatchObject({
      source: 'file',
      fileState: 'in_file',
      status: 'In progress',
      statusWord: '対応中',
      priority: 'H',
      plannedEnd: '2026-11-10',
      sheetRow: 2,
      language: 'ja',
      translationState: 'Not translated',
      extra: {},
    });
    expect(r.source.taskCount).toBe(3);
  });

  it('refuses a format with unmapped values', () => {
    expect(() =>
      sources.link(
        {
          projectId,
          file: '/box/WBS.xlsx',
          pattern: null,
          format: { ...FORMAT, statusWords: {} },
          mainLanguage: 'ja',
        },
        version(v1, 'a'),
      ),
    ).toThrow('Map them first');
  });

  it('reviews a new version: new, changed with a conflict, and removed rows', () => {
    const { source } = link();
    const t2 = store.listTasks().find((x) => x.customerId === '2')!;
    store.updateTask(t2.id, { status: 'Done' }); // the owner's own edit
    const v2: Grid = [
      HEAD,
      ['1', 'ログイン', '完了', '高', '2026/11/10', '確認済み'],
      ['2', '出荷CSV', '対応中', '中', '2026/11/20', ''],
      ['4', '新機能', '未着手', '中', '', ''],
    ];
    const r = sources.review(source.id, version(v2, 'b'));
    expect(r.added.map((x) => x.customerId)).toEqual(['4']);
    expect(r.removed.map((x) => x.customerId)).toEqual(['3']);
    const c1 = r.changed.find((x) => x.customerId === '1')!;
    expect(c1.changes.map((c) => [c.field, c.from, c.to, c.conflict])).toEqual([
      ['statusWord', '対応中', '完了', false],
      ['extra:備考', '', '確認済み', false],
    ]);
    const c2 = r.changed.find((x) => x.customerId === '2')!;
    expect(c2.changes[0]).toMatchObject({
      field: 'statusWord',
      from: '未着手',
      to: '対応中',
      conflict: true,
      appValue: 'Done',
    });

    const applied = sources.apply(source.id, version(v2, 'b'), {
      byTitle: false,
      addRows: [4],
      change: [
        { taskId: c1.taskId, keepMine: [] },
        { taskId: c2.taskId, keepMine: ['statusWord'] },
      ],
      removeTaskIds: r.removed.map((x) => x.taskId),
    });
    expect(applied).toEqual({ added: 1, changed: 2, removed: 1 });
    const after = Object.fromEntries(
      store.listTasks().map((t) => [t.customerId, t]),
    );
    expect(after['1']).toMatchObject({
      status: 'Done',
      statusWord: '完了',
      extra: { 備考: '確認済み' },
    });
    expect(after['2'].status).toBe('Done'); // the owner kept their value
    expect(after['3'].fileState).toBe('removed');
    expect(after['4']).toMatchObject({
      source: 'file',
      titleOriginal: '新機能',
    });
    expect(store.listActivity(after['1'].id)[0].text).toBe(
      'From WBS.xlsx: Status 対応中 → 完了; 備考 (empty) → 確認済み.',
    );

    // Applied changes do not come back; the kept conflict is now the baseline.
    const again = sources.review(source.id, version(v2, 'b'));
    expect([
      again.added.length,
      again.changed.length,
      again.removed.length,
    ]).toEqual([0, 0, 0]);
  });

  it('marks a title change for translation review and brings a removed row back', () => {
    const { source } = link();
    const t1 = store.listTasks().find((x) => x.customerId === '1')!;
    store.updateTask(t1.id, { titleTranslation: 'Login' });
    const v2: Grid = [
      HEAD,
      ['1', 'ログイン画面', '対応中', '高', '2026/11/10', ''],
      ['2', '出荷CSV', '未着手', '中', '2026/11/20', ''],
    ];
    const r = sources.review(source.id, version(v2, 'b'));
    sources.apply(source.id, version(v2, 'b'), {
      byTitle: false,
      addRows: [],
      change: r.changed.map((c) => ({ taskId: c.taskId, keepMine: [] })),
      removeTaskIds: r.removed.map((x) => x.taskId),
    });
    expect(store.getTask(t1.id).translationState).toBe('Needs review');
    const t3 = store.listTasks().find((x) => x.customerId === '3')!;
    expect(t3.fileState).toBe('removed');

    const back = sources.review(source.id, version(v1, 'c'));
    const ret = back.changed.find((c) => c.customerId === '3')!;
    expect(ret.changes[0].field).toBe('extra:Back in the file');
    sources.apply(source.id, version(v1, 'c'), {
      byTitle: false,
      addRows: [],
      change: [{ taskId: ret.taskId, keepMine: [] }],
      removeTaskIds: [],
    });
    expect(store.getTask(t3.id).fileState).toBe('in_file');
  });

  it('keeps the last ten snapshots', () => {
    const { source } = link();
    for (let i = 0; i < 12; i++)
      sources.apply(source.id, version(v1, `v${i}`), {
        byTitle: false,
        addRows: [],
        change: [],
        removeTaskIds: [],
      });
    expect(sources.oldSnapshots(source.id)).toHaveLength(3);
    expect(sources.oldSnapshots(source.id)).toHaveLength(0);
  });
});
