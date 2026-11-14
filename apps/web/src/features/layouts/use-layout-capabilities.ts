'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { apiQuery } from '@/lib/api/query';
import type { Capabilities, EngineCode } from '@/lib/layouts';
import { useMembership } from '@/lib/permissions';

/** What a project and a person can use, for the availability of cards (spec section 8, CF-30). */
export interface LayoutCapabilities {
  capabilities: Capabilities;
  enabledEngines: readonly EngineCode[];
  /** Whether the engines have been read: until then, and when the read failed, only SEO is offered. */
  status: 'loading' | 'ready' | 'error';
}

const ENGINES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines';

const NO_ENGINES: readonly EngineCode[] = [];
const SEO_ONLY: Capabilities['channels'] = ['seo'];
const SEO_AND_AI: Capabilities['channels'] = ['seo', 'ai'];
const NO_INTEGRATIONS: Capabilities['integrations'] = [];

/**
 * SEO is always on (a project has no SEO switch). AI is on once the project has an engine that is enabled, so
 * a card that needs AI is never shown as available while the engines load or when they could not be read.
 * No card type needs an integration yet.
 */
export function useLayoutCapabilities(scope: { workspaceId: string; projectId: string }): LayoutCapabilities {
  const { permissions } = useMembership();
  const { data, isError } = useQuery(
    apiQuery(ENGINES, { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } } }),
  );
  return useMemo(() => {
    const enabledEngines =
      data === undefined
        ? NO_ENGINES
        : data.data.filter((engine) => engine.is_enabled).map((engine) => engine.engine.engine_code);
    return {
      capabilities: {
        channels: enabledEngines.length > 0 ? SEO_AND_AI : SEO_ONLY,
        permissions,
        integrations: NO_INTEGRATIONS,
      },
      enabledEngines,
      status: data !== undefined ? 'ready' : isError ? 'error' : 'loading',
    };
  }, [data, isError, permissions]);
}
