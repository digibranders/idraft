import { describe, expect, it } from 'vitest';

import { EVENTUS } from './internal-links-world';
import { add, change, countOf, notesAfter, remove, restore, type NoteActor } from './internal-links-notes';

const PROJECT = EVENTUS.project_id;
const PRICING = '108';
const HOME = '101';
const PRIYA: NoteActor = {
  id: '0192d1a8-5b10-7c01-9a11-000000000003',
  name: 'Priya Natarajan',
  role: 'editor',
  writes: true,
};
const MEI: NoteActor = { id: '0192d1a8-5b10-7c01-9a11-000000000005', name: 'Mei Chen', role: 'editor', writes: true };
const ADMIN: NoteActor = {
  id: '0192d1a8-5b10-7c01-9a11-000000000002',
  name: 'Tomás Rivera',
  role: 'admin',
  writes: true,
};

const listed = (page: string, actor: NoteActor = PRIYA): string[] =>
  (notesAfter(PROJECT, page, actor, null, 100)?.notes ?? []).map((note) => note.body);

describe('the notes store of the mocked API', () => {
  it('is seeded with notes on two pages, newest first', () => {
    const pricing = notesAfter(PROJECT, PRICING, PRIYA, null, 100)?.notes ?? [];
    expect(pricing).toHaveLength(3);
    const times = pricing.map((note) => Date.parse(note.created_at));
    expect(times).toEqual([...times].sort((first, second) => second - first));
    expect(pricing.some((note) => note.edited_at !== null)).toBe(true);
    expect(countOf(PROJECT, HOME)).toBe(1);
    expect(countOf(PROJECT, '110')).toBe(0);
  });

  it('adds a note first, by the caller', () => {
    const made = add(PROJECT, PRICING, MEI, '  Moved the table up.  ');
    if (!made.ok) throw new Error('refused');
    expect(made.note).toMatchObject({
      body: 'Moved the table up.',
      author: { id: MEI.id, name: MEI.name },
      edited_at: null,
    });
    expect(listed(PRICING)[0]).toBe('Moved the table up.');
    expect(countOf(PROJECT, PRICING)).toBe(4);
  });

  it('lets only the author change a note, and sets edited_at only when the body changed', () => {
    const made = add(PROJECT, PRICING, MEI, 'First');
    if (!made.ok) throw new Error('refused');
    expect(change(PROJECT, PRICING, made.note.id, PRIYA, 'Hijacked')).toEqual({ ok: false, error: 'forbidden' });
    expect(change(PROJECT, PRICING, made.note.id, ADMIN, 'Hijacked')).toEqual({ ok: false, error: 'forbidden' });
    const same = change(PROJECT, PRICING, made.note.id, MEI, 'First');
    expect(same.ok && same.note.edited_at).toBeNull();
    const changed = change(PROJECT, PRICING, made.note.id, MEI, 'Second');
    if (!changed.ok) throw new Error('refused');
    expect(changed.note.body).toBe('Second');
    expect(changed.note.edited_at).not.toBeNull();
  });

  it('hides a removed note and brings it back in its place, for the one who removed it only', () => {
    const before = listed(PRICING);
    const [, middle] = notesAfter(PROJECT, PRICING, PRIYA, null, 100)?.notes ?? [];
    if (middle === undefined) throw new Error('no second note');
    // The seed's middle note is by someone else: an admin may delete it, a plain editor may not
    expect(remove(PROJECT, PRICING, middle.id, MEI)).toEqual({ ok: false, error: 'forbidden' });
    expect(remove(PROJECT, PRICING, middle.id, ADMIN)).toEqual({ ok: true });
    expect(listed(PRICING)).toHaveLength(before.length - 1);
    expect(countOf(PROJECT, PRICING)).toBe(before.length - 1);
    expect(remove(PROJECT, PRICING, middle.id, ADMIN)).toEqual({ ok: false, error: 'not_found' });
    expect(restore(PROJECT, PRICING, middle.id, PRIYA)).toEqual({ ok: false, error: 'forbidden' });
    const back = restore(PROJECT, PRICING, middle.id, ADMIN);
    expect(back.ok).toBe(true);
    expect(listed(PRICING)).toEqual(before);
    expect(restore(PROJECT, PRICING, middle.id, ADMIN)).toEqual({ ok: false, error: 'not_found' });
  });

  it('lets the author remove their own note, and answers not found for another page or an unknown note', () => {
    const made = add(PROJECT, HOME, MEI, 'Mine');
    if (!made.ok) throw new Error('refused');
    expect(remove(PROJECT, PRICING, made.note.id, MEI)).toEqual({ ok: false, error: 'not_found' });
    expect(remove(PROJECT, HOME, '0192e4a0-0000-7000-8000-000000000000', MEI)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(remove(PROJECT, HOME, made.note.id, MEI)).toEqual({ ok: true });
  });

  it('computes can_edit and can_delete for the caller', () => {
    const notes = notesAfter(PROJECT, PRICING, ADMIN, null, 100)?.notes ?? [];
    expect(notes.every((note) => note.can_delete)).toBe(true);
    expect(notes.some((note) => note.can_edit)).toBe(true);
    expect(notes.some((note) => !note.can_edit)).toBe(true);
    const viewer = notesAfter(PROJECT, PRICING, { ...MEI, role: 'viewer', writes: false }, null, 100)?.notes ?? [];
    expect(viewer.every((note) => !note.can_edit && !note.can_delete)).toBe(true);
  });

  it('refuses an empty body, a body over 2,000 characters and a null character, and trims the rest', () => {
    expect(add(PROJECT, HOME, MEI, ' \n\t ')).toMatchObject({ ok: false, error: 'invalid' });
    expect(add(PROJECT, HOME, MEI, 'a'.repeat(2001))).toMatchObject({ ok: false, error: 'invalid' });
    expect(add(PROJECT, HOME, MEI, 'a\u0000b')).toMatchObject({ ok: false, error: 'invalid' });
    const longest = add(PROJECT, HOME, MEI, `\n${'a'.repeat(2000)}\n`);
    expect(longest.ok && longest.note.body).toBe('a'.repeat(2000));
    const crlf = add(PROJECT, HOME, MEI, 'one\r\ntwo');
    expect(crlf.ok && crlf.note.body).toBe('one\ntwo');
    // An emoji is one character, as the API counts
    expect(add(PROJECT, HOME, MEI, '\u{1F600}'.repeat(2000)).ok).toBe(true);
    expect(add(PROJECT, HOME, MEI, '\u{1F600}'.repeat(2001)).ok).toBe(false);
  });

  it('pages by a cursor that survives a removal', () => {
    const first = notesAfter(PROJECT, PRICING, PRIYA, null, 2);
    expect(first?.notes).toHaveLength(2);
    expect(first?.total).toBe(3);
    expect(first?.next).not.toBeNull();
    const [head] = first?.notes ?? [];
    if (head === undefined || first?.next === null || first?.next === undefined) throw new Error('no page');
    remove(PROJECT, PRICING, head.id, ADMIN);
    const second = notesAfter(PROJECT, PRICING, PRIYA, first.next, 2);
    expect(second?.notes).toHaveLength(1);
    expect(second?.next).toBeNull();
    expect(notesAfter(PROJECT, PRICING, PRIYA, 'nope', 2)).toBeNull();
  });
});
