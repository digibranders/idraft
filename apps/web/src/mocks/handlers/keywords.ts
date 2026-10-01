import { HttpResponse, type HttpHandler } from 'msw';

import { keywordsOfWorkspace, keywordWorkspaceCaller, type KeywordWorkspaceCaller } from './keyword-rules';
import { cursorPage, pageRequest, queryError } from './rules';
import { keywordView, metricsHistory, readingOf } from '../factories/keyword';
import { keywordMetrics } from '../keyword-metrics';
import { fixtureReadingsOf } from '../keyword-fixtures';
import { normalizeKeyword } from '@/lib/keywords/keyword-text';
import type { StoredKeyword, StoredTracked } from '../keywords-state';
import { invalid, mock, problem } from '../respond';
import type { ValidationItem } from '@/lib/api/types';

/**
 * The workspace's keywords (19 section 3.6.1, as built): a keyword is shared by every project that tracks
 * it, with Labs metrics per location and language. A member limited to some projects sees the keywords
 * those projects track, their variants, and metrics only where those variants are tracked.
 */

const W = '/api/v1/workspaces/{workspace_id}';
const SOURCES = ['dataforseo_labs', 'dataforseo_google_ads', 'dataforseo_clickstream'] as const;

/** The live tracked keywords of the projects the caller sees, archived ones included. */
function visibleVariants(caller: KeywordWorkspaceCaller): StoredTracked[] {
  const projects = new Set(caller.projects.map((project) => project.project_id));
  return caller.keywords.tracked.filter((row) => projects.has(row.project_id) && row.deleted_at === null);
}

/** The keywords the caller may see: all of the workspace's, or those their projects track. */
function visibleKeywords(caller: KeywordWorkspaceCaller): StoredKeyword[] {
  const all = keywordsOfWorkspace(caller.keywords, caller.access.workspace.workspace_id);
  if (caller.access.membership.project_ids === null) return all;
  const tracked = new Set(visibleVariants(caller).map((row) => row.keyword_id));
  return all.filter((row) => tracked.has(row.keyword_id));
}

/** The locations and languages a keyword has a reading at, as far as the caller may see. */
function readingPlaces(
  caller: KeywordWorkspaceCaller,
  keyword: StoredKeyword,
): { locationId: number; languageCode: string }[] {
  const variants = caller.keywords.tracked.filter(
    (row) => row.keyword_id === keyword.keyword_id && row.deleted_at === null,
  );
  const places = new Map<string, { locationId: number; languageCode: string }>();
  for (const { locationId, languageCode } of fixtureReadingsOf(keyword.keyword_id)) {
    places.set(`${String(locationId)}:${languageCode}`, { locationId, languageCode });
  }
  for (const row of variants) {
    places.set(`${String(row.location_id)}:${row.language_code}`, {
      locationId: row.location_id,
      languageCode: row.language_code,
    });
  }
  const limited = caller.access.membership.project_ids !== null;
  const seen = new Set(
    visibleVariants(caller)
      .filter((row) => row.keyword_id === keyword.keyword_id)
      .map((row) => `${String(row.location_id)}:${row.language_code}`),
  );
  return [...places.entries()]
    .filter(([key]) => !limited || seen.has(key))
    .map(([, place]) => place)
    .sort((a, b) => a.locationId - b.locationId || a.languageCode.localeCompare(b.languageCode));
}

export const keywordHandlers: HttpHandler[] = [
  mock('get', `${W}/keywords`, ({ request, cookies, params }) => {
    const caller = keywordWorkspaceCaller(request, cookies, params.workspace_id, {
      permission: 'data:read',
      query: ['filter[q]', 'filter[language_code]', 'cursor', 'limit'],
    });
    if (caller instanceof Response) return caller;
    const q = caller.url.searchParams.get('filter[q]');
    const language = caller.url.searchParams.get('filter[language_code]');
    const paging = pageRequest(caller.url);
    const errors: ValidationItem[] = [
      ...(q !== null && (q.length < 1 || q.length > 200)
        ? [queryError('filter[q]', q.length < 1 ? 'string_too_short' : 'string_too_long', 'From 1 to 200 characters.')]
        : []),
      ...languageError(language, 'filter[language_code]'),
      ...(Array.isArray(paging) ? paging : []),
    ];
    if (errors.length > 0 || Array.isArray(paging)) return invalid(request, errors);
    const needle = q === null ? null : normalizeKeyword(q);
    const rows = visibleKeywords(caller)
      .filter(
        (row) =>
          (needle === null || normalizeKeyword(row.text).includes(needle)) &&
          (language === null || row.language_code === language),
      )
      // By code unit, as the tracked keyword list sorts its texts
      .sort(
        (a, b) =>
          byCodeUnit(normalizeKeyword(a.text), normalizeKeyword(b.text)) || byCodeUnit(a.keyword_id, b.keyword_id),
      );
    const page = cursorPage(rows, paging, JSON.stringify({ sort: 'text', q, language_code: language }));
    if (page === null) return problem(request, 'invalid_cursor');
    return HttpResponse.json({ data: page.data.map(keywordView), page: page.page });
  }),

  mock('get', `${W}/keywords/{keyword_id}`, ({ request, cookies, params }) => {
    const caller = keywordWorkspaceCaller(request, cookies, params.workspace_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const keyword = visibleKeywords(caller).find((row) => row.keyword_id === params.keyword_id);
    if (keyword === undefined) return problem(request, 'not_found');
    const metrics = readingPlaces(caller, keyword).flatMap(({ locationId, languageCode }) => {
      const found = readingOf(caller.keywords, keyword.keyword_id, locationId, languageCode);
      return found === null
        ? []
        : [
            keywordMetrics({
              keywordId: keyword.keyword_id,
              locationId,
              languageCode,
              ...found.reading,
              fetchedAt: found.fetchedAt,
            }),
          ];
    });
    const tracked = visibleVariants(caller)
      .filter((row) => row.keyword_id === keyword.keyword_id)
      .sort(
        (a, b) =>
          a.project_id.localeCompare(b.project_id) ||
          a.location_id - b.location_id ||
          a.device.localeCompare(b.device) ||
          a.tracked_keyword_id.localeCompare(b.tracked_keyword_id),
      )
      .map((row) => ({
        tracked_keyword_id: row.tracked_keyword_id,
        project_id: row.project_id,
        location_id: row.location_id,
        language_code: row.language_code,
        device: row.device,
        is_active: row.is_active,
      }));
    return HttpResponse.json({ data: { ...keywordView(keyword), metrics, tracked } });
  }),

  mock('get', `${W}/keywords/{keyword_id}/metrics-history`, ({ request, cookies, params }) => {
    const caller = keywordWorkspaceCaller(request, cookies, params.workspace_id, {
      permission: 'data:read',
      query: ['location_id', 'language_code', 'source', 'from', 'to'],
    });
    if (caller instanceof Response) return caller;
    const keyword = visibleKeywords(caller).find((row) => row.keyword_id === params.keyword_id);
    if (keyword === undefined) return problem(request, 'not_found');
    const locationRaw = caller.url.searchParams.get('location_id');
    const language = caller.url.searchParams.get('language_code');
    const source = caller.url.searchParams.get('source') ?? 'dataforseo_labs';
    const errors: ValidationItem[] = [
      ...(locationRaw === null
        ? [queryError('location_id', 'missing', 'Field required')]
        : /^\d+$/.test(locationRaw)
          ? []
          : [queryError('location_id', 'int_parsing', 'Input should be a valid integer')]),
      ...(language === null
        ? [queryError('language_code', 'missing', 'Field required')]
        : languageError(language, 'language_code')),
      ...(SOURCES.some((option) => option === source)
        ? []
        : [queryError('source', 'enum', `Allowed: ${SOURCES.join(', ')}.`)]),
      ...dateError(caller.url.searchParams.get('from'), 'from'),
      ...dateError(caller.url.searchParams.get('to'), 'to'),
    ];
    if (errors.length > 0 || locationRaw === null || language === null) return invalid(request, errors);
    const locationId = Number(locationRaw);
    const allowed = readingPlaces(caller, keyword).some(
      (place) => place.locationId === locationId && place.languageCode === language,
    );
    const found =
      source === 'dataforseo_labs' && allowed
        ? readingOf(caller.keywords, keyword.keyword_id, locationId, language)
        : null;
    // `from` and `to` bound the snapshots by the day they were fetched; the mocks keep one each
    const day = found?.fetchedAt.slice(0, 10) ?? null;
    const from = caller.url.searchParams.get('from');
    const to = caller.url.searchParams.get('to');
    const inRange = day !== null && (from === null || day >= from) && (to === null || day <= to);
    const history = metricsHistory(
      found === null || !inRange
        ? null
        : {
            keywordId: keyword.keyword_id,
            locationId,
            languageCode: language,
            ...found.reading,
            fetchedAt: found.fetchedAt,
          },
      String(Math.abs(hashText(`${keyword.keyword_id}:${String(locationId)}:${language}`))),
    );
    return HttpResponse.json({
      data: {
        ...history,
        trend: { ...history.trend, source, filters: { location_id: locationId, language_code: language } },
      },
    });
  }),
];

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Two lower-case letters, as the API's language codes are. */
const languageError = (value: string | null, path: string): ValidationItem[] =>
  value === null || /^[a-z]{2}$/.test(value)
    ? []
    : [queryError(path, 'string_pattern_mismatch', 'Two lower-case letters.')];

/** A calendar date, `YYYY-MM-DD`. */
const dateError = (value: string | null, path: string): ValidationItem[] =>
  value === null || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    ? []
    : [queryError(path, 'date_from_datetime_parsing', 'Input should be a valid date')];

/** A whole number from a text, for a snapshot id that stays the same. */
function hashText(text: string): number {
  let hash = 7;
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0;
  return hash;
}
