'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { CHOOSE_PROPERTY, refreshGoogle, type GoogleScope } from './google-queries';
import type { Product } from './google-model';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';

export interface ChooseProperty {
  /** The property being saved, or `null`: its button spins and the others wait. */
  choosing: string | null;
  /**
   * Links `property` to the project. Resolves `true` once it is saved and the page has read the new state;
   * `false` after saying why not. A property that went stale (not readable any more, or taken) also reads
   * the list again through `onStale`.
   */
  pick: (property: string, label: string) => Promise<boolean>;
}

/**
 * Choosing a property of either product (`POST .../integrations`), with the words for each way it can fail.
 * The product is the `kind` of the link; a project keeps one live property per product.
 */
export function useChooseProperty(
  { workspaceId, projectId }: GoogleScope,
  connectionId: string,
  kind: Product,
  onStale: () => void,
): ChooseProperty {
  const t = useTranslations('integrations.chooser');
  const queryClient = useQueryClient();
  const choose = useMutation(CHOOSE_PROPERTY);
  const [choosing, setChoosing] = useState<string | null>(null);

  const pick = async (property: string, label: string): Promise<boolean> => {
    setChoosing(property);
    try {
      await choose.mutateAsync({
        params: { path: { workspace_id: workspaceId, project_id: projectId } },
        body: { connection_id: connectionId, kind, external_property: property },
      });
    } catch (error) {
      const stale = isApiProblem(error, 'property_not_accessible') || isApiProblem(error, 'duplicate');
      toast({
        type: 'error',
        title: isApiProblem(error, 'property_not_accessible')
          ? t('notAccessible')
          : isApiProblem(error, 'duplicate')
            ? t('taken')
            : isApiProblem(error, 'integration_scope_missing')
              ? t('scopeMissing')
              : isApiProblem(error, 'service_unavailable')
                ? t('googleUnavailable')
                : t('failed'),
      });
      if (stale) onStale();
      // The connection's access changed since the page was read: read it again
      if (isApiProblem(error, 'integration_scope_missing')) void refreshGoogle(queryClient, { workspaceId, projectId });
      setChoosing(null);
      return false;
    }
    toast({ type: 'success', title: t('chosen'), description: t('chosenDetail', { property: label }) });
    await refreshGoogle(queryClient, { workspaceId, projectId });
    setChoosing(null);
    return true;
  };

  return { choosing, pick };
}
