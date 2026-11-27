import { formatBusinessDate, formatIsoDate } from '@/lib/format';
import type { Schemas } from '@/lib/api/types';

export type PageHistory = Schemas['PageHistory'];
export type HistoryVersion = Schemas['PageHistoryVersion'];
export type HistoryChange = Schemas['PageHistoryChange'];

/** A date of the tab as "Nov 27, 2026": always with the year, in the project time zone. */
export const historyDate = (instant: string, timeZone: string): string =>
  formatBusinessDate(formatIsoDate(instant, timeZone));

/** What a change line says: a message key under `pageHistory.change` and its values, translated by the component. */
export type ChangeLabel =
  | { key: 'title' | 'description' | 'headingAdded' | 'headingRemoved' | 'edited' }
  | {
      key: 'wordsGrew' | 'wordsShrank' | 'linksAdded' | 'linksRemoved' | 'editorialAdded' | 'editorialRemoved';
      count: number;
    };

/** The label of a change from its type, never from prose the server sends. A change with no usable number reads as an edit. */
export function changeLabel(change: HistoryChange): ChangeLabel {
  switch (change.type) {
    case 'title':
    case 'description':
    case 'edited':
      return { key: change.type };
    case 'heading_added':
      return { key: 'headingAdded' };
    case 'heading_removed':
      return { key: 'headingRemoved' };
    case 'words': {
      if (change.delta === null || change.delta === 0) return { key: 'edited' };
      return { key: change.delta > 0 ? 'wordsGrew' : 'wordsShrank', count: Math.abs(change.delta) };
    }
    case 'links': {
      if (change.delta === null || change.delta === 0) return { key: 'edited' };
      const editorial = change.before === 'editorial';
      const added = change.delta > 0;
      const key = editorial ? (added ? 'editorialAdded' : 'editorialRemoved') : added ? 'linksAdded' : 'linksRemoved';
      return { key, count: Math.abs(change.delta) };
    }
  }
}

/** What a content version lists: its changes, or one `edited` line when the server sent none. */
export const versionChanges = (version: HistoryVersion): HistoryChange[] =>
  version.changes.length > 0
    ? version.changes
    : [{ type: 'edited', before: null, after: null, delta: null, level: null }];

/** The heading a change line shows under its label: the new text of an added heading, the old text of a removed one. */
export const headingText = (change: HistoryChange): string | null =>
  change.type === 'heading_added' ? change.after : change.type === 'heading_removed' ? change.before : null;

/** A title or description change shows the old text struck out above the new. */
export const isTextSwap = (change: HistoryChange): boolean => change.type === 'title' || change.type === 'description';

/** Whether a row of the timeline opens: a first crawl has nothing to show beyond its summary. */
export const isExpandable = (version: HistoryVersion): boolean => version.kind !== 'first';

/** The newest content change: the row open when the tab shows a page for the first time. */
export const newestContentRun = (versions: readonly HistoryVersion[]): string | null =>
  versions.find((version) => version.kind === 'content')?.run_id ?? null;

/** Whether the first crawl is the first one kept (history starts there) or the page appeared later. */
export const isNewPage = (history: Pick<PageHistory, 'first_seen' | 'history_starts'>): boolean =>
  history.history_starts !== null && Date.parse(history.first_seen) > Date.parse(history.history_starts);

export type GoogleState = 'none' | 'crawled' | 'behind';

/** `none` for a page not in Monitoring or with no crawl date yet; `behind` when Google's last crawl is older than the last change. */
export function googleState(history: Pick<PageHistory, 'google'>): GoogleState {
  const google = history.google;
  if (google === null || google.crawled_at === null) return 'none';
  return google.behind ? 'behind' : 'crawled';
}

export type StripNote =
  | { key: 'editedFrom'; origin: string }
  | { key: 'editedNone' | 'editedUnreliable' | 'changeNoHistory' | 'firstNew' }
  | { key: 'changeCount'; count: number }
  | { key: 'changeSince' | 'firstStarts'; date: string }
  | { key: 'googleBefore' | 'googleAfter' | 'googleFrom' | 'googleNone' | 'googleNoDate' | 'googleNotRead' };

export interface StripCell {
  id: 'lastEdited' | 'lastChange' | 'firstSeen' | 'googleCrawled';
  /** A formatted date, or `null` for "None". */
  date: string | null;
  note: StripNote;
  /** A warning tone for a state that needs action (Google is behind). */
  warn: boolean;
}

const ORIGINS: readonly string[] = ['json_ld', 'meta_modified', 'og_updated', 'sitemap'];

/**
 * A declared date is often date-only (sitemap lastmod, JSON-LD without a time) and stored as midnight UTC, so it
 * is shown as its UTC calendar date. Crawl dates are instants and keep the project time zone.
 */
const declaredDate = (instant: string): string => historyDate(instant, 'UTC');

/** The four cells of the strip, in order. */
export function stripCells(history: PageHistory, timeZone: string): StripCell[] {
  const date = (instant: string | null): string | null => (instant === null ? null : historyDate(instant, timeZone));
  const starts = date(history.history_starts);
  const google = googleState(history);

  const edited: StripCell = history.declared
    ? {
        id: 'lastEdited',
        date: declaredDate(history.declared.date),
        note: {
          key: 'editedFrom',
          origin: ORIGINS.includes(history.declared.source) ? history.declared.source : 'other',
        },
        warn: false,
      }
    : {
        id: 'lastEdited',
        date: null,
        note: { key: history.declared_unreliable ? 'editedUnreliable' : 'editedNone' },
        warn: false,
      };

  let lastChangeNote: StripNote = { key: 'changeNoHistory' };
  if (history.last_change !== null) lastChangeNote = { key: 'changeCount', count: history.changes };
  else if (starts !== null) lastChangeNote = { key: 'changeSince', date: starts };

  let firstNote: StripNote = { key: 'firstNew' };
  if (!isNewPage(history))
    firstNote = starts === null ? { key: 'changeNoHistory' } : { key: 'firstStarts', date: starts };

  let googleNote: StripNote = {
    key: history.google === null ? (history.tracked ? 'googleNotRead' : 'googleNone') : 'googleNoDate',
  };
  if (google === 'behind') googleNote = { key: 'googleBefore' };
  else if (google === 'crawled') googleNote = { key: history.last_change === null ? 'googleFrom' : 'googleAfter' };

  return [
    edited,
    { id: 'lastChange', date: date(history.last_change), note: lastChangeNote, warn: false },
    { id: 'firstSeen', date: date(history.first_seen), note: firstNote, warn: false },
    {
      id: 'googleCrawled',
      date: date(history.google?.crawled_at ?? null),
      note: googleNote,
      warn: google === 'behind',
    },
  ];
}

export type LineState =
  { kind: 'edited'; date: string } | { kind: 'changed'; date: string } | { kind: 'unchanged'; date: string };

/**
 * The Overview line: the declared date, else the last change seen, else "no change seen since" the start of the
 * history. `null` for a page with nothing to say (unreadable, or no crawl kept).
 */
export function lastEditedLine(history: PageHistory, timeZone: string): LineState | null {
  if (!history.readable) return null;
  if (history.declared) return { kind: 'edited', date: declaredDate(history.declared.date) };
  if (history.last_change !== null) return { kind: 'changed', date: historyDate(history.last_change, timeZone) };
  if (history.history_starts !== null)
    return { kind: 'unchanged', date: historyDate(history.history_starts, timeZone) };
  return null;
}
