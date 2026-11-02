import { apiWindow, type DetailWindow } from './detail-window';
import {
  effectiveCompetitorIds,
  keywordPath,
  rankHistoryQuery,
  type CompetitorOverride,
  type KeywordScope,
  type ProjectEntity,
} from '../keyword-inspector/inspector-queries';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';

const AIO_HISTORY =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/aio-history';

/**
 * What the keyword page reads beyond the keyword itself. The routes sit under the keyword's key, so a
 * finished Check now refreshes them with the list (`refreshKeywords`).
 */

/** The API takes at most 11 entities in one history: the own site and ten competitors. */
export const MAX_HISTORY_COMPETITORS = 10;

export interface ChartCompetitors {
  /** Every competitor the keyword has, by name: what the page can offer. */
  all: ProjectEntity[];
  /** The ones the history is asked for: the first ten by name. */
  asked: string[];
}

/** The keyword's effective competitors by name, and the ten the history is asked for. */
export function chartCompetitors(
  entities: readonly ProjectEntity[],
  overrides: readonly CompetitorOverride[],
): ChartCompetitors {
  const ids = effectiveCompetitorIds(entities, overrides);
  const all = entities
    .filter((entity) => ids.has(entity.entity.entity_id))
    .sort((a, b) => a.entity.canonical_name.localeCompare(b.entity.canonical_name));
  return { all, asked: all.slice(0, MAX_HISTORY_COMPETITORS).map((entity) => entity.entity.entity_id) };
}

/**
 * The history one window of the page draws: one request per window, with every competitor asked for and
 * the absolute rank and the events always included, so toggling a layer or choosing which competitors
 * to draw never reads again.
 */
export const pageRankHistoryQuery = (
  scope: KeywordScope,
  win: DetailWindow,
  competitorIds: readonly string[],
): ReturnType<typeof rankHistoryQuery> =>
  rankHistoryQuery(scope, {
    window: apiWindow(win),
    entityIds: ['own', ...competitorIds],
    include: ['absolute', 'events'],
  });

/**
 * The AI Overview checks of the keyword between two local days, both included (`windowDates`). The strip
 * counts them and the AI Overview history lists them: both ask with the same days, so it is one request.
 */
export const aioHistoryQuery = (
  scope: KeywordScope,
  days: { from: string; to: string },
): ApiQueryOptions<typeof AIO_HISTORY> =>
  apiQuery(AIO_HISTORY, { params: { path: keywordPath(scope), query: { from: days.from, to: days.to } } });
