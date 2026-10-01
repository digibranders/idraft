import {
  identitiesOf,
  newKeyword,
  newTrackedRow,
  now,
  rowWithIdentity,
  workspaceKeyword,
  type CreateItem,
  type KeywordProjectCaller,
  type ScheduleCheck,
} from './keyword-rules';
import { normalizeKeyword } from '@/lib/keywords/keyword-text';
import {
  keywordWorld,
  withKeyword,
  withMembers,
  withOverrides,
  withTermLinks,
  withTracked,
  type KeywordChanges,
  type StoredTracked,
} from '../keywords-state';

/**
 * Tracking keywords, as the create routes and the import writer share it (backend plan D3 and D12): a new
 * keyword of the workspace when its text is new, then per device a new row, a deleted row brought back, or
 * the row it duplicates; and the links each kind of row gets.
 */

export interface Planned {
  /** The rows the item gives: new, restored, or the existing ones it duplicates. */
  rows: { row: StoredTracked; kind: 'new' | 'restored' | 'duplicate' }[];
  changes: KeywordChanges;
}

/** What tracking `item` would do on top of `changes`; a new row records where it came from. */
export function plan(
  caller: KeywordProjectCaller,
  item: CreateItem,
  changes: KeywordChanges,
  next: (kind: 'keyword' | 'tracked') => string,
  scheduleIsLive: ScheduleCheck,
  source: StoredTracked['source'] = 'manual',
): Planned {
  const world = keywordWorld(changes);
  const identity = identitiesOf(caller, item);
  const normalized = normalizeKeyword(item.text);
  const workspaceId = caller.access.workspace.workspace_id;
  let current = changes;
  let keyword = workspaceKeyword(world, workspaceId, normalized, identity.languageCode);
  if (keyword === undefined) {
    keyword = newKeyword(caller, next('keyword'), item.text, identity.languageCode);
    current = withKeyword(current, keyword);
  }
  const keywordId = keyword.keyword_id;
  const rows = identity.devices.map((device): Planned['rows'][number] => {
    const existing = rowWithIdentity(
      world,
      caller.project.project_id,
      keywordId,
      identity.locationId,
      identity.languageCode,
      device,
    );
    if (existing === undefined) {
      return {
        row: newTrackedRow(
          caller,
          item,
          { trackedKeywordId: next('tracked'), keywordId },
          { ...identity, device },
          source,
        ),
        kind: 'new',
      };
    }
    if (existing.deleted_at !== null) {
      // It comes back with its settings, less a schedule deleted meanwhile
      const scheduleId =
        existing.schedule_id !== null && scheduleIsLive(caller.project.project_id, existing.schedule_id)
          ? existing.schedule_id
          : null;
      return {
        row: { ...existing, deleted_at: null, is_active: true, schedule_id: scheduleId, updated_at: now() },
        kind: 'restored',
      };
    }
    return { row: existing, kind: 'duplicate' };
  });
  return { rows, changes: current };
}

/**
 * `changes` with the rows written. A new row gets the item's groups, terms and overrides. A restored row
 * keeps its stored links and overrides, gains the item's groups and its terms where they fit (a
 * single-valued vocabulary keeps the stored term), and does not take the item's overrides.
 */
export function written(
  caller: KeywordProjectCaller,
  changes: KeywordChanges,
  entries: readonly Planned['rows'][number][],
  item: CreateItem,
): KeywordChanges {
  let next = changes;
  for (const { row, kind } of entries) {
    const id = row.tracked_keyword_id;
    next = withTracked(next, row);
    if (kind === 'restored') {
      next = mergeTerms(caller, next, id, item);
      continue;
    }
    next = withMembers(
      next,
      item.groupIds.map((group_id) => ({ group_id, tracked_keyword_id: id })),
      [],
    );
    next = withTermLinks(
      next,
      item.termIds.map((term_id) => ({ term_id, tracked_keyword_id: id })),
      [],
    );
    if (item.include.length > 0 || item.exclude.length > 0) {
      next = withOverrides(next, id, [
        ...item.include.map((entity_id) => ({ tracked_keyword_id: id, entity_id, mode: 'include' as const })),
        ...item.exclude.map((entity_id) => ({ tracked_keyword_id: id, entity_id, mode: 'exclude' as const })),
      ]);
    }
  }
  return next;
}

/**
 * The item's groups and terms added to an existing row (`merge_terms`, a restore, an import's merge), except
 * a term of a single-valued vocabulary the row already has one of.
 */
export function mergeTerms(
  caller: KeywordProjectCaller,
  changes: KeywordChanges,
  trackedKeywordId: string,
  item: Pick<CreateItem, 'groupIds' | 'termIds'>,
): KeywordChanges {
  const world = keywordWorld(changes);
  const held = world.termLinks
    .filter((link) => link.tracked_keyword_id === trackedKeywordId)
    .flatMap((link) =>
      caller.world.terms.filter((term) => term.term_id === link.term_id).map((term) => term.vocabulary_id),
    );
  const single = new Set(
    caller.world.vocabularies.filter((vocabulary) => vocabulary.is_single_valued === true).map((v) => v.vocabulary_id),
  );
  const terms = item.termIds.filter((termId) => {
    const vocabulary = caller.world.terms.find((term) => term.term_id === termId)?.vocabulary_id;
    return vocabulary === undefined || !single.has(vocabulary) || !held.includes(vocabulary);
  });
  return withTermLinks(
    withMembers(
      changes,
      item.groupIds.map((group_id) => ({ group_id, tracked_keyword_id: trackedKeywordId })),
      [],
    ),
    terms.map((term_id) => ({ term_id, tracked_keyword_id: trackedKeywordId })),
    [],
  );
}
