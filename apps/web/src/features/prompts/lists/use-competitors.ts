'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ProjectEntry } from './competitor-model';
import { aiKey, type PromptScope } from '../prompt-queries';
import { isApiProblem } from '@/lib/api/problem';
import { wordAlias } from '@/lib/entities/aliases';
import { nextCompetitorColor } from '@/lib/entities/colors';
import {
  attachEntityMutation,
  createEntityMutation,
  detachEntityMutation,
  findBrandId,
  projectEntitiesQuery,
} from '@/lib/entities/project-entities';

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
  const create = useMutation(createEntityMutation);
  const attach = useMutation(attachEntityMutation);
  const detach = useMutation(detachEntityMutation);
  const entries = entities.data?.data ?? [];

  const add = async (name: string): Promise<AddedCompetitor> => {
    let entityId: string | null;
    try {
      const brand = name.trim();
      const created = await create.mutateAsync({
        params: { path: { workspace_id: project.workspaceId } },
        // The name is an alias too, as the backend request says (a word match in any case: the API's defaults)
        body: {
          entity_type: 'brand',
          is_ambiguous: false,
          canonical_name: brand,
          aliases: [wordAlias(brand)],
          domains: [],
        },
      });
      entityId = created.data.entity_id;
    } catch (error) {
      // The workspace has a brand of this name already, perhaps one another project follows: it is the one to give the role
      if (!isApiProblem(error, 'duplicate')) throw error;
      entityId = await findBrandId(queryClient, project.workspaceId, name);
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
