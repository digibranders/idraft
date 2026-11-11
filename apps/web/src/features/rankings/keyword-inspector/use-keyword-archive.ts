'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { DETAIL, refreshAfterWrite, type KeywordDetail } from './inspector-queries';
import type { ProjectScope } from '../rankings-queries';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { quotaFacts } from '@/lib/keywords/quota';

/**
 * Archives or restores a tracked keyword and says what happened (the inspector's More menu and the keyword
 * page's use the same function). Archiving offers Undo once; a refusal says why. The keyword and the lists
 * read again after a write.
 */
export function useKeywordArchive(
  scope: ProjectScope,
): (active: boolean, keyword: KeywordDetail, undo: boolean) => Promise<void> {
  const t = useTranslations('rankings.inspector');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const patch = useMutation(apiMutation('patch', DETAIL));

  const setActive = async (active: boolean, keyword: KeywordDetail, undo: boolean): Promise<void> => {
    try {
      await patch.mutateAsync({
        params: {
          path: {
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            tracked_keyword_id: keyword.tracked_keyword_id,
          },
        },
        body: { is_active: active },
      });
      void refreshAfterWrite(queryClient, { ...scope, trackedKeywordId: keyword.tracked_keyword_id });
      if (active) {
        toast({ type: 'success', title: t('archive.unarchived') });
        return;
      }
      toast({
        type: 'success',
        title: t('archive.archived'),
        description: t('archive.archivedDescription', { keyword: keyword.keyword.text }),
        ...(undo ? { action: { label: t('archive.undo'), onAction: () => void setActive(true, keyword, false) } } : {}),
      });
    } catch (error) {
      toast({
        type: 'error',
        title: active ? t('archive.unarchiveFailed') : t('archive.failed'),
        ...(isApiProblem(error, 'quota_exceeded')
          ? { description: common('quota', { ...quotaFacts(error, 1) }) }
          : { description: t('tryAgain') }),
      });
    }
  };
  return setActive;
}
