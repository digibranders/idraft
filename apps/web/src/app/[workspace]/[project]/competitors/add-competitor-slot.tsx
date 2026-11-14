'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { EntityDialog } from '@/features/entities/entity-dialog';
import { projectEntitiesQuery } from '@/features/entities/entity-queries';
import { useAddCompetitorControl } from '@/features/competitors';

export interface AddCompetitorSlotProps {
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  projectSlug: string;
}

const NO_ENTITIES: readonly never[] = [];

/**
 * Add competitor as the Competitors page shows it: the entities feature's own dialog, opened for a competitor while
 * the page's control is open. The route is where the two features meet: the page takes the dialog as a slot and
 * never imports it. The project's entities are what the dialog counts competitors and picks the next colour from.
 */
export function AddCompetitorSlot({
  workspaceId,
  workspaceSlug,
  projectId,
  projectSlug,
}: AddCompetitorSlotProps): ReactElement {
  const control = useAddCompetitorControl();
  const scope = { workspaceId, projectId };
  const entities = useQuery({ ...projectEntitiesQuery(scope), enabled: control.open });
  return (
    <EntityDialog
      scope={scope}
      role={control.open ? 'competitor' : null}
      entities={entities.data?.data ?? NO_ENTITIES}
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
      onClose={control.close}
    />
  );
}
