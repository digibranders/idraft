/**
 * The note box's mentions and slash commands (spec 9.8.1 to 9.8.3), as pure functions: where the trigger is, what it
 * offers, what a pick writes, which mentions a text still holds and how a body is cut around them. No React, no
 * request and no clock: the date a `/date` writes is passed in. No label is ever turned into a regular expression
 * (labels are display text typed by people), and nothing here throws.
 */

export const MAX_SUGGESTIONS = 8;
/** The API refuses more (`MENTIONS_MAX` of `schemas/page_notes.py`). */
export const MAX_MENTIONS = 20;
/** A label is 2 to 200 characters (the API's rule); the cut is by code point. */
const LABEL_MAX = 200;

export type MentionType = 'page' | 'user' | 'issue' | 'keyword';
export interface NoteMention {
  type: MentionType;
  label: string;
  target: string;
  path?: string | null;
}
export type TriggerKind = 'at' | 'command' | 'page' | 'issue' | 'keyword';
/** `start` is where the typed word begins (for `/page pri`, at the slash); `query` is what was typed after it. */
export interface Trigger {
  start: number;
  kind: TriggerKind;
  query: string;
}
export type CommandName = 'page' | 'issue' | 'keyword' | 'date';
export type Suggestion =
  /** `hint` is the text a row shows first (a page's path), `detail` the second line (its title). */
  | { kind: 'mention'; mention: NoteMention; hint: string; detail: string | null }
  | { kind: 'command'; name: CommandName };
export interface SuggestionSources {
  teammates: readonly { id: string; name: string }[];
  pages: readonly { id: string; path: string; title: string | null }[];
  issues: readonly { checkId: string; name: string }[];
  keywords: readonly string[];
}
export type NoteSegment = { kind: 'text'; text: string } | { kind: 'mention'; mention: NoteMention };

const COMMANDS: readonly CommandName[] = ['page', 'issue', 'keyword', 'date'];
/** The commands that take a search word and then offer one kind. */
const KIND_COMMANDS: readonly TriggerKind[] = ['page', 'issue', 'keyword'];

const isSpace = (char: string | undefined): boolean => char !== undefined && /\s/u.test(char);

/** Where the word that ends at `end` begins: after the last white space before it. */
function wordStart(text: string, end: number): number {
  let start = end;
  while (start > 0 && !isSpace(text[start - 1])) start -= 1;
  return start;
}

/** The commands whose name starts with `query`, in their order, ignoring case. */
export function commandsFor(query: string): readonly CommandName[] {
  const typed = query.toLowerCase();
  return COMMANDS.filter((name) => name.startsWith(typed));
}

const kindCommand = (word: string): TriggerKind | null => {
  const name = word.toLowerCase();
  return KIND_COMMANDS.find((kind) => `/${kind}` === name) ?? null;
};

/**
 * The trigger the caret is in, or null: an `@` or a `/` that starts a word (so not `a@b.com` nor `and/or`), with the
 * word read up to the caret. A slash word is a trigger only while it can still become a command; after `/page`,
 * `/issue` or `/keyword` and one space the word typed is the search for that kind.
 */
export function triggerAt(text: string, caret: number): Trigger | null {
  if (Number.isNaN(caret)) return null;
  const end = Math.min(Math.max(Math.trunc(caret), 0), text.length);
  const start = wordStart(text, end);
  const word = text.slice(start, end);
  if (word.startsWith('@')) return { start, kind: 'at', query: word.slice(1) };
  if (word.startsWith('/')) {
    const query = word.slice(1);
    return commandsFor(query).length > 0 ? { start, kind: 'command', query } : null;
  }
  // One space or tab, then the command word: a line break or a second space closes it
  const gap = text[start - 1];
  if (start === 0 || (gap !== ' ' && gap !== '\t')) return null;
  const commandStart = wordStart(text, start - 1);
  const kind = kindCommand(text.slice(commandStart, start - 1));
  return kind === null ? null : { start: commandStart, kind, query: word };
}

/** One line, at most `room` characters, or '' when nothing is left. */
const oneLine = (text: string, room: number): string => [...text.replace(/\s+/gu, ' ').trim()].slice(0, room).join('');

type Labelled = Pick<NoteMention, 'type' | 'label' | 'target'>;

/** `@/path`, `@Name`, `@Issue name` or `@"keyword"`, or null when there is nothing to name. */
function mentionOf(type: MentionType, text: string, target: string): Labelled | null {
  const quoted = type === 'keyword';
  const shown = oneLine(text, LABEL_MAX - (quoted ? 3 : 1));
  if (shown === '') return null;
  return { type, label: quoted ? `@"${shown}"` : `@${shown}`, target };
}

const holds = (haystack: string, query: string): boolean => haystack.toLowerCase().includes(query);

function rows(trigger: Trigger, sources: SuggestionSources): Suggestion[] {
  // A person may start a keyword with its opening quote
  const query = trigger.query.replace(/^"/u, '').toLowerCase();
  const all = trigger.kind === 'at';
  const found: Suggestion[] = [];
  const push = (mention: Labelled | null, hint: string, detail: string | null): void => {
    if (mention !== null) found.push({ kind: 'mention', mention, hint, detail });
  };
  if (all) {
    for (const mate of sources.teammates) {
      if (holds(mate.name, query)) push(mentionOf('user', mate.name, mate.id), mate.name, null);
    }
  }
  if (all || trigger.kind === 'page') {
    for (const page of sources.pages) {
      if (holds(page.path, query) || (page.title !== null && holds(page.title, query))) {
        push(mentionOf('page', page.path, page.id), page.path, page.title);
      }
    }
  }
  if (all || trigger.kind === 'issue') {
    for (const issue of sources.issues) {
      if (holds(issue.name, query)) push(mentionOf('issue', issue.name, issue.checkId), issue.name, null);
    }
  }
  if (all || trigger.kind === 'keyword') {
    for (const keyword of sources.keywords) {
      if (holds(keyword, query)) push(mentionOf('keyword', keyword, keyword), keyword, null);
    }
  }
  return found;
}

/**
 * What the list shows: the commands for a slash word; otherwise teammates, then pages, then issues, then keywords (a
 * single kind after `/page`, `/issue` or `/keyword`), each narrowed by a case-insensitive "contains", at most 8 rows.
 */
export function suggestionsFor(trigger: Trigger, sources: SuggestionSources): readonly Suggestion[] {
  if (trigger.kind === 'command') return commandsFor(trigger.query).map((name) => ({ kind: 'command', name }));
  return rows(trigger, sources).slice(0, MAX_SUGGESTIONS);
}

/** How much of the text the trigger and what was typed after it cover. */
function typedLength(trigger: Trigger): number {
  const word = trigger.kind === 'at' || trigger.kind === 'command' ? 1 : `/${trigger.kind} `.length;
  return word + trigger.query.length;
}

/** Replaces the trigger and its typed word with `insert` and one space; returns the new text and caret. */
export function applySuggestion(text: string, trigger: Trigger, insert: string): { text: string; caret: number } {
  const start = Math.min(Math.max(trigger.start, 0), text.length);
  const end = Math.min(start + typedLength(trigger), text.length);
  return { text: `${text.slice(0, start)}${insert} ${text.slice(end)}`, caret: start + insert.length + 1 };
}

/** The entries plus `added`, unless its label is already there (the first of a label wins) or 20 are held. */
export function addMention(mentions: readonly NoteMention[], added: NoteMention): NoteMention[] {
  if (mentions.length >= MAX_MENTIONS || mentions.some((held) => held.label === added.label)) return [...mentions];
  return [...mentions, added];
}

/**
 * A pick written into the text. A mention writes its label and joins the list; `/page`, `/issue` and `/keyword` write
 * the command word, so the next trigger offers that kind; `/date` writes `today` (formatted by the caller, in the
 * viewer's time zone) and adds no mention.
 */
export function pickInto(
  text: string,
  mentions: readonly NoteMention[],
  trigger: Trigger,
  suggestion: Suggestion,
  today: string,
): { text: string; caret: number; mentions: NoteMention[] } {
  if (suggestion.kind === 'mention') {
    return {
      ...applySuggestion(text, trigger, suggestion.mention.label),
      mentions: addMention(mentions, suggestion.mention),
    };
  }
  const insert = suggestion.name === 'date' ? today : `/${suggestion.name}`;
  return { ...applySuggestion(text, trigger, insert), mentions: [...mentions] };
}

/** The entries whose label is still in `text`, first of each label, in order, at most 20 (what a save sends). */
export function keptMentions(text: string, mentions: readonly NoteMention[]): NoteMention[] {
  const labels = new Set<string>();
  const kept: NoteMention[] = [];
  for (const mention of mentions) {
    if (mention.label === '' || labels.has(mention.label) || !text.includes(mention.label)) continue;
    labels.add(mention.label);
    kept.push(mention);
  }
  return kept.slice(0, MAX_MENTIONS);
}

interface Claim {
  start: number;
  end: number;
  mention: NoteMention;
}

/**
 * The body cut into plain text and chips. Longer labels claim their places first, every occurrence, and no two chips
 * overlap; every other character stays in a text part, so a body with markup comes back character for character
 * when the parts are joined and the label of a chip is only ever shown as text.
 */
export function splitNoteText(body: string, mentions: readonly NoteMention[]): NoteSegment[] {
  const claims: Claim[] = [];
  const byLength = keptMentions(body, mentions).sort((first, second) => second.label.length - first.label.length);
  for (const mention of byLength) {
    let from = body.indexOf(mention.label);
    while (from !== -1) {
      const end = from + mention.label.length;
      const free = claims.every((claim) => end <= claim.start || from >= claim.end);
      if (free) claims.push({ start: from, end, mention });
      from = body.indexOf(mention.label, free ? end : from + 1);
    }
  }
  claims.sort((first, second) => first.start - second.start);
  const parts: NoteSegment[] = [];
  let cursor = 0;
  for (const claim of claims) {
    if (claim.start > cursor) parts.push({ kind: 'text', text: body.slice(cursor, claim.start) });
    parts.push({ kind: 'mention', mention: claim.mention });
    cursor = claim.end;
  }
  if (cursor < body.length) parts.push({ kind: 'text', text: body.slice(cursor) });
  return parts;
}
