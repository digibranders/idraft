'use client';

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { promptsKey, type LintAnswer, type PromptScope } from '../prompt-queries';
import { api, unwrap } from '@/lib/api/client';
import { apiQuery } from '@/lib/api/query';
import type { EngineCode, Schemas } from '@/lib/api/types';

/** The reads and the lint of the Add prompts dialog. `prompt-queries.ts` is leased to another package, so they live here. */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const LINT = `${P}/prompts/lint` as const;
const SCHEDULES = `${P}/schedules` as const;
const LANGUAGE = /^[a-z]{2}$/;
const COUNTRY = /^[A-Z]{2}$/;

const pathOf = (scope: PromptScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

export interface AddLintInput {
  /** The lines to check, as the field read them: distinct, and none the API would refuse. */
  texts: readonly string[];
  languageCode: string;
  countryIso: string;
  /** The project's enabled engines, whose length limits apply; none given, every engine's limit applies. */
  engineCodes: readonly EngineCode[];
}

/**
 * The lint body. With a language and a country chosen it is the `items` shape, which also answers what the project
 * tracks, the places the add takes and what it costs. Before a country is chosen it is the `texts` shape, with the
 * language when there is one: the warnings only.
 */
export function lintBodyOf(input: AddLintInput): Schemas['PromptLintItems'] | Schemas['PromptLintRequest'] {
  const engines = input.engineCodes.length === 0 ? {} : { engine_codes: [...input.engineCodes] };
  const language = LANGUAGE.test(input.languageCode);
  if (language && COUNTRY.test(input.countryIso)) {
    return {
      items: input.texts.map((text) => ({ text, language_code: input.languageCode, country_iso: input.countryIso })),
      ...engines,
    };
  }
  return { texts: [...input.texts], ...(language ? { language_code: input.languageCode } : {}), ...engines };
}

/**
 * `POST {P}/prompts/lint` for the lines of the field: nothing is stored. The key sits under the project's prompts,
 * so a change to them reads it again, and the last answer stays while the next one is on its way.
 */
export function useAddLint(scope: PromptScope, input: AddLintInput): UseQueryResult<LintAnswer> {
  const body = lintBodyOf(input);
  return useQuery({
    queryKey: [...promptsKey(scope), 'add-lint', body],
    queryFn: ({ signal }) => unwrap(api.POST(LINT, { params: { path: pathOf(scope) }, body, signal })),
    enabled: input.texts.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/** The earliest next run of the schedules that are active; `null` when none is, as when they are all paused. */
export function nextRunOf(schedules: readonly Pick<Schemas['Schedule'], 'is_active' | 'next_run_at'>[]): string | null {
  const times = schedules.filter((schedule) => schedule.is_active).map((schedule) => schedule.next_run_at);
  return times.length === 0
    ? null
    : times.reduce((first, time) => (Date.parse(time) < Date.parse(first) ? time : first));
}

export interface NextScheduled {
  status: 'loading' | 'ready' | 'failed';
  nextRunAt: string | null;
}

/** When the project's active AI answer schedules run next. The key is the one the Schedules screen refreshes. */
export function useNextScheduled(scope: PromptScope): NextScheduled {
  const query = useQuery(
    apiQuery(SCHEDULES, {
      params: { path: pathOf(scope), query: { 'filter[workload]': 'ai_prompt', 'filter[is_active]': true } },
    }),
  );
  if (query.data !== undefined) return { status: 'ready', nextRunAt: nextRunOf(query.data.data) };
  return { status: query.isError ? 'failed' : 'loading', nextRunAt: null };
}
