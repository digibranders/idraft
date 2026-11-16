'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { nextCompetitorColor, sameBrand, type ProjectEntry } from './competitor-model';
import { aiKey, projectEntitiesQuery, type PromptScope } from '../prompt-queries';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation, apiQuery } from '@/lib/api/query';

const WORKSPACE_ENTITIES = '/api/v1/workspaces/{workspace_id}/entities';
const PROJECT_ENTITIES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities';
const CREATE = apiMutation('post', WORKSPACE_ENTITIES);
const ATTACH = apiMutation('post', PROJECT_ENTITIES);
const DETACH = apiMutation('delete', `${PROJECT_ENTITIES}/{entity_id}`);

/** A brand that is now a competitor of the project, with what is needed to take it off again. */
export interface AddedCompetitor {
  entityId: string;
  /** 2 to 6, or `null`: past the fifth competitor the brand is drawn in the neutral color. */
  colorIndex: number | null;
}

export interface Competitors {
  /** The entries of the project, for the colors; empty until read. */
  entries: readonly ProjectEntry[];
  /** Creates the brand (or finds the one of that name) and gives it the competitor role in AI. Rejects when either call fails. */
  add: (name: string) => Promise<AddedCompetitor>;
  /** Takes the competitor role off, keeping the workspace's entity. */
  remove: (entityId: string) => Promise<void>;
  /** Reads the summary and the project's entities again: the brand moves from the others to the tracked ones. */
  refresh: () => void;
}

/**
 * The calls behind "Add as competitor" (`docs/ai-visibility/backend-requests-prompts-page.md`): the same two the Brands
 * settings use, `POST /entities` and `POST /projects/{id}/entities`, and `DELETE /projects/{id}/entities/{id}` for Undo.
 * A brand the workspace already has under that name is used as it is. The competitor is followed in AI answers only,
 * so it does not count against the SEO competitor limit. The project's entities, which give the colors, are read only
 * while `enabled` (the list is open).
 */
export function useCompetitors(project: PromptScope, enabled: boolean): Competitors {
  const queryClient = useQueryClient();
  const entities = useQuery({ ...projectEntitiesQuery(project), enabled });
  const create = useMutation(CREATE);
  const attach = useMutation(ATTACH);
  const detach = useMutation(DETACH);
  const entries = entities.data?.data ?? [];

  const findBrand = async (name: string): Promise<string | null> => {
    const found = await queryClient.fetchQuery({
      ...apiQuery(WORKSPACE_ENTITIES, {
        params: { path: { workspace_id: project.workspaceId }, query: { 'filter[q]': name } },
      }),
      // An entity created a moment ago, perhaps in another tab, has to be found
      staleTime: 0,
    });
    return (
      found.data.find((entity) => entity.entity_type === 'brand' && sameBrand(entity.canonical_name, name))
        ?.entity_id ?? null
    );
  };

  const add = async (name: string): Promise<AddedCompetitor> => {
    let entityId: string | null;
    try {
      const created = await create.mutateAsync({
        params: { path: { workspace_id: project.workspaceId } },
        body: { entity_type: 'brand', is_ambiguous: false, canonical_name: name.trim(), aliases: [], domains: [] },
      });
      entityId = created.data.entity_id;
    } catch (error) {
      // The workspace has a brand of this name already, perhaps one another project follows: it is the one to give the role
      if (!isApiProblem(error, 'duplicate')) throw error;
      entityId = await findBrand(name);
      if (entityId === null) throw error;
    }
    const colorIndex = nextCompetitorColor(entries);
    await attach.mutateAsync({
      params: { path: { workspace_id: project.workspaceId, project_id: project.projectId } },
      body: {
        entity_id: entityId,
        role: 'competitor',
        is_primary: false,
        track_seo: false,
        track_ai: true,
        color_index: colorIndex,
      },
    });
    return { entityId, colorIndex };
  };

  const remove = async (entityId: string): Promise<void> => {
    await detach.mutateAsync({
      params: { path: { workspace_id: project.workspaceId, project_id: project.projectId, entity_id: entityId } },
    });
  };

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: aiKey(project) });
    void queryClient.invalidateQueries({ queryKey: projectEntitiesQuery(project).queryKey });
  };

  return { entries, add, remove, refresh };
}
