import { keywordsOf } from './internal-links-changes-world';
import { crawledPage, crawledPages, EVENTUS } from './internal-links-world';
import { MOCK_USERS } from './fixtures';
import { onMockReset } from './state';
import { NOTE_FILE_MAX_BYTES, NOTE_FILES_MAX } from '@/lib/pages/note-files';
import { NOTE_MAX } from '@/lib/pages/notes';
import type { Role, Schemas } from '@/lib/api/types';
import type { PageNote, PageNoteFile } from '@/lib/internal-links/types';
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

/** The default space of a workspace for note files (`max_note_file_bytes` of the backend). */
const NOTE_FILE_QUOTA_BYTES = 1024 ** 3;

/**
 * A file sent for a note, kept in memory with its bytes. It belongs to no note (`noteId` null) until a note names it;
 * a file a change drops is `removed` for good, and a deleted note's files stay as they are, so a restore brings them back.
 */
interface StoredFile {
  readonly id: string;
  readonly projectId: string;
  readonly urlId: string;
  readonly uploaderId: string;
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
  readonly url: string;
  noteId: string | null;
  removed: boolean;
}

interface Store {
  /** Per project, newest first: an added note goes in front, so a note keeps its place through a delete and a restore. */
  notes: Map<string, StoredNote[]>;
  nextId: number;
  /** Every file of the workspace by id, in the order they were sent; each one counts against the cap, live or not. */
  files: Map<string, StoredFile>;
  fileLimit: number;
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
    files: new Map(),
    fileLimit: NOTE_FILE_QUOTA_BYTES,
  };
}

/** For a test: the workspace's space for note files, in bytes. The reset puts the default back. */
export function setNoteFileLimit(bytes: number): void {
  store.fileLimit = bytes;
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

/** The files a note holds, in the order they were sent. */
const liveFiles = (noteId: string): StoredFile[] =>
  [...store.files.values()].filter((file) => file.noteId === noteId && !file.removed);

const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const fileView = (file: StoredFile): PageNoteFile => ({
  id: file.id,
  name: file.name,
  size: file.bytes.length,
  content_type: file.type,
  is_image: IMAGE_TYPES.has(file.type),
  url: file.url,
});
const mayDelete = (actor: NoteActor, note: StoredNote): boolean =>
  note.authorId === actor.id || actor.role === 'owner' || actor.role === 'admin';

const viewOf = (note: StoredNote, actor: NoteActor): PageNote => ({
  id: note.id,
  author: { id: note.authorId, name: note.authorName },
  body: note.body,
  // A page chip shows the page's current path
  mentions: note.mentions.map((mention) =>
    mention.type === 'page' ? { ...mention, path: crawledPage(mention.target)?.path ?? null } : { ...mention },
  ),
  attachments: liveFiles(note.id).map(fileView),
  created_at: note.createdAt,
  edited_at: note.editedAt,
  can_edit: actor.writes && note.authorId === actor.id,
  can_delete: actor.writes && mayDelete(actor, note),
});

/** The body as the API keeps it (empty is allowed here: `requireContent` judges it with the files), or why it refuses it. */
function cleanBody(raw: string): { ok: true; body: string } | { ok: false; detail: string } {
  const body = raw.replaceAll('\r\n', '\n').trim();
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `_url_id` of the backend: digits only, at most 18. */
const URL_ID = /^[0-9]{1,18}$/;

const isTrackedKeyword = (text: string): boolean =>
  crawledPages().some((page) => keywordsOf(page).some((row) => row.keyword === text));

interface TargetFailure {
  part: 'type' | 'target';
  code: string;
  detail: string;
}

const unknownTarget = (what: string): TargetFailure => ({
  part: 'target',
  code: 'mention_target_unknown',
  detail: `This ${what} cannot be mentioned here.`,
});
const malformedTarget = (what: string): TargetFailure => ({
  part: 'target',
  code: 'invalid_target',
  detail: `A ${what} target is malformed.`,
});

/** Whether the target is real for this workspace and project (`check_mentions` of the backend), or why not. */
function judgeTarget({ type, target }: StoredMention): TargetFailure | null {
  switch (type) {
    case 'page':
      if (!URL_ID.test(target)) return malformedTarget('page');
      return crawledPage(target) === undefined ? unknownTarget('page') : null;
    case 'user':
      if (!UUID.test(target)) return malformedTarget('teammate');
      return MOCK_USERS.some((user) => user.user_id === target) ? null : unknownTarget('teammate');
    case 'keyword':
      return isTrackedKeyword(target) ? null : unknownTarget('keyword');
    case 'issue':
      // The catalogue of issues is not live yet
      return { part: 'type', code: 'mention_type_unavailable', detail: 'Issues cannot be mentioned yet.' };
  }
}

/**
 * The mentions a write sends, judged as `check_mentions` does: the shape of each, then only those whose label is in the
 * text are kept, then each target is looked up by its type (an issue is refused: `mention_type_unavailable`, the
 * catalogue of issues is not live yet). `null` when none were sent.
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
  // The API names every entry that fails; this answers with the first of them
  for (const entry of kept) {
    const failure = judgeTarget(entry);
    if (failure !== null) {
      const path = `mentions[${String(entries.indexOf(entry))}].${failure.part}`;
      return { ok: false, detail: failure.detail, field: { path, code: failure.code } };
    }
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

type Refused = { ok: false; error: 'invalid'; detail: string; field: NoteField };

const refused = (detail: string, path: string, code: string): Refused => ({
  ok: false,
  error: 'invalid',
  detail,
  field: { path, code },
});

/** `attachment_ids` as sent: `null` when left out, else the list of ids, shaped as the API's schema checks it. */
function cleanFileIds(raw: unknown): { ok: true; ids: string[] | null } | Refused {
  if (raw === undefined || raw === null) return { ok: true, ids: null };
  if (!Array.isArray(raw)) return refused('Input should be a valid list.', 'attachment_ids', 'list_type');
  if (raw.length > NOTE_FILES_MAX) return refused('A note holds at most 5 files.', 'attachment_ids', 'too_long');
  const ids: string[] = [];
  for (const [index, id] of raw.entries()) {
    if (typeof id !== 'string' || !UUID.test(id)) {
      return refused('Input should be a valid UUID.', `attachment_ids[${String(index)}]`, 'uuid_parsing');
    }
    ids.push(id);
  }
  return { ok: true, ids };
}

/**
 * Each id must be a file this caller sent for this page that no note holds (a note's own change may also keep a file
 * the note holds), named once: the rule of `attach` of the backend, which answers the first that fails.
 */
function usableFiles(
  ids: readonly string[],
  projectId: string,
  urlId: string,
  actor: NoteActor,
  held: ReadonlySet<string>,
): Refused | null {
  const seen = new Set<string>();
  for (const [index, id] of ids.entries()) {
    const file = store.files.get(id);
    const usable =
      file !== undefined &&
      !seen.has(id) &&
      file.uploaderId === actor.id &&
      file.projectId === projectId &&
      file.urlId === urlId &&
      (file.noteId === null || held.has(id));
    seen.add(id);
    if (!usable) {
      return refused(
        'This file cannot be attached to this note.',
        `attachment_ids[${String(index)}]`,
        'attachment_unavailable',
      );
    }
  }
  return null;
}

/** A note has text or at least one file: an empty note is never stored. */
const requireContent = (body: string, files: number): Refused | null =>
  body === '' && files === 0 ? refused('A note has text or at least one file.', 'body', 'body_required') : null;

/** Makes `ids` the live files of the note: those not held yet are attached, those held and not named are dropped for good. */
function setFiles(noteId: string, ids: readonly string[]): void {
  const named = new Set(ids);
  for (const file of liveFiles(noteId)) file.removed = !named.has(file.id);
  for (const id of ids) {
    const file = store.files.get(id);
    if (file !== undefined) file.noteId = noteId;
  }
}

export function add(
  projectId: string,
  urlId: string,
  actor: NoteActor,
  raw: string,
  sentMentions?: unknown,
  sentFileIds?: unknown,
): NoteResult {
  const cleaned = cleanBody(raw);
  if (!cleaned.ok) return { ok: false, error: 'invalid', detail: cleaned.detail };
  const judged = cleanMentions(sentMentions, cleaned.body);
  if (!judged.ok) return { ok: false, error: 'invalid', detail: judged.detail, field: judged.field };
  const sent = cleanFileIds(sentFileIds);
  if (!sent.ok) return sent;
  const ids = sent.ids ?? [];
  const empty = requireContent(cleaned.body, ids.length);
  if (empty !== null) return empty;
  const unusable = usableFiles(ids, projectId, urlId, actor, new Set());
  if (unusable !== null) return unusable;
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
  setFiles(note.id, ids);
  return { ok: true, note: viewOf(note, actor) };
}

/** A note of this page: one that is deleted or one that is not, as the API locks it for a write. */
const find = (projectId: string, urlId: string, id: string, deleted: boolean): StoredNote | undefined =>
  ofPage(projectId, urlId).find((note) => note.id === id && !isLive(note) === deleted);

/**
 * Only the author. `edited_at` is set only when the body or the files really changed. `sentFileIds` left out keeps the
 * files; a list is the exact files afterwards, so `[]` detaches them all.
 */
export function change(
  projectId: string,
  urlId: string,
  id: string,
  actor: NoteActor,
  raw: string,
  sentMentions?: unknown,
  sentFileIds?: unknown,
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
  const sent = cleanFileIds(sentFileIds);
  if (!sent.ok) return sent;
  const held = liveFiles(note.id).map((file) => file.id);
  const ids = sent.ids ?? held;
  const unusable = usableFiles(ids, projectId, urlId, actor, new Set(held));
  if (unusable !== null) return unusable;
  const empty = requireContent(cleaned.body, ids.length);
  if (empty !== null) return empty;
  const filesChanged = ids.length !== held.length || ids.some((fileId) => !held.includes(fileId));
  if (note.body !== cleaned.body || filesChanged) {
    note.body = cleaned.body;
    note.editedAt = new Date().toISOString();
  }
  note.mentions = mentions;
  setFiles(note.id, ids);
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

/** A file as the upload route reads it from the form. */
export interface NoteUpload {
  readonly name: string;
  /** The type the browser declared. */
  readonly type: string;
  readonly bytes: Uint8Array;
}

export type UploadFailure = 'too_large' | 'type' | 'empty' | 'quota';
export type UploadResult =
  | { ok: true; file: PageNoteFile }
  | {
      ok: false;
      error: UploadFailure;
      detail: string;
      /** The figures `quota_exceeded` carries. */
      quota?: { limit: number; used: number; requested: number };
    };

const BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
};
const ACCEPTED: ReadonlySet<string> = new Set(Object.values(BY_EXTENSION));
/** What a browser reports when it does not know the file. */
const UNKNOWN_TYPES: ReadonlySet<string> = new Set(['', 'application/octet-stream', 'application/vnd.ms-excel']);
/** Refused whatever the content (`_BLOCKED_EXTENSIONS` of `storage/file_sniff.py`). */
const BLOCKED = /\.(html|htm|xhtml|svg|xml|js|mjs|hta)$/i;
const BLANKS: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0d, 0x20]);

/**
 * The type the mock gives a file, or `null` when it is refused. The mock does not read the bytes the way the server
 * does: it goes by the declared type, the name and whether the first byte after blanks is `<` (markup). The server
 * sniffs the content properly, and `storage/file_sniff.py` is the unit of truth for what is accepted.
 */
function typeOf({ name, type, bytes }: NoteUpload): string | null {
  if (BLOCKED.test(name.trim())) return null;
  if (bytes.find((byte) => !BLANKS.has(byte)) === 0x3c) return null;
  const declared = (type.split(';')[0] ?? '').trim().toLowerCase();
  const dot = name.lastIndexOf('.');
  const named = dot > 0 ? BY_EXTENSION[name.slice(dot).toLowerCase()] : undefined;
  if (UNKNOWN_TYPES.has(declared)) return named ?? null;
  if (!ACCEPTED.has(declared)) return null;
  // The name picks CSV over plain text, as the server does
  return declared === 'text/plain' && named === 'text/csv' ? named : declared;
}

/** No path parts, as `display_name` of the backend. */
const displayName = (name: string): string => name.replaceAll('\\', '/').split('/').pop()?.trim() || 'file';

/**
 * One file for a page, belonging to no note yet: refused over 10 MB, when empty, of a type that is not allowed, and when
 * the workspace's stored files (every one sent, attached or not) plus this one pass the cap, in that order.
 */
export function uploadFile(
  workspaceId: string,
  projectId: string,
  urlId: string,
  actor: NoteActor,
  upload: NoteUpload,
): UploadResult {
  const { bytes } = upload;
  if (bytes.length > NOTE_FILE_MAX_BYTES)
    return { ok: false, error: 'too_large', detail: 'A note file is at most 10 MB.' };
  if (bytes.length === 0) return { ok: false, error: 'empty', detail: 'The file is empty.' };
  const type = typeOf(upload);
  if (type === null) {
    return {
      ok: false,
      error: 'type',
      detail: 'This kind of file cannot be attached. Use an image, a PDF, a CSV or a text file.',
    };
  }
  const used = [...store.files.values()].reduce((sum, file) => sum + file.bytes.length, 0);
  if (used + bytes.length > store.fileLimit) {
    return {
      ok: false,
      error: 'quota',
      detail: 'The workspace has used its space for note files.',
      quota: { limit: store.fileLimit, used, requested: bytes.length },
    };
  }
  store.nextId += 1;
  const id = `0192e4a0-b000-7000-8000-${String(store.nextId).padStart(12, '0')}`;
  const stored: StoredFile = {
    id,
    projectId,
    urlId,
    uploaderId: actor.id,
    name: displayName(upload.name),
    type,
    bytes,
    url: `/api/v1/workspaces/${workspaceId}/projects/${projectId}/internal-links/pages/${urlId}/note-attachments/${id}`,
    noteId: null,
    removed: false,
  };
  store.files.set(id, stored);
  return { ok: true, file: fileView(stored) };
}

/**
 * The bytes of a file, only while it is attached, not dropped, of this page and its note is not deleted: a pending file,
 * a dropped one and a deleted note's are `undefined` (the API's `404`), and a restore brings the last back.
 */
export function fileOf(
  projectId: string,
  urlId: string,
  fileId: string,
): { name: string; type: string; bytes: Uint8Array } | undefined {
  const file = store.files.get(fileId);
  if (file === undefined || file.removed || file.noteId === null) return undefined;
  if (file.projectId !== projectId || file.urlId !== urlId) return undefined;
  const note = ofPage(projectId, urlId).find((held) => held.id === file.noteId);
  return note !== undefined && isLive(note) ? { name: file.name, type: file.type, bytes: file.bytes } : undefined;
}
