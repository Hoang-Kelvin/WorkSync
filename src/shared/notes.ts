/** Notes: the owner's notes, on their own or attached to a project. */

export interface Note {
  id: string;
  /** The project it belongs to, or null for a note on its own. */
  projectId: string | null;
  title: string;
  body: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  /** When it was last opened, for Recent. */
  viewedAt: string | null;
}

export type NoteInput = Pick<
  Note,
  'projectId' | 'title' | 'body' | 'tags' | 'favorite'
>;

export type NoteFilter = 'all' | 'favorites' | 'recent' | 'tagged';

/** A note opened in the last two weeks counts as recent. */
export const RECENT_DAYS = 14;

const URL_RE = /\bhttps?:\/\/[^\s<>"'）」』】]+/gi;

/** The web addresses in a note's text, as they open with one click. */
export function noteLinks(body: string): string[] {
  const found = body.match(URL_RE) ?? [];
  // Trailing punctuation usually ends the sentence, not the address.
  const clean = found.map((u) => u.replace(/[.,;:!?)\]]+$/, ''));
  return [...new Set(clean)];
}

/** The address under a position in the text, for Ctrl+click in the editor. */
export function linkAt(body: string, index: number): string | null {
  for (const m of body.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    const start = m.index ?? 0;
    if (index >= start && index <= start + url.length) return url;
  }
  return null;
}

/** Tags from what the owner typed: separated by commas or spaces, without #, each once. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\s、，]+/)) {
    const t = raw.replace(/^#+/, '').trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** The notes a filter and a search show, newest change first (Recent: newest opened). */
export function filterNotes(
  notes: Note[],
  filter: NoteFilter,
  query: string,
  now: Date,
): Note[] {
  const q = query.trim().toLowerCase();
  const since = new Date(now.getTime() - RECENT_DAYS * 86400000).toISOString();
  const list = notes.filter(
    (n) =>
      (filter === 'all' ||
        (filter === 'favorites' && n.favorite) ||
        (filter === 'tagged' && n.tags.length > 0) ||
        (filter === 'recent' && !!n.viewedAt && n.viewedAt >= since)) &&
      (!q ||
        `${n.title}\n${n.body}\n${n.tags.join(' ')}`.toLowerCase().includes(q)),
  );
  return list.sort((a, b) =>
    filter === 'recent'
      ? (b.viewedAt ?? '').localeCompare(a.viewedAt ?? '')
      : b.updatedAt.localeCompare(a.updatedAt) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
  );
}
