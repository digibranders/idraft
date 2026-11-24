import {
  useInfiniteQuery,
  type QueryClient,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from '@tanstack/react-query';

import { api, unwrap } from '@/lib/api/client';
import { projectKey, type QueryKey } from '@/lib/api/keys';
import { apiAllPagesQuery, apiMutation, apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { paths } from '@/lib/api/schema';

/**
 * A project's alert rules and alerts (19 section 3.12). The rules are read whole; the alerts come in cursor
 * pages, newest first. Every write is pessimistic: the screen waits for the answer and reads again.
 */

const BASE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const RULES = `${BASE}/alert-rules` as const;
const RULE = `${RULES}/{alert_rule_id}` as const;
const EVENTS = `${BASE}/alert-events` as const;
const ACKNOWLEDGE = `${EVENTS}/acknowledge` as const;
const RULE_TYPES = '/api/v1/alert-rule-types';

type EventPage = paths[typeof EVENTS]['get']['responses'][200]['content']['application/json'];

/** The workspace and the project whose alerts are read. */
export interface AlertScope {
  workspaceId: string;
  projectId: string;
}

/** The alerts asked for in one page. */
const PAGE = 50;
/** The cursor of the first page: none. */
const FIRST_PAGE: string | null = null;
/** The most alerts one acknowledge call takes (the API refuses more). */
export const MAX_ACKNOWLEDGE = 500;

const rulesKey = (scope: AlertScope): QueryKey => [...projectKey(scope.workspaceId, scope.projectId), 'alert-rules'];
const eventsKey = (scope: AlertScope): QueryKey => [...projectKey(scope.workspaceId, scope.projectId), 'alert-events'];

/** Every rule of the project, oldest first. Read again whenever it is asked for. */
export const alertRulesQuery = (scope: AlertScope): ApiQueryOptions<typeof RULES> => ({
  ...apiAllPagesQuery(RULES, (rule) => rule.id, {
    params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
  }),
  staleTime: 0,
});

/** The rule types the API offers. */
export const alertRuleTypesQuery = (): ApiQueryOptions<typeof RULE_TYPES> => apiQuery(RULE_TYPES);

/** The alerts of the project, newest first, one cursor page after another. */
export function useAlertEvents(scope: AlertScope): UseInfiniteQueryResult<InfiniteData<EventPage, string | null>> {
  return useInfiniteQuery({
    queryKey: [...eventsKey(scope), 'list'],
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET(EVENTS, {
          params: {
            path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
            query: { limit: PAGE, ...(pageParam === null ? {} : { cursor: pageParam }) },
          },
          signal,
        }),
      ),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => (last.page.has_more ? last.page.next_cursor : null),
    staleTime: 0,
  });
}

/** After a change to a rule: the rules, and the alerts, which name their rule. */
export function refreshRules(queryClient: QueryClient, scope: AlertScope): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: rulesKey(scope) }),
    queryClient.invalidateQueries({ queryKey: eventsKey(scope) }),
  ]).then(() => undefined);
}

/** After an alert is acknowledged: the alerts. */
export function refreshEvents(queryClient: QueryClient, scope: AlertScope): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: eventsKey(scope) });
}

export const CREATE_ALERT_RULE = apiMutation('post', RULES);
export const UPDATE_ALERT_RULE = apiMutation('patch', RULE);
export const DELETE_ALERT_RULE = apiMutation('delete', RULE);
export const ACKNOWLEDGE_ALERTS = apiMutation('post', ACKNOWLEDGE);
