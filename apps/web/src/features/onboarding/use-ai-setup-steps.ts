'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';

import { aiSetupSteps, enginesFacts, type EngineFacts, type Read, type SetupStep } from './setup-steps';
import { apiQuery } from '@/lib/api/query';
import { projectPath } from '@/lib/routes/paths';

/**
 * The reads behind the AI steps of the setup checklist (WB-SET-17): `GET {P}/engines` for the engines on and the
 * active prompts, and `GET {P}/ai/observations?limit=1` for whether the project has an answer yet (without a
 * window the API reads the last 28 days).
 *
 * The keys are the paths' own, so they start `[...project, 'engines']` and `[...project, 'ai', 'observations']`:
 * the prompts feature's `refreshPrompts`, after an engine or a prompt changes, invalidates them. The feature does
 * not import it (features do not import each other); the keys are the contract, and the tests spell them out.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const ENGINES = `${P}/engines` as const;
const ANSWERS = `${P}/ai/observations` as const;

export interface AiSetupScope {
  workspaceId: string;
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
}

export type AiSetupState =
  /** A read has not answered: no step is shown, so none can read as done. */
  | { status: 'loading' }
  /** Both reads failed. */
  | { status: 'error'; error: unknown; retry: () => void; retrying: boolean }
  /** The steps, with a step whose own read failed marked as could not be checked. */
  | { status: 'ready'; steps: SetupStep[]; fetching: boolean };

/** Where the two actions of the AI steps go: the Engines settings and the prompts page of the project. */
export function aiSetupHrefs(scope: AiSetupScope): { engines: Route; prompts: Route } {
  return {
    engines: projectPath(scope.workspaceSlug, scope.projectSlug, '/settings/engines'),
    prompts: projectPath(scope.workspaceSlug, scope.projectSlug, '/ai/prompts'),
  };
}

/** A read as the model takes it, or `null` while it has not answered. A failed read is failed even with older data. */
function readOf<T, V>(query: UseQueryResult<T>, value: (data: T) => V): Read<V> | null {
  if (query.isError) return { state: 'failed' };
  if (query.data === undefined) return null;
  return { state: 'ok', value: value(query.data) };
}

export function useAiSetupSteps(scope: AiSetupScope): AiSetupState {
  const t = useTranslations('setupChecklist');
  const path = { workspace_id: scope.workspaceId, project_id: scope.projectId };
  const engines = useQuery(apiQuery(ENGINES, { params: { path } }));
  const answers = useQuery(apiQuery(ANSWERS, { params: { path, query: { limit: 1 } } }));

  const enginesRead: Read<EngineFacts> | null = readOf(engines, (list) => enginesFacts(list.data));
  const answersRead: Read<boolean> | null = readOf(answers, (page) => page.data.length > 0);
  if (enginesRead === null || answersRead === null) return { status: 'loading' };
  if (enginesRead.state === 'failed' && answersRead.state === 'failed') {
    return {
      status: 'error',
      error: engines.error ?? answers.error,
      retrying: engines.isFetching || answers.isFetching,
      retry: () => {
        void engines.refetch();
        void answers.refetch();
      },
    };
  }
  return {
    status: 'ready',
    fetching: engines.isFetching || answers.isFetching,
    steps: aiSetupSteps({
      engines: enginesRead,
      answers: answersRead,
      hrefs: aiSetupHrefs(scope),
      t,
    }),
  };
}
