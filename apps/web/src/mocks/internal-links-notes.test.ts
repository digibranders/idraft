import { describe, expect, it } from 'vitest';

import { MOCK_WORKSPACE } from './fixtures';
import { EVENTUS } from './internal-links-world';
import {
  add,
  change,
  countOf,
  fileOf,
  notesAfter,
  remove,
  resetNotes,
  restore,
  setNoteFileLimit,
  uploadFile,
  type NoteActor,
  type NoteUpload,
} from './internal-links-notes';
import type { PageNote, PageNoteFile } from '@/lib/internal-links/types';

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
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

  it('holds no mention and no file on a note that sends none', () => {
    const made = add(PROJECT, PRICING, MEI, 'Plain');
    expect(made.ok && made.note.mentions).toEqual([]);
    expect(made.ok && made.note.attachments).toEqual([]);
  });

  describe('mentions', () => {
    const page = { type: 'page', label: '@/pricing', target: '108' };
    const mate = { type: 'user', label: '@Priya Natarajan', target: PRIYA.id };
    /** A page entry as a note shows it: with the page's current path. */
    const shownPage = { ...page, path: '/pricing' };

    it('keeps the ones whose label is in the text, once per label', () => {
      const made = add(PROJECT, PRICING, MEI, 'See @/pricing and @/pricing', [page, page, mate]);
      expect(made.ok && made.note.mentions).toEqual([shownPage]);
    });

    it('drops a mention whose label an edit removed, and keeps the rest when none are sent', () => {
      const made = add(PROJECT, PRICING, MEI, 'See @/pricing and @Priya Natarajan', [page, mate]);
      if (!made.ok) throw new Error('refused');
      const changed = change(PROJECT, PRICING, made.note.id, MEI, 'Only @/pricing now');
      expect(changed.ok && changed.note.mentions).toEqual([shownPage]);
    });

    it('takes the list a change sends instead of the stored one', () => {
      const made = add(PROJECT, PRICING, MEI, 'See @/pricing', [page]);
      if (!made.ok) throw new Error('refused');
      const changed = change(PROJECT, PRICING, made.note.id, MEI, 'Ask @Priya Natarajan', [mate]);
      expect(changed.ok && changed.note.mentions).toEqual([mate]);
    });

    it('refuses an issue and names the entry', () => {
      const issue = { type: 'issue', label: '@Missing title', target: 'title_missing' };
      expect(add(PROJECT, PRICING, MEI, 'Fix @Missing title', [page, issue])).toMatchObject({
        ok: false,
        error: 'invalid',
        field: { path: 'mentions[1].type', code: 'mention_type_unavailable' },
      });
      // Not in the text: dropped before it is judged, as the API does
      expect(add(PROJECT, PRICING, MEI, 'Nothing here', [issue]).ok).toBe(true);
    });

    it('gives a page mention the page current path', () => {
      const made = add(PROJECT, PRICING, MEI, 'See @/pricing', [page]);
      expect(made.ok && made.note.mentions).toEqual([shownPage]);
      const user = add(PROJECT, PRICING, MEI, 'Ask @Priya Natarajan', [mate]);
      expect(user.ok && user.note.mentions).toEqual([mate]);
    });

    it('refuses a page of an unknown address, a user who is no member and a keyword that is not tracked', () => {
      const keyword = { type: 'keyword', label: '@"managed soc pricing"', target: 'managed soc pricing' };
      expect(add(PROJECT, PRICING, MEI, 'See @/pricing and @"managed soc pricing"', [page, keyword]).ok).toBe(true);
      const unknown = [
        { ...page, target: '999999' },
        { ...mate, target: '0192d1a8-5b10-7c01-9a11-0000000000ff' },
        { ...keyword, target: 'never tracked' },
      ];
      for (const entry of unknown) {
        expect(add(PROJECT, PRICING, MEI, `${page.label} ${mate.label} ${keyword.label}`, [entry])).toMatchObject({
          ok: false,
          error: 'invalid',
          field: { path: 'mentions[0].target', code: 'mention_target_unknown' },
        });
      }
    });

    it('refuses a malformed page or teammate target, and judges only the entries whose label is in the text', () => {
      expect(add(PROJECT, PRICING, MEI, 'See @/pricing', [{ ...page, target: 'abc' }])).toMatchObject({
        field: { path: 'mentions[0].target', code: 'invalid_target' },
      });
      expect(add(PROJECT, PRICING, MEI, 'Ask @Priya Natarajan', [{ ...mate, target: 'nope' }])).toMatchObject({
        field: { path: 'mentions[0].target', code: 'invalid_target' },
      });
      expect(add(PROJECT, PRICING, MEI, 'Nothing here', [{ ...page, target: '999999' }]).ok).toBe(true);
    });

    it('names the entry that fails by its place in the list that was sent', () => {
      const bad = { ...mate, target: '0192d1a8-5b10-7c01-9a11-0000000000ff' };
      expect(add(PROJECT, PRICING, MEI, 'See @/pricing and @Priya Natarajan', [page, bad])).toMatchObject({
        field: { path: 'mentions[1].target', code: 'mention_target_unknown' },
      });
    });

    it('refuses an unknown type, a label without an at sign and more than 20', () => {
      expect(add(PROJECT, PRICING, MEI, 'x @a', [{ ...page, type: 'url' }])).toMatchObject({
        field: { path: 'mentions[0].type' },
      });
      expect(add(PROJECT, PRICING, MEI, 'x', [{ ...page, label: 'x' }])).toMatchObject({
        field: { path: 'mentions[0].label' },
      });
      const many = Array.from({ length: 21 }, (_, index) => ({ ...page, label: `@p${String(index)}` }));
      expect(add(PROJECT, PRICING, MEI, 'x', many)).toMatchObject({ field: { path: 'mentions', code: 'too_long' } });
    });
  });

  describe('files', () => {
    const MB = 1024 * 1024;
    const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
    const textFile = (name = 'notes.txt', body = 'hello'): NoteUpload => ({
      name,
      type: 'text/plain',
      bytes: bytes(body),
    });
    const png = (name = 'shot.png'): NoteUpload => ({
      name,
      type: 'image/png',
      bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    });
    const upload = (file: NoteUpload = textFile(), actor: NoteActor = MEI, page: string = PRICING): PageNoteFile => {
      const sent = uploadFile(WORKSPACE, PROJECT, page, actor, file);
      if (!sent.ok) throw new Error(`refused: ${sent.error}`);
      return sent.file;
    };
    /** A note of MEI on the pricing page with the files given. */
    const noteWith = (...files: PageNoteFile[]): PageNote => {
      const made = add(
        PROJECT,
        PRICING,
        MEI,
        'With files',
        undefined,
        files.map((file) => file.id),
      );
      if (!made.ok) throw new Error('refused');
      return made.note;
    };
    const refusal = (result: ReturnType<typeof uploadFile>): string => (result.ok ? 'ok' : result.error);

    it('stores a file for a page and answers its name, size, type and serving path', () => {
      const file = upload(png('Shot.PNG'));
      expect(file).toMatchObject({ name: 'Shot.PNG', size: 8, content_type: 'image/png', is_image: true });
      expect(file.url).toBe(
        `/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT}/internal-links/pages/${PRICING}/note-attachments/${file.id}`,
      );
      expect(upload({ name: 'rows.csv', type: 'text/plain', bytes: bytes('a,b') })).toMatchObject({
        content_type: 'text/csv',
        is_image: false,
      });
      expect(upload({ name: 'rows.csv', type: 'application/vnd.ms-excel', bytes: bytes('a,b') }).content_type).toBe(
        'text/csv',
      );
      expect(upload({ name: 'a/b\\report.pdf', type: '', bytes: bytes('%PDF-1.7') })).toMatchObject({
        name: 'report.pdf',
        content_type: 'application/pdf',
      });
    });

    it('refuses a file over 10 MB, an empty one, and a type that is not one of the seven', () => {
      expect(
        refusal(uploadFile(WORKSPACE, PROJECT, PRICING, MEI, { ...textFile(), bytes: new Uint8Array(10 * MB + 1) })),
      ).toBe('too_large');
      expect(uploadFile(WORKSPACE, PROJECT, PRICING, MEI, { ...textFile(), bytes: new Uint8Array(10 * MB) }).ok).toBe(
        true,
      );
      expect(refusal(uploadFile(WORKSPACE, PROJECT, PRICING, MEI, { ...textFile(), bytes: new Uint8Array(0) }))).toBe(
        'empty',
      );
      for (const odd of [
        { name: 'run.exe', type: 'application/x-msdownload' },
        { name: 'photo.bmp', type: 'image/bmp' },
        { name: 'unknown', type: 'application/octet-stream' },
        { name: 'noext', type: '' },
      ]) {
        expect([
          odd.name,
          refusal(uploadFile(WORKSPACE, PROJECT, PRICING, MEI, { ...odd, bytes: bytes('x') })),
        ]).toEqual([odd.name, 'type']);
      }
    });

    it('refuses markup by name and by its first bytes, whatever the declared type', () => {
      for (const name of ['a.html', 'A.HTM', 'a.svg', 'a.xml', 'a.js', 'a.mjs']) {
        expect([
          name,
          refusal(uploadFile(WORKSPACE, PROJECT, PRICING, MEI, { ...textFile(name), type: 'text/plain' })),
        ]).toEqual([name, 'type']);
      }
      for (const start of ['<html>', '  \n\t<svg/>', '<?xml version="1.0"?>']) {
        expect(refusal(uploadFile(WORKSPACE, PROJECT, PRICING, MEI, textFile('notes.txt', start)))).toBe('type');
      }
      expect(uploadFile(WORKSPACE, PROJECT, PRICING, MEI, textFile('notes.txt', 'a < b')).ok).toBe(true);
    });

    it('counts every stored file against the workspace cap, attached or not, and says where it stands', () => {
      setNoteFileLimit(6 * MB);
      const megabyte = { ...textFile(), bytes: new Uint8Array(MB).fill(65) };
      for (let count = 0; count < 6; count += 1)
        expect(uploadFile(WORKSPACE, PROJECT, PRICING, MEI, megabyte).ok).toBe(true);
      expect(uploadFile(WORKSPACE, PROJECT, PRICING, MEI, megabyte)).toMatchObject({
        ok: false,
        error: 'quota',
        quota: { limit: 6 * MB, used: 6 * MB, requested: MB },
      });
    });

    it('forgets the cap a test set when the mock is reset', () => {
      setNoteFileLimit(1);
      resetNotes();
      expect(uploadFile(WORKSPACE, PROJECT, PRICING, MEI, textFile()).ok).toBe(true);
    });

    it('attaches the caller own pending files of this page to a new note, and a file attaches once', () => {
      const first = upload();
      const note = noteWith(first);
      expect(note.attachments).toEqual([first]);
      expect(listed(PRICING)[0]).toBe('With files');
      const again = add(PROJECT, PRICING, MEI, 'Again', undefined, [first.id]);
      expect(again).toMatchObject({ ok: false, field: { path: 'attachment_ids[0]', code: 'attachment_unavailable' } });
    });

    it('refuses a file of another uploader, of another page, an unknown id, a repeated id and a malformed one', () => {
      const theirs = upload(textFile(), PRIYA);
      const elsewhere = upload(textFile(), MEI, HOME);
      const mine = upload();
      const failing = (ids: unknown): unknown => {
        const result = add(PROJECT, PRICING, MEI, 'x', undefined, ids);
        return result.ok ? 'ok' : result.field;
      };
      expect(failing([theirs.id])).toEqual({ path: 'attachment_ids[0]', code: 'attachment_unavailable' });
      expect(failing([elsewhere.id])).toEqual({ path: 'attachment_ids[0]', code: 'attachment_unavailable' });
      expect(failing(['0192e4a0-b000-7000-8000-0000000000ff'])).toEqual({
        path: 'attachment_ids[0]',
        code: 'attachment_unavailable',
      });
      expect(failing([mine.id, mine.id])).toEqual({ path: 'attachment_ids[1]', code: 'attachment_unavailable' });
      expect(failing(['nope'])).toEqual({ path: 'attachment_ids[0]', code: 'uuid_parsing' });
      expect(failing('x')).toEqual({ path: 'attachment_ids', code: 'list_type' });
      expect(failing(null)).toBe('ok');
    });

    it('holds at most 5 live files on a note', () => {
      const files = Array.from({ length: 6 }, () => upload());
      const six = add(
        PROJECT,
        PRICING,
        MEI,
        'x',
        undefined,
        files.map((file) => file.id),
      );
      expect(six).toMatchObject({ ok: false, field: { path: 'attachment_ids', code: 'too_long' } });
      const five = add(
        PROJECT,
        PRICING,
        MEI,
        'x',
        undefined,
        files.slice(0, 5).map((file) => file.id),
      );
      expect(five.ok && five.note.attachments).toHaveLength(5);
    });

    it('accepts a note of files only and refuses one with neither text nor file', () => {
      const file = upload();
      const only = add(PROJECT, PRICING, MEI, '  ', undefined, [file.id]);
      expect(only.ok && only.note).toMatchObject({ body: '', attachments: [file] });
      expect(add(PROJECT, PRICING, MEI, '  ', undefined, [])).toMatchObject({
        ok: false,
        error: 'invalid',
        field: { path: 'body', code: 'body_required' },
      });
      expect(add(PROJECT, PRICING, MEI, '')).toMatchObject({ ok: false, field: { code: 'body_required' } });
    });

    it('keeps the files of a change that sends no list, and makes a sent list the exact files afterwards', () => {
      const one = upload(textFile('one.txt'));
      const two = upload(textFile('two.txt'));
      const three = upload(textFile('three.txt'));
      const note = noteWith(one, two);
      const kept = change(PROJECT, PRICING, note.id, MEI, 'With files', undefined, undefined);
      expect(kept.ok && kept.note.attachments.map((file) => file.name)).toEqual(['one.txt', 'two.txt']);
      expect(kept.ok && kept.note.edited_at).toBeNull();
      const swapped = change(PROJECT, PRICING, note.id, MEI, 'With files', undefined, [two.id, three.id]);
      expect(swapped.ok && swapped.note.attachments.map((file) => file.name)).toEqual(['two.txt', 'three.txt']);
      expect(swapped.ok && swapped.note.edited_at).not.toBeNull();
      // A dropped file is gone for good: it cannot be attached again
      expect(change(PROJECT, PRICING, note.id, MEI, 'With files', undefined, [one.id, two.id])).toMatchObject({
        ok: false,
        field: { path: 'attachment_ids[0]', code: 'attachment_unavailable' },
      });
    });

    it('detaches every file of a change that sends an empty list, and refuses that when the note has no text', () => {
      const file = upload();
      const note = noteWith(file);
      const none = change(PROJECT, PRICING, note.id, MEI, 'With files', undefined, []);
      expect(none.ok && none.note.attachments).toEqual([]);
      const filesOnly = add(PROJECT, PRICING, MEI, '', undefined, [upload().id]);
      if (!filesOnly.ok) throw new Error('refused');
      expect(change(PROJECT, PRICING, filesOnly.note.id, MEI, '', undefined, [])).toMatchObject({
        ok: false,
        field: { path: 'body', code: 'body_required' },
      });
      // Text taken away while the files stay is fine
      expect(change(PROJECT, PRICING, filesOnly.note.id, MEI, '').ok).toBe(true);
    });

    it('serves a file only while it is attached, not dropped and its note is not deleted, and again after a restore', () => {
      const file = upload(png());
      expect(fileOf(PROJECT, PRICING, file.id)).toBeUndefined();
      const note = noteWith(file);
      expect(fileOf(PROJECT, PRICING, file.id)).toMatchObject({ type: 'image/png', name: 'shot.png' });
      expect(fileOf(PROJECT, PRICING, file.id)?.bytes).toEqual(png().bytes);
      expect(fileOf(PROJECT, HOME, file.id)).toBeUndefined();
      expect(remove(PROJECT, PRICING, note.id, MEI).ok).toBe(true);
      expect(fileOf(PROJECT, PRICING, file.id)).toBeUndefined();
      expect(restore(PROJECT, PRICING, note.id, MEI).ok).toBe(true);
      expect(fileOf(PROJECT, PRICING, file.id)).toBeDefined();
      change(PROJECT, PRICING, note.id, MEI, 'With files', undefined, []);
      expect(fileOf(PROJECT, PRICING, file.id)).toBeUndefined();
    });
  });
});
