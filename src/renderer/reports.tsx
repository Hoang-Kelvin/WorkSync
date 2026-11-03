import { useMemo, useState } from 'react';
import {
  LANGUAGES,
  LEVELS,
  LEVEL_NAME,
  STATUSES,
  type Level,
  type Project,
  type Status,
} from '../shared/model';
import {
  COLUMNS,
  DEFAULT_COLUMNS,
  REPORTS,
  reportTasks,
  thisWeek,
  type ReportFormat,
  type ReportKind,
  type ReportLanguage,
  type ReportOptions,
} from '../shared/reports';
import { useApp } from './appState';
import { Icon, type IconName } from './Icon';
import { Modal } from './parts';

const ICONS: Record<ReportKind, IconName> = {
  progress: 'gauge',
  taskList: 'menu',
  schedule: 'timeline',
  briefs: 'note',
};
const FORMAT_NAME: Record<ReportFormat, string> = {
  docx: 'Word',
  xlsx: 'Excel',
};
const PREPARED_KEY = 'worksync.preparedBy';

const remembered = () => {
  try {
    return localStorage.getItem(PREPARED_KEY) ?? '';
  } catch {
    return '';
  }
};

/** Reports (spec 05): choose the report, its scope, period and language, then save it. */
export function ReportDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { tasks, today, attempt, toast } = useApp();
  const week = thisWeek(today);
  const [o, setO] = useState<ReportOptions>({
    kind: 'progress',
    format: 'docx',
    projectId: project.id,
    statuses: [],
    levels: [],
    label: '',
    person: '',
    from: week.from,
    to: week.to,
    language: 'working',
    columns: DEFAULT_COLUMNS,
    includeNotes: false,
    preparedBy: remembered(),
  });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<ReportOptions>) => setO({ ...o, ...p });
  const count = useMemo(() => reportTasks(tasks, o).length, [tasks, o]);
  const labels = [
    ...new Set(
      tasks.filter((t) => t.projectId === project.id).flatMap((t) => t.labels),
    ),
  ].sort();
  const original = LANGUAGES[project.originalLanguages[0] ?? 'ja'];
  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const pick = (kind: ReportKind) =>
    set({
      kind,
      format: REPORTS[kind].formats.includes(o.format)
        ? o.format
        : REPORTS[kind].formats[0],
    });

  const make = async () => {
    try {
      localStorage.setItem(PREPARED_KEY, o.preparedBy);
    } catch {
      // Remembering the name is only a convenience.
    }
    setBusy(true);
    const r = await attempt(() => window.worksync.makeReport(o));
    setBusy(false);
    if (!r) return;
    const name = r.file.split(/[\\/]/).pop();
    toast(`Saved ${name} with ${r.tasks} task${r.tasks === 1 ? '' : 's'}.`, {
      label: 'Open',
      run: () => void attempt(() => window.worksync.openCopy(r.file, false)),
    });
    onClose();
  };

  return (
    <Modal
      title="Make a report"
      subtitle={`${project.name} · built from each task’s summary, situation and dates`}
      onClose={onClose}
      footer={
        <>
          <span
            className="muted"
            style={{ marginRight: 'auto', fontSize: 12.5 }}
          >
            {count} task{count === 1 ? '' : 's'} in this report
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || (o.kind === 'taskList' && !o.columns.length)}
            onClick={() => void make()}
          >
            <Icon name="save" />
            {busy ? 'Making…' : `Make the ${FORMAT_NAME[o.format]} report`}
          </button>
        </>
      }
    >
      <div className="report-kinds" role="radiogroup" aria-label="Report">
        {(Object.keys(REPORTS) as ReportKind[]).map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={o.kind === k}
            className="report-kind"
            onClick={() => pick(k)}
          >
            <Icon name={ICONS[k]} />
            <b>{REPORTS[k].name}</b>
            <small>{REPORTS[k].description}</small>
            <span className="fmt">
              {REPORTS[k].formats.map((f) => FORMAT_NAME[f]).join(' · ')}
            </span>
          </button>
        ))}
      </div>
      <div className="form">
        <div className="two">
          <label>
            Format
            <div className="seg-ctl" role="radiogroup" aria-label="Format">
              {REPORTS[o.kind].formats.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={o.format === f}
                  onClick={() => set({ format: f })}
                >
                  {FORMAT_NAME[f]}
                </button>
              ))}
            </div>
          </label>
          <label>
            Language
            <select
              className="inp"
              value={o.language}
              onChange={(e) =>
                set({ language: e.target.value as ReportLanguage })
              }
            >
              <option value="working">
                {LANGUAGES[project.workingLanguage]}
              </option>
              <option value="original">
                {original}, the customer’s language
              </option>
              <option value="both">Both, side by side</option>
            </select>
          </label>
        </div>
        {o.language === 'original' && (
          <p className="muted step-help">
            Titles and headings are in {original}. Your summaries and situation
            updates are in {LANGUAGES[project.workingLanguage]}, so they are
            marked as not translated.
          </p>
        )}
        {o.kind === 'progress' && (
          <div className="two">
            <label>
              Period from
              <input
                className="inp"
                type="date"
                value={o.from}
                onChange={(e) => set({ from: e.target.value })}
              />
            </label>
            <label>
              to
              <input
                className="inp"
                type="date"
                value={o.to}
                onChange={(e) => set({ to: e.target.value })}
              />
            </label>
          </div>
        )}
        <fieldset>
          <legend>Which tasks</legend>
          <div className="checks">
            {STATUSES.map((s) => (
              <label key={s} className="check">
                <input
                  type="checkbox"
                  checked={o.statuses.includes(s)}
                  onChange={() =>
                    set({ statuses: toggle<Status>(o.statuses, s) })
                  }
                />{' '}
                {s}
              </label>
            ))}
          </div>
          <div className="checks">
            {LEVELS.map((l) => (
              <label key={l} className="check">
                <input
                  type="checkbox"
                  checked={o.levels.includes(l)}
                  onChange={() => set({ levels: toggle<Level>(o.levels, l) })}
                />{' '}
                {LEVEL_NAME[l]}
              </label>
            ))}
          </div>
          <div className="two">
            <label>
              Label
              <select
                className="inp"
                value={o.label}
                onChange={(e) => set({ label: e.target.value })}
              >
                <option value="">Any label</option>
                {labels.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label>
              Assignee or handled by
              <input
                className="inp"
                value={o.person}
                onChange={(e) => set({ person: e.target.value })}
                placeholder="Anyone"
              />
            </label>
          </div>
          <span className="hint-text">
            Leave a group unticked to include all of it.
            {o.kind === 'progress'
              ? ' The progress report covers open tasks and tasks that changed in the period.'
              : ''}
          </span>
        </fieldset>
        {o.kind === 'taskList' && (
          <fieldset>
            <legend>Columns</legend>
            <div className="checks">
              {COLUMNS.filter((c) => c.key !== 'notes').map((c) => (
                <label key={c.key} className="check">
                  <input
                    type="checkbox"
                    checked={o.columns.includes(c.key)}
                    onChange={() =>
                      set({
                        columns: toggle(o.columns, c.key).sort(
                          (a, b) =>
                            COLUMNS.findIndex((x) => x.key === a) -
                            COLUMNS.findIndex((x) => x.key === b),
                        ),
                      })
                    }
                  />{' '}
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="two">
          <label>
            Prepared by
            <input
              className="inp"
              value={o.preparedBy}
              onChange={(e) => set({ preparedBy: e.target.value })}
              placeholder="Your name, shown at the top"
            />
          </label>
          <label className="check" style={{ alignSelf: 'end' }}>
            <input
              type="checkbox"
              checked={o.includeNotes}
              onChange={(e) =>
                set({
                  includeNotes: e.target.checked,
                  columns:
                    e.target.checked && o.kind === 'taskList'
                      ? [...o.columns, 'notes']
                      : o.columns.filter((c) => c !== 'notes'),
                })
              }
            />{' '}
            Include my notes
          </label>
        </div>
      </div>
    </Modal>
  );
}
