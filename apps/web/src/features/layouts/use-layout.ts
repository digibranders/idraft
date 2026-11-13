'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  deletePersonalLayout,
  deleteTeamLayout,
  fetchLayout,
  layoutQueryKey,
  putPersonalLayout,
  putTeamLayout,
  type LayoutRead,
} from './layout-api';
import { api } from '@/lib/api/client';
import { isApiProblem } from '@/lib/api/problem';
import type { LayoutDocument, ScreenKey } from '@/lib/layouts';

/** A document to save and the `ETag` of the layout it was made from (null for a first save). */
export interface SaveVariables {
  document: LayoutDocument;
  etag: string | null;
}

export interface UseLayoutResult {
  query: UseQueryResult<LayoutRead, Error>;
  savePersonal: UseMutationResult<LayoutRead, Error, SaveVariables>;
  removePersonal: UseMutationResult<void, Error, void>;
  saveTeam: UseMutationResult<LayoutRead, Error, SaveVariables>;
  removeTeam: UseMutationResult<void, Error, void>;
}

/**
 * The layout of a screen and the four writes of contract C12a. A save puts the API's answer (with its new
 * `ETag`) into the cache; a removal, and any `412`, read the layout again, and the write settles only once that
 * read is in, so a caller that retries sends the fresh `ETag`. `refetch: false` (customize mode) turns off the
 * refetch on window focus and on reconnect, so a draft never gets the `ETag` of a layout that moved under it.
 */
export function useLayout(workspaceId: string, screen: ScreenKey, options?: { refetch: boolean }): UseLayoutResult {
  const queryClient = useQueryClient();
  const key = layoutQueryKey(workspaceId, screen);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchLayout(api, workspaceId, screen, signal),
    refetchOnWindowFocus: options?.refetch ?? true,
    refetchOnReconnect: options?.refetch ?? true,
  });
  const keep = (read: LayoutRead): void => {
    queryClient.setQueryData(key, read);
  };
  const readAgain = (): Promise<void> => queryClient.invalidateQueries({ queryKey: key });
  const readAgainOnConflict = (error: Error): Promise<void> | undefined =>
    isApiProblem(error, 'precondition_failed') ? readAgain() : undefined;

  const savePersonal = useMutation<LayoutRead, Error, SaveVariables>({
    mutationFn: ({ document, etag }) => putPersonalLayout(api, workspaceId, screen, document, etag),
    onSuccess: keep,
    onError: readAgainOnConflict,
  });
  const saveTeam = useMutation<LayoutRead, Error, SaveVariables>({
    mutationFn: ({ document, etag }) => putTeamLayout(api, workspaceId, screen, document, etag),
    onSuccess: keep,
    onError: readAgainOnConflict,
  });
  const removePersonal = useMutation({
    mutationFn: () => deletePersonalLayout(api, workspaceId, screen),
    onSuccess: readAgain,
  });
  const removeTeam = useMutation({
    mutationFn: () => deleteTeamLayout(api, workspaceId, screen),
    onSuccess: readAgain,
  });
  return { query, savePersonal, removePersonal, saveTeam, removeTeam };
}
