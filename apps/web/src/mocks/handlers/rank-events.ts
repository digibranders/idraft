import { HttpResponse, type HttpHandler } from 'msw';

import { keywordProjectCaller, termAndBelow } from './keyword-rules';
import { cursorPage, pageRequest, queryError } from './rules';
import { groupAndBelow } from '../factories/keyword';
import { worldEvents } from '../rank-events';
import { invalid, mock, problem } from '../respond';
import {
  daysBetween,
  isUuid,
  isWithinBounds,
  ownEntityOf,
  parseDateOrInstant,
  projectHostOf,
  shiftIsoDate,
  toTimeBounds,
  urlRefOf,
  worldInputFor,
  type ParsedDateParam,
} from '../serp-views';
import type { Schemas } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const QUERY_PARAMS = [
  'from',
  'to',
  'filter[event_type_in]',
  'filter[tracked_keyword_id]',
  'filter[entity_id]',
  'filter[group]',
  'filter[term]',
  'limit',
  'cursor',
] as const;

export const rankEventsHandlers: readonly HttpHandler[] = [
  mock('get', `${P}/seo/rank-events`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: QUERY_PARAMS,
    });
    if (caller instanceof Response) return caller;

    const url = new URL(request.url);
    const pageReq = pageRequest(url);
    if (Array.isArray(pageReq)) return invalid(request, pageReq);

    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    const eventTypesParam = url.searchParams.get('filter[event_type_in]');
    const trackedKeywordIdParam = url.searchParams.get('filter[tracked_keyword_id]');
    const entityIdParam = url.searchParams.get('filter[entity_id]');
    const groupParam = url.searchParams.get('filter[group]');
    const termParam = url.searchParams.get('filter[term]');

    if (trackedKeywordIdParam !== null && !isUuid(trackedKeywordIdParam)) {
      return invalid(request, [
        queryError('filter[tracked_keyword_id]', 'uuid_parsing', 'Input should be a valid UUID'),
      ]);
    }
    if (entityIdParam !== null && !isUuid(entityIdParam)) {
      return invalid(request, [queryError('filter[entity_id]', 'uuid_parsing', 'Input should be a valid UUID')]);
    }
    if (groupParam !== null && !isUuid(groupParam)) {
      return invalid(request, [queryError('filter[group]', 'uuid_parsing', 'Input should be a valid UUID')]);
    }
    if (termParam !== null && !isUuid(termParam)) {
      return invalid(request, [queryError('filter[term]', 'uuid_parsing', 'Input should be a valid UUID')]);
    }

    let eventTypes: Set<string> | null = null;
    if (eventTypesParam !== null) {
      const tokens = eventTypesParam.split(',').filter(Boolean);
      if (tokens.length > 30) {
        return invalid(request, [
          queryError('filter[event_type_in]', 'too_long', 'List should have at most 30 items.'),
        ]);
      }
      eventTypes = new Set(tokens);
    }

    const clock = Date.now();
    let since: ParsedDateParam | null = null;
    let until: ParsedDateParam | null = null;

    if (fromParam !== null) {
      since = parseDateOrInstant(fromParam, caller.project.timezone);
      if (since === null) {
        return invalid(request, [
          queryError('from', 'date_from_datetime_parsing', 'Input should be a valid date or datetime'),
        ]);
      }
    }

    if (toParam !== null) {
      until = parseDateOrInstant(toParam, caller.project.timezone);
      if (until === null) {
        return invalid(request, [
          queryError('to', 'date_from_datetime_parsing', 'Input should be a valid date or datetime'),
        ]);
      }
    }

    if (since !== null && until !== null) {
      if (since.isInstant && until.isInstant) {
        if ((since.instantMs ?? 0) > (until.instantMs ?? 0)) {
          return invalid(request, [queryError('from', 'range_invalid', '`from` is after `to`.')]);
        }
      } else if (since.localDate && until.localDate) {
        if (since.localDate > until.localDate) {
          return invalid(request, [queryError('from', 'range_invalid', '`from` is after `to`.')]);
        }
      }
    }

    if (trackedKeywordIdParam === null) {
      if (since === null && until === null) {
        const lastDate = formatIsoDate(new Date(clock).toISOString(), caller.project.timezone);
        const firstDate = shiftIsoDate(lastDate, -89);
        since = { isInstant: false, localDate: firstDate };
        until = { isInstant: false, localDate: lastDate };
      } else {
        const lastDate = until?.localDate ?? formatIsoDate(new Date(clock).toISOString(), caller.project.timezone);
        const firstDate = since?.localDate ?? shiftIsoDate(lastDate, -89);
        if (daysBetween(firstDate, lastDate) > 90) {
          return problem(request, 'window_too_large', {
            detail: 'Without a keyword, a request covers at most 90 days.',
            limit_days: 90,
          });
        }
      }
    }

    let trackedRows = caller.keywords.tracked.filter(
      (k) => k.project_id === caller.project.project_id && k.deleted_at === null,
    );

    if (trackedKeywordIdParam !== null) {
      const match = trackedRows.find((k) => k.tracked_keyword_id === trackedKeywordIdParam);
      if (match === undefined) {
        return HttpResponse.json({
          data: [],
          page: {
            limit: pageReq.limit,
            next_cursor: null,
            has_more: false,
          },
        });
      }
      trackedRows = [match];
    }

    if (groupParam !== null) {
      const groups = groupAndBelow(caller.keywords, groupParam);
      const members = new Set(
        caller.keywords.members.filter((m) => groups.has(m.group_id)).map((m) => m.tracked_keyword_id),
      );
      trackedRows = trackedRows.filter((k) => members.has(k.tracked_keyword_id));
    }

    if (termParam !== null) {
      const terms = termAndBelow(caller, termParam);
      const linked = new Set(
        caller.keywords.termLinks.filter((l) => terms.has(l.term_id)).map((l) => l.tracked_keyword_id),
      );
      trackedRows = trackedRows.filter((k) => linked.has(k.tracked_keyword_id));
    }

    const ownEntity = ownEntityOf(caller);
    const host = projectHostOf(caller);
    const allEvents: Schemas['RankEventOut'][] = [];

    const timeBounds = toTimeBounds(since, until, caller.project.timezone);
    const kwTextMap = new Map(caller.keywords.keywords.map((k) => [k.keyword_id, k.text]));

    // The mock retains 30 checks per keyword, and therefore produces events across those 30 checks.
    for (const kwRow of trackedRows) {
      const worldInput = worldInputFor(caller, kwRow, clock, ownEntity);
      const compMap = new Map(worldInput.competitors.map((c) => [c.entity_id, c]));
      const kwText = kwTextMap.get(kwRow.keyword_id) ?? '';

      const events = worldEvents(worldInput);

      for (const ev of events) {
        const tsMs = Date.parse(ev.occurredAt);
        if (!isWithinBounds(tsMs, timeBounds)) continue;
        if (eventTypes !== null && !eventTypes.has(ev.eventType)) continue;

        const otherEntity = ev.otherEntityId ? (compMap.get(ev.otherEntityId) ?? null) : null;

        if (entityIdParam !== null) {
          const matchesOwn = ownEntity.entity_id === entityIdParam;
          const matchesOther = otherEntity?.entity_id === entityIdParam;
          if (!matchesOwn && !matchesOther) continue;
        }

        const fromUrl = host !== null && ev.fromPath !== null ? urlRefOf(host, ev.fromPath) : null;
        const toUrl = host !== null && ev.toPath !== null ? urlRefOf(host, ev.toPath) : null;

        allEvents.push({
          rank_event_id: ev.id,
          event_type: ev.eventType,
          occurred_at: ev.occurredAt,
          entity: ownEntity,
          other_entity: otherEntity,
          from_rank: ev.fromRank,
          to_rank: ev.toRank,
          from_url: fromUrl,
          to_url: toUrl,
          feature_type: ev.featureType,
          keyword: kwText,
          tracked_keyword_id: kwRow.tracked_keyword_id,
          serp_snapshot_id: ev.snapshotId ?? '',
        });
      }
    }

    // Sort newest first with rank_event_id as numeric bigint tiebreaker (M1)
    allEvents.sort((a, b) => {
      if (b.occurred_at > a.occurred_at) return 1;
      if (b.occurred_at < a.occurred_at) return -1;
      const lenDiff = b.rank_event_id.length - a.rank_event_id.length;
      if (lenDiff !== 0) return lenDiff;
      return b.rank_event_id > a.rank_event_id ? 1 : b.rank_event_id < a.rank_event_id ? -1 : 0;
    });

    const filterBinding = JSON.stringify({
      kw: trackedKeywordIdParam,
      from: fromParam,
      to: toParam,
      types: eventTypesParam,
      entity: entityIdParam,
      group: groupParam,
      term: termParam,
    });

    const paged = cursorPage(allEvents, pageReq, filterBinding);
    if (paged === null) {
      return problem(request, 'invalid_cursor');
    }

    return HttpResponse.json(paged);
  }),
];
