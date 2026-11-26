import { EVENTUS } from './internal-links-world';
import { onMockReset } from './state';
import { NOTE_MAX } from '@/lib/pages/notes';
import type { Role, Schemas } from '@/lib/api/types';
import type { PageNote } from '@/lib/internal-links/types';
import { textLength } from '@/lib/text/length';

/**
 * The notes on pages (spec 9.7), kept in memory per project, with the rules of the API's `PageNoteService`: the body is
 * trimmed and 1 to `NOTE_MAX` characters; only the author changes a note; the author, an owner or an admin deletes it
 * (soft, the note stays so it can come back); only the one who deleted it restores it. `can_edit` and `can_delete`
 * are computed for the caller here, as the server does, so the screens compare no user id.
 */

/** Who is calling: the session's user, their role in the workspace and whether they hold `notes:write`. */
export interface NoteActor {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly writes: boolean;
}

export type NoteFailure = 'forbidden' | 'not_found' | 'invalid';
/** The field a refusal names (`body` when left out), as the API's field errors do. */
export interface NoteField {
  readonly path: string;
  readonly code: string;
}
export type NoteResult =
  { ok: true; note: PageNote } | { ok: false; error: NoteFailure; detail?: string; field?: NoteField };

/** Mentions of a note, as the API stores them (`MENTIONS_MAX`, `MentionType` of the backend schema). */
const MENTIONS_MAX = 20;
type StoredMention = Schemas['PageNoteMentionIn'];
const isMentionType = (value: unknown): value is StoredMention['type'] =>
  value === 'page' || value === 'user' || value === 'issue' || value === 'keyword';

interface StoredNote {
  readonly id: string;
  readonly urlId: string;
  readonly authorId: string;
  readonly authorName: string;
  body: string;
  mentions: StoredMention[];
  readonly createdAt: string;
  editedAt: string | null;
  deletedBy: string | null;
}

const PRIYA = { id: '0192d1a8-5b10-7c01-9a11-000000000003', name: 'Priya Natarajan' };
const TOMAS = { id: '0192d1a8-5b10-7c01-9a11-000000000002', name: 'Tomás Rivera' };
const noteId = (index: number): string => `0192e4a0-a000-7000-8000-${String(index).padStart(12, '0')}`;

const seeded = (
  index: number,
  urlId: string,
  author: { id: string; name: string },
  body: string,
  createdAt: string,
  editedAt: string | null = null,
): StoredNote => ({
  id: noteId(index),
  urlId,
  authorId: author.id,
  authorName: author.name,
  body,
  mentions: [],
  createdAt,
  editedAt,
  deletedBy: null,
});

interface Store {
  /** Per project, newest first: an added note goes in front, so a note keeps its place through a delete and a restore. */
  notes: Map<string, StoredNote[]>;
  nextId: number;
}

function seed(): Store {
  return {
    notes: new Map([
      [
        EVENTUS.project_id,
        [
          seeded(
            3,
            '108',
            TOMAS,
            'Plan table moved above the fold.\nWatch the click-through from search for two weeks.',
            '2026-11-24T10:12:00Z',
            '2026-11-24T15:40:00Z',
          ),
          seeded(
            2,
            '108',
            PRIYA,
            'Rewrote the title and the first heading to name the three plans.',
            '2026-11-20T09:30:00Z',
          ),
          seeded(
            1,
            '108',
            PRIYA,
            'Pricing page now links to the VAPT and managed detection pages.',
            '2026-11-12T14:05:00Z',
          ),
          seeded(
            4,
            '101',
            PRIYA,
            'Home page copy approved by the founders; leave it alone until January.',
            '2026-11-18T08:00:00Z',
          ),
        ],
      ],
    ]),
    nextId: 100,
  };
}

let store = seed();
/** Back to the seed; `resetMockState` calls it after every test. */
export function resetNotes(): void {
  store = seed();
}
onMockReset(resetNotes);

const notesOfProject = (projectId: string): StoredNote[] => {
  const held = store.notes.get(projectId);
  if (held !== undefined) return held;
  const created: StoredNote[] = [];
  store.notes.set(projectId, created);
  return created;
};

const isLive = (note: StoredNote): boolean => note.deletedBy === null;
const mayDelete = (actor: NoteActor, note: StoredNote): boolean =>
  note.authorId === actor.id || actor.role === 'owner' || actor.role === 'admin';

const viewOf = (note: StoredNote, actor: NoteActor): PageNote => ({
  id: note.id,
  author: { id: note.authorId, name: note.authorName },
  body: note.body,
  mentions: note.mentions.map((mention) => ({ ...mention })),
  // Files arrive with the upload task; until then a note holds none.
  attachments: [],
  created_at: note.createdAt,
  edited_at: note.editedAt,
  can_edit: actor.writes && note.authorId === actor.id,
  can_delete: actor.writes && mayDelete(actor, note),
});

/** The body as the API keeps it, or why it refuses it (`PageNoteWrite` of the backend). */
function cleanBody(raw: string): { ok: true; body: string } | { ok: false; detail: string } {
  const body = raw.replaceAll('\r\n', '\n').trim();
  if (body === '') return { ok: false, detail: 'Write something first.' };
  if (textLength(body) > NOTE_MAX) return { ok: false, detail: 'A note is at most 2,000 characters.' };
  if (body.includes('\u0000')) return { ok: false, detail: 'A note cannot hold a null character.' };
  return { ok: true, body };
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The entries whose label is in the text; of two with one label, the first (`_in_text` of the backend). */
function inText(body: string, entries: readonly StoredMention[]): StoredMention[] {
  const labels = new Set<string>();
  return entries.filter((entry) => {
    if (!body.includes(entry.label) || labels.has(entry.label)) return false;
    labels.add(entry.label);
    return true;
  });
}

/**
 * The mentions a write sends, judged as `check_mentions` does: the shape of each, then only those whose label is in the
 * text are kept, then an issue is refused (`mention_type_unavailable`: the catalogue of issues is not live yet). The
 * targets are not looked up. `null` when none were sent.
 */
function cleanMentions(
  raw: unknown,
  body: string,
): { ok: true; mentions: StoredMention[] | null } | { ok: false; detail: string; field: NoteField } {
  if (raw === undefined || raw === null) return { ok: true, mentions: null };
  if (!Array.isArray(raw))
    return { ok: false, detail: 'Input should be a valid list.', field: { path: 'mentions', code: 'list_type' } };
  if (raw.length > MENTIONS_MAX) {
    return { ok: false, detail: 'A note has at most 20 mentions.', field: { path: 'mentions', code: 'too_long' } };
  }
  const entries: StoredMention[] = [];
  for (const [index, item] of raw.entries()) {
    const at = `mentions[${String(index)}]`;
    if (!isRecord(item))
      return { ok: false, detail: 'Input should be an object.', field: { path: at, code: 'model_attributes_type' } };
    const { type, label, target } = item;
    if (!isMentionType(type)) {
      return { ok: false, detail: 'Not a mention type.', field: { path: `${at}.type`, code: 'enum' } };
    }
    if (
      typeof label !== 'string' ||
      textLength(label) < 2 ||
      textLength(label) > 200 ||
      !label.startsWith('@') ||
      /[\r\n]/.test(label)
    ) {
      return {
        ok: false,
        detail: 'A mention label is one line that starts with @.',
        field: { path: `${at}.label`, code: 'value_error' },
      };
    }
    if (typeof target !== 'string' || textLength(target) < 1 || textLength(target) > 200) {
      return {
        ok: false,
        detail: 'A mention target is 1 to 200 characters.',
        field: { path: `${at}.target`, code: 'string_type' },
      };
    }
    entries.push({ type, label, target });
  }
  const kept = inText(body, entries);
  const issue = kept.find((entry) => entry.type === 'issue');
  if (issue !== undefined) {
    return {
      ok: false,
      detail: 'Issues cannot be mentioned yet.',
      field: { path: `mentions[${String(entries.indexOf(issue))}].type`, code: 'mention_type_unavailable' },
    };
  }
  return { ok: true, mentions: kept };
}

const ofPage = (projectId: string, urlId: string): StoredNote[] =>
  notesOfProject(projectId).filter((note) => note.urlId === urlId);

/** The notes of a page that are not deleted. */
export const countOf = (projectId: string, urlId: string): number => ofPage(projectId, urlId).filter(isLive).length;

/**
 * Up to `limit` live notes after the note `cursor` names (the first ones for `null`), newest first, with the live count
 * and the cursor of the next page. `null` for a cursor that names no note of the page. The cursor is a note id, so a
 * delete between two reads moves nothing (the API's cursor is a key, not an offset).
 */
export function notesAfter(
  projectId: string,
  urlId: string,
  actor: NoteActor,
  cursor: string | null,
  limit: number,
): { notes: PageNote[]; total: number; next: string | null } | null {
  const all = ofPage(projectId, urlId);
  const from = cursor === null ? 0 : all.findIndex((note) => note.id === cursor) + 1;
  if (from === 0 && cursor !== null) return null;
  const rest = all.slice(from).filter(isLive);
  const window = rest.slice(0, limit);
  const last = window.at(-1);
  return {
    notes: window.map((note) => viewOf(note, actor)),
    total: countOf(projectId, urlId),
    next: rest.length > limit && last !== undefined ? last.id : null,
  };
}

export function add(
  projectId: string,
  urlId: string,
  actor: NoteActor,
  raw: string,
  sentMentions?: unknown,
): NoteResult {
  const cleaned = cleanBody(raw);
  if (!cleaned.ok) return { ok: false, error: 'invalid', detail: cleaned.detail };
  const judged = cleanMentions(sentMentions, cleaned.body);
  if (!judged.ok) return { ok: false, error: 'invalid', detail: judged.detail, field: judged.field };
  store.nextId += 1;
  const note: StoredNote = {
    id: noteId(store.nextId),
    urlId,
    authorId: actor.id,
    authorName: actor.name,
    body: cleaned.body,
    mentions: judged.mentions ?? [],
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedBy: null,
  };
  notesOfProject(projectId).unshift(note);
  return { ok: true, note: viewOf(note, actor) };
}

/** A note of this page: one that is deleted or one that is not, as the API locks it for a write. */
const find = (projectId: string, urlId: string, id: string, deleted: boolean): StoredNote | undefined =>
  ofPage(projectId, urlId).find((note) => note.id === id && !isLive(note) === deleted);

/** Only the author. `edited_at` is set only when the body really changed. */
export function change(
  projectId: string,
  urlId: string,
  id: string,
  actor: NoteActor,
  raw: string,
  sentMentions?: unknown,
): NoteResult {
  const note = find(projectId, urlId, id, false);
  if (note === undefined) return { ok: false, error: 'not_found' };
  if (note.authorId !== actor.id) return { ok: false, error: 'forbidden' };
  const cleaned = cleanBody(raw);
  if (!cleaned.ok) return { ok: false, error: 'invalid', detail: cleaned.detail };
  const judged = cleanMentions(sentMentions, cleaned.body);
  if (!judged.ok) return { ok: false, error: 'invalid', detail: judged.detail, field: judged.field };
  // Omitted: the stored ones whose label is still in the text stay, and are not judged again.
  const mentions = judged.mentions ?? inText(cleaned.body, note.mentions);
  if (note.body !== cleaned.body) {
    note.body = cleaned.body;
    note.editedAt = new Date().toISOString();
  }
  note.mentions = mentions;
  return { ok: true, note: viewOf(note, actor) };
}

/** Soft: the author, an owner or an admin. */
export function remove(
  projectId: string,
  urlId: string,
  id: string,
  actor: NoteActor,
): { ok: true } | { ok: false; error: NoteFailure } {
  const note = find(projectId, urlId, id, false);
  if (note === undefined) return { ok: false, error: 'not_found' };
  if (!mayDelete(actor, note)) return { ok: false, error: 'forbidden' };
  note.deletedBy = actor.id;
  return { ok: true };
}

/** Undo: only the one who deleted the note, and only a note that is deleted. */
export function restore(projectId: string, urlId: string, id: string, actor: NoteActor): NoteResult {
  const note = find(projectId, urlId, id, true);
  if (note === undefined) return { ok: false, error: 'not_found' };
  if (note.deletedBy !== actor.id) return { ok: false, error: 'forbidden' };
  note.deletedBy = null;
  return { ok: true, note: viewOf(note, actor) };
}
