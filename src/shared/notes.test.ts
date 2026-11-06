import { describe, expect, it } from 'vitest';
import { filterNotes, linkAt, noteLinks, parseTags, type Note } from './notes';

const n = (o: Partial<Note>): Note => ({
  id: 'x',
  projectId: null,
  title: '',
  body: '',
  tags: [],
  favorite: false,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  viewedAt: null,
  ...o,
});

describe('notes', () => {
  it('finds web addresses, without the full stop after them', () => {
    const body =
      'Spec: https://example.com/spec-v2. Also (http://intra/wbs) and mail.';
    expect(noteLinks(body)).toEqual([
      'https://example.com/spec-v2',
      'http://intra/wbs',
    ]);
    expect(linkAt(body, body.indexOf('example'))).toBe(
      'https://example.com/spec-v2',
    );
    expect(linkAt(body, 2)).toBeNull();
  });
  it('reads tags typed with commas, spaces or #', () => {
    expect(parseTags('#meeting, q4  Meeting、ideas')).toEqual([
      'meeting',
      'q4',
      'ideas',
    ]);
  });
  it('filters favorites, tagged and recent, and searches text and tags', () => {
    const now = new Date('2026-11-06T00:00:00Z');
    const list = [
      n({ id: 'fav', favorite: true, updatedAt: '2026-11-05T00:00:00Z' }),
      n({ id: 'tag', tags: ['visit'], viewedAt: '2026-11-05T00:00:00Z' }),
      n({ id: 'old', body: 'Warehouse', viewedAt: '2026-09-01T00:00:00Z' }),
    ];
    expect(filterNotes(list, 'all', '', now).map((x) => x.id)).toEqual([
      'fav',
      'tag',
      'old',
    ]);
    expect(filterNotes(list, 'favorites', '', now).map((x) => x.id)).toEqual([
      'fav',
    ]);
    expect(filterNotes(list, 'tagged', '', now).map((x) => x.id)).toEqual([
      'tag',
    ]);
    expect(filterNotes(list, 'recent', '', now).map((x) => x.id)).toEqual([
      'tag',
    ]);
    expect(filterNotes(list, 'all', 'warehouse', now).map((x) => x.id)).toEqual(
      ['old'],
    );
    expect(filterNotes(list, 'all', 'visit', now).map((x) => x.id)).toEqual([
      'tag',
    ]);
  });
});
