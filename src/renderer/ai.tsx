import { useEffect, useMemo, useState } from 'react';
import type { Batch, ReadAnswer } from '../shared/aiBatch';
import {
  LANGUAGES,
  detectLanguage,
  isClosed,
  type GlossaryTerm,
  type LanguageCode,
  type Project,
  type Task,
} from '../shared/model';
import { useApp } from './appState';
import { Icon } from './Icon';
import { Modal } from './parts';

/** The batches prepared in this session, kept so Paste from AI can come later. */
export interface AiSession {
  projectId: string;
  batches: Batch[];
  /** The batch being worked on. */
  index: number;
  /** Batches whose answers were applied. */
  done: number[];
}

const needsWork = (t: Task) =>
  t.translationState === 'Not translated' ||
  t.translationState === 'Needs review';

/**
 * Copy for AI and Paste from AI (spec 03, Gemini batches). The request is
 * built in the main process; this screen chooses the tasks, copies each batch
 * and checks the pasted answer before anything is filled in.
 */
export function AiDialog({
  project,
  session,
  setSession,
  startAt,
  preselect,
  onClose,
}: {
  project: Project;
  session: AiSession | null;
  setSession: (s: AiSession | null) => void;
  startAt: 'choose' | 'paste';
  /** Tasks chosen elsewhere, such as rows selected in the Tasks table. */
  preselect?: string[];
  onClose: () => void;
}) {
  const { tasks, attempt, toast, putTask } = useApp();
  const projectTasks = tasks.filter(
    (t) => t.projectId === project.id && t.fileState !== 'removed',
  );
  const [showAll, setShowAll] = useState(!!preselect?.length);
  const candidates = projectTasks.filter(
    (t) =>
      t.translationState !== 'Not needed' &&
      (showAll || needsWork(t) || !t.summary),
  );
  const [picked, setPicked] = useState<Set<string>>(() =>
    preselect?.length
      ? new Set(preselect)
      : new Set(
          projectTasks
            .filter((t) => needsWork(t) && !isClosed(t))
            .map((t) => t.id),
        ),
  );
  const [step, setStep] = useState<'choose' | 'copy' | 'paste'>(
    session && startAt === 'paste' ? 'paste' : 'choose',
  );
  const [answer, setAnswer] = useState('');
  const [read, setRead] = useState<ReadAnswer | null>(null);
  const [accept, setAccept] = useState<Set<string>>(new Set());
  const [useSummary, setUseSummary] = useState<Set<string>>(new Set());
  const batch = session?.batches[session.index];
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const prepare = async () => {
    const ids = candidates.filter((t) => picked.has(t.id)).map((t) => t.id);
    const batches = await attempt(() =>
      window.worksync.prepareAiBatches(project.id, ids),
    );
    if (!batches) return;
    setSession({ projectId: project.id, batches, index: 0, done: [] });
    setStep('copy');
  };

  const copy = async () => {
    if (!batch) return;
    const ok = await attempt(async () => {
      await window.worksync.copyText(batch.text);
      return true;
    });
    if (ok)
      toast(
        `Request ${batch.number} of ${batch.of} copied. Paste it into Gemini.`,
      );
  };

  const readIt = async () => {
    if (!batch) return;
    const r = await attempt(() => window.worksync.readAiAnswer(batch, answer));
    if (!r) return;
    setRead(r);
    setAccept(new Set(r.items.filter((i) => i.title).map((i) => i.taskId)));
    setUseSummary(
      new Set(
        r.items
          .filter((i) => i.summary && !byId.get(i.taskId)?.summary)
          .map((i) => i.taskId),
      ),
    );
  };

  const apply = async () => {
    if (!read || !session) return;
    const results = read.items
      .filter((i) => accept.has(i.taskId))
      .map((i) => ({
        taskId: i.taskId,
        title: i.title,
        description: i.description,
        summary: useSummary.has(i.taskId) ? i.summary : undefined,
      }));
    const updated = await attempt(() =>
      window.worksync.applyAiResults(results),
    );
    if (!updated) return;
    updated.forEach(putTask);
    const done = [...session.done, session.index];
    const next = session.batches.findIndex((_, k) => !done.includes(k));
    toast(
      `Filled in ${updated.length} task${updated.length === 1 ? '' : 's'}. You can still edit each one.`,
    );
    setAnswer('');
    setRead(null);
    if (next < 0) {
      setSession(null);
      onClose();
    } else {
      setSession({ ...session, index: next, done });
      setStep('copy');
    }
  };

  const working = LANGUAGES[project.workingLanguage];
  const footer =
    step === 'choose' ? (
      <>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!candidates.some((t) => picked.has(t.id))}
          onClick={() => void prepare()}
        >
          Prepare the request
        </button>
      </>
    ) : step === 'copy' ? (
      <>
        <button className="btn" onClick={() => setStep('choose')}>
          Choose other tasks
        </button>
        <button className="btn" onClick={() => setStep('paste')}>
          Paste the answer
        </button>
        <button className="btn primary" onClick={() => void copy()}>
          <Icon name="copy" />
          Copy request
          {batch && batch.of > 1 ? ` ${batch.number} of ${batch.of}` : ''}
        </button>
      </>
    ) : (
      <>
        <button className="btn" onClick={() => setStep('copy')}>
          Back to the request
        </button>
        {!read ? (
          <button
            className="btn primary"
            disabled={!answer.trim()}
            onClick={() => void readIt()}
          >
            Read the answer
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={!accept.size}
            onClick={() => void apply()}
          >
            <Icon name="check" />
            Fill in {accept.size} task{accept.size === 1 ? '' : 's'}
          </button>
        )}
      </>
    );

  return (
    <Modal
      title={step === 'paste' ? 'Paste from AI' : 'Copy for AI'}
      subtitle={
        step === 'choose'
          ? `${project.name} · choose the tasks to translate into ${working} and summarize`
          : step === 'copy'
            ? 'Paste this request into the Gemini web app, then paste its answer back here.'
            : 'Paste Gemini’s whole answer. WorkSync checks every task against the request.'
      }
      onClose={onClose}
      footer={footer}
    >
      {step === 'choose' && (
        <>
          <div className="ai-pick-head">
            <span className="muted">
              {candidates.filter((t) => picked.has(t.id)).length} of{' '}
              {candidates.length} selected
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button
                className="linkbtn"
                onClick={() => setPicked(new Set(candidates.map((t) => t.id)))}
              >
                Select all
              </button>
              <button className="linkbtn" onClick={() => setPicked(new Set())}>
                Clear
              </button>
              <label className="check">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                />{' '}
                Show translated tasks too
              </label>
            </span>
          </div>
          <div className="review-list">
            {candidates.length ? (
              candidates.map((t) => (
                <label key={t.id} className="diff-row">
                  <input
                    type="checkbox"
                    checked={picked.has(t.id)}
                    onChange={() => {
                      const n = new Set(picked);
                      if (n.has(t.id)) n.delete(t.id);
                      else n.add(t.id);
                      setPicked(n);
                    }}
                  />
                  <div>
                    <span className="tid">
                      No. {t.customerId} · {LANGUAGES[t.language]} ·{' '}
                      {t.translationState}
                      {!t.summary ? ' · no summary' : ''}
                    </span>
                    <div
                      className="title"
                      style={{ fontSize: 14 }}
                      lang={t.language}
                    >
                      {t.titleOriginal}
                    </div>
                  </div>
                </label>
              ))
            ) : (
              <p className="muted">
                Every task is translated and summarized. Tick “Show translated
                tasks too” to do some again.
              </p>
            )}
          </div>
        </>
      )}

      {step === 'copy' && batch && (
        <>
          <div className="batch-stats">
            <span className="chip">
              {Object.keys(batch.keys).length} task
              {Object.keys(batch.keys).length === 1 ? '' : 's'}
            </span>
            <span className="chip">→ {working}</span>
            <span className="chip">
              {batch.text.length.toLocaleString()} characters · batch{' '}
              {batch.number} of {batch.of}
            </span>
            {session && session.done.length > 0 && (
              <span className="chip">{session.done.length} done</span>
            )}
          </div>
          <pre className="prompt" tabIndex={0}>
            {batch.text}
          </pre>
          <ol className="how">
            <li>
              Copy the request and paste it into a new chat in the Gemini web
              app.
            </li>
            <li>When Gemini has answered, copy its whole answer.</li>
            <li>
              Come back and choose Paste the answer, or Paste from AI in the top
              bar.
            </li>
          </ol>
        </>
      )}

      {step === 'paste' && batch && (
        <>
          {!read ? (
            <label className="form-inline">
              Gemini’s answer for batch {batch.number} of {batch.of}
              <textarea
                className="inp mono"
                rows={12}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={
                  '=== TASK 012 ===\nTITLE: …\nSUMMARY: …\n=== END ==='
                }
                autoFocus
              />
            </label>
          ) : (
            <>
              <div className="batch-stats">
                <span className="chip">
                  {read.items.length} of {Object.keys(batch.keys).length} found
                </span>
                {read.missing.length > 0 && (
                  <span className="chip over">
                    Missing: {read.missing.join(', ')}
                  </span>
                )}
                {read.unknown.length > 0 && (
                  <span className="chip">
                    Not in the request: {read.unknown.join(', ')}
                  </span>
                )}
                <button className="linkbtn" onClick={() => setRead(null)}>
                  Paste again
                </button>
              </div>
              {read.items.length === 0 && (
                <p className="muted">
                  No tasks in the expected format. Each task should start with a
                  line like === TASK 012 === and end with === END ===. Check
                  that you copied Gemini’s whole answer.
                </p>
              )}
              {read.missing.length > 0 && read.items.length > 0 && (
                <p className="muted">
                  Missing tasks stay as they are. Ask Gemini for them again, or
                  prepare a new request with them.
                </p>
              )}
              <div className="review-list">
                {read.items.map((i) => {
                  const t = byId.get(i.taskId);
                  if (!t) return null;
                  return (
                    <div className="diff-row" key={i.taskId}>
                      <input
                        type="checkbox"
                        checked={accept.has(i.taskId)}
                        disabled={!i.title}
                        aria-label={`Fill in No. ${t.customerId}`}
                        onChange={() => {
                          const n = new Set(accept);
                          if (n.has(i.taskId)) n.delete(i.taskId);
                          else n.add(i.taskId);
                          setAccept(n);
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <span className="tid">No. {t.customerId}</span>
                        <div className="orig" lang={t.language}>
                          {t.titleOriginal}
                        </div>
                        {i.title ? (
                          <div className="chg">
                            Title:{' '}
                            {t.titleTranslation && (
                              <span className="old">{t.titleTranslation}</span>
                            )}
                            {t.titleTranslation && (
                              <span className="arrow">→</span>
                            )}
                            <span className="new">{i.title}</span>
                          </div>
                        ) : (
                          <div className="chg">
                            No title in the answer, so this task is left as it
                            is.
                          </div>
                        )}
                        {i.summary && (
                          <label className="chg ai-sum">
                            <input
                              type="checkbox"
                              checked={useSummary.has(i.taskId)}
                              onChange={() => {
                                const n = new Set(useSummary);
                                if (n.has(i.taskId)) n.delete(i.taskId);
                                else n.add(i.taskId);
                                setUseSummary(n);
                              }}
                            />{' '}
                            {t.summary
                              ? 'Replace your summary with: '
                              : 'Summary: '}
                            <span className="new">{i.summary}</span>
                          </label>
                        )}
                        {i.description && (
                          <details className="skipped">
                            <summary>
                              Description,{' '}
                              {i.description.split(/\n\s*\n/).length}{' '}
                              paragraph(s)
                            </summary>
                            <div className="ai-desc">{i.description}</div>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
      {(step === 'copy' || step === 'paste') && !batch && (
        <p className="muted">Nothing prepared yet. Choose tasks first.</p>
      )}
    </Modal>
  );
}

/** The project glossary: terms with their preferred translation, used in every request. */
export function GlossaryDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { attempt, toast, reloadGlossary } = useApp();
  const [terms, setTerms] = useState<GlossaryTerm[] | null>(null);
  const [draft, setDraft] = useState({ term: '', translation: '', note: '' });
  const load = async () => {
    setTerms(
      (await attempt(() => window.worksync.listGlossary(project.id))) ?? [],
    );
    await reloadGlossary();
  };
  useEffect(() => {
    void load();
    // Load once when the dialog opens.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const add = async () => {
    const language: LanguageCode = detectLanguage(
      draft.term,
      project.originalLanguages,
    );
    const g = await attempt(() =>
      window.worksync.saveGlossaryTerm({
        projectId: project.id,
        language,
        ...draft,
      }),
    );
    if (g) {
      setDraft({ term: '', translation: '', note: '' });
      await load();
      toast(`Added ${g.term} to the glossary.`);
    }
  };
  const save = async (g: GlossaryTerm) => {
    await attempt(() => window.worksync.saveGlossaryTerm(g));
    await reloadGlossary();
  };
  const remove = async (g: GlossaryTerm) => {
    await attempt(() => window.worksync.deleteGlossaryTerm(g.id));
    await load();
  };
  return (
    <Modal
      title="Glossary"
      subtitle={`${project.name} · Gemini batches use these translations exactly`}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <form
        className="glossary-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="inp"
          placeholder="Term, such as 受入テスト"
          value={draft.term}
          onChange={(e) => setDraft({ ...draft, term: e.target.value })}
          aria-label="Term"
        />
        <input
          className="inp"
          placeholder={`In ${LANGUAGES[project.workingLanguage]}, such as acceptance test`}
          value={draft.translation}
          onChange={(e) => setDraft({ ...draft, translation: e.target.value })}
          aria-label="Translation"
        />
        <input
          className="inp"
          placeholder="Note (optional)"
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          aria-label="Note"
        />
        <button
          className="btn"
          type="submit"
          disabled={!draft.term.trim() || !draft.translation.trim()}
        >
          <Icon name="plus" />
          Add
        </button>
      </form>
      {terms && terms.length > 0 ? (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Term</th>
                <th>Translation</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {terms.map((g, k) => (
                <tr key={g.id}>
                  <td lang={g.language}>{g.term}</td>
                  <td>
                    <input
                      className="inp"
                      value={g.translation}
                      aria-label={`Translation of ${g.term}`}
                      onChange={(e) =>
                        setTerms(
                          terms.map((x, j) =>
                            j === k ? { ...x, translation: e.target.value } : x,
                          ),
                        )
                      }
                      onBlur={() => void save(terms[k])}
                    />
                  </td>
                  <td>
                    <input
                      className="inp"
                      value={g.note}
                      aria-label={`Note for ${g.term}`}
                      onChange={(e) =>
                        setTerms(
                          terms.map((x, j) =>
                            j === k ? { ...x, note: e.target.value } : x,
                          ),
                        )
                      }
                      onBlur={() => void save(terms[k])}
                    />
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      aria-label={`Delete ${g.term}`}
                      onClick={() => void remove(g)}
                    >
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        terms && (
          <p className="muted">
            No terms yet. Add the technical words the customer uses, so
            translations stay the same everywhere.
          </p>
        )
      )}
    </Modal>
  );
}
