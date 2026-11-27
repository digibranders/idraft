'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';

import type { CannScope } from './cann-reads';
import { toast } from '@/components/ui/toast';
import { projectKey } from '@/lib/api/keys';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';

/** The write the Keywords page makes: a tracked keyword's tracking settings, of which the drawer sends only the target page. */
const TRACKED_KEYWORD = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}';

/** What the drawer names when it sets or clears a target page. */
export interface TargetWrite {
  /** The keyword the write is for: the one on screen when the person pressed, never the one the drawer steps to next. */
  trackedKeywordId: string;
  keyword: string;
  /** The page's full address and its path for the words; `null` clears the target. */
  page: { url: string; path: string } | null;
}

/**
 * Sets or clears a keyword's target page (`PATCH` of the tracked keyword, `keywords:write`). The person presses it, so
 * the answer is a toast; on success the Cannibalization reads and the Keywords caches are read again, so every
 * "Target page" mark on both pages follows. One write runs at a time.
 */
export function useTargetWrite(scope: CannScope): { write: (change: TargetWrite) => Promise<void>; pending: boolean } {
  const t = useTranslations('cannibalization.inspector.options');
  const queryClient = useQueryClient();
  const patch = useMutation(apiMutation('patch', TRACKED_KEYWORD));
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const { workspaceId, projectId } = scope;
  const { mutateAsync } = patch;

  const write = useCallback(
    async ({ trackedKeywordId, keyword, page }: TargetWrite): Promise<void> => {
      if (running.current) return;
      running.current = true;
      setPending(true);
      try {
        await mutateAsync({
          params: {
            path: { workspace_id: workspaceId, project_id: projectId, tracked_keyword_id: trackedKeywordId },
          },
          body: { target_url: page === null ? null : page.url },
        });
        toast(
          page === null
            ? { type: 'success', title: t('targetCleared'), description: t('targetClearedText', { keyword }) }
            : {
                type: 'success',
                title: t('targetSaved'),
                description: t('targetSavedText', { keyword, path: page.path }),
              },
        );
        const prefix = projectKey(workspaceId, projectId);
        await Promise.all(
          ['cannibalization', 'tracked-keywords'].map((segment) =>
            queryClient.invalidateQueries({ queryKey: [...prefix, segment] }),
          ),
        );
      } catch (error) {
        toast({
          type: 'error',
          title: t('targetFailed'),
          description:
            isApiProblem(error) && error.status === 403
              ? t('targetFailedAccess')
              : t('targetFailedReason', { keyword }),
        });
      } finally {
        running.current = false;
        setPending(false);
      }
    },
    [mutateAsync, queryClient, t, workspaceId, projectId],
  );
  return { write, pending };
}
