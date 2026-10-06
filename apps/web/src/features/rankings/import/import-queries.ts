'use client';

import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';

import { importPhase, type KeywordImport, type Outcome } from './import-model';
import type { ProjectScope } from '../rankings-queries';
import { api, unwrap } from '@/lib/api/client';
import { projectKey, type QueryKey } from '@/lib/api/keys';
import { apiMutation } from '@/lib/api/query';
import type { ImportRow, RowActionInput } from '@/lib/api/types';

/**
 * What the import dialog and Rankings' header ask the API (19-api-specification.md section 3.6.3). The
 * upload itself is not here: it is a multipart POST that `uploadForm` sends for the progress it reports.
 */

export const IMPORTS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports';
export const IMPORT = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports/{import_id}';
export const IMPORT_ROWS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports/{import_id}/rows';

export const CREATE_IMPORT = apiMutation('post', IMPORTS);
export const CHANGE_IMPORT = apiMutation('patch', IMPORT);
export const CONFIRM_PATH =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports/{import_id}/confirm';
export const CANCEL_PATH = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/keyword-imports/{import_id}/cancel';
export const CONFIRM_IMPORT = apiMutation('post', CONFIRM_PATH);
export const CANCEL_IMPORT = apiMutation('post', CANCEL_PATH);

const projectPath = (scope: ProjectScope): string =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}`;

/** Where the browser posts a file; not a typed client route, since `uploadForm` sends it. */
export const uploadPath = (scope: ProjectScope): `/api/v1/${string}` =>
  `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/keyword-imports/upload`;

/** Where the report of an import downloads from. */
export const reportPath = (scope: ProjectScope, importId: string): string =>
  `${projectPath(scope)}/keyword-imports/${importId}/report`;

const importsKey = (scope: ProjectScope): QueryKey => [
  ...projectKey(scope.workspaceId, scope.projectId),
  'keyword-imports',
];

export const importKey = (scope: ProjectScope, importId: string): QueryKey => [...importsKey(scope), importId];

/** How often an unsettled import is asked about: the API's `Retry-After` is 5 seconds for imports. */
export const IMPORT_POLL_MS = 5_000;
/** Reading and writing are asked about sooner in the dialog, where someone is waiting. */
export const DIALOG_POLL_MS = 1_000;

const unsettled = (status: KeywordImport['status']): boolean =>
  status === 'uploaded' || status === 'parsing' || status === 'writing';

/** The keys of an import's rows: `rowsKey` is the prefix of every outcome's list. */
export const rowsKey = (scope: ProjectScope, importId: string): QueryKey => [...importKey(scope, importId), 'rows'];

/** Reads one import. */
export async function fetchImport(scope: ProjectScope, importId: string, signal?: AbortSignal): Promise<KeywordImport> {
  const answer = await unwrap(
    api.GET(IMPORT, {
      params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId, import_id: importId } },
      ...(signal === undefined ? {} : { signal }),
    }),
  );
  return answer.data;
}

/** The query options of one import, for a read outside `useImport` (`queryClient.fetchQuery`). */
export const importQueryOptions = (
  scope: ProjectScope,
  importId: string,
): { queryKey: QueryKey; queryFn: (context: { signal: AbortSignal }) => Promise<KeywordImport> } => ({
  queryKey: importKey(scope, importId),
  queryFn: ({ signal }) => fetchImport(scope, importId, signal),
});

/**
 * One import, asked about every `pollMs` while it is reading or writing. `background` keeps asking while
 * the tab is hidden: the dialog, which waits for the read to finish, needs it, and a hidden tab that stopped
 * polling would let the wait run out on an import that was ready. The header's follow-up stops with the tab.
 */
export function useImport(
  scope: ProjectScope,
  importId: string | null,
  pollMs: number,
  background = false,
): UseQueryResult<KeywordImport> {
  return useQuery({
    queryKey: importKey(scope, importId ?? 'none'),
    enabled: importId !== null,
    queryFn: ({ signal }) => fetchImport(scope, importId ?? '', signal),
    refetchInterval: (query) => (query.state.data !== undefined && unsettled(query.state.data.status) ? pollMs : false),
    refetchIntervalInBackground: background,
  });
}

/** How long a Continue waits for the API to read a file: past it the read is given up on. */
export const READ_TIMEOUT_MS = 3 * 60_000;

/** The API did not finish reading the import in the time given. */
export class ReadTimeoutError extends Error {
  constructor() {
    super('The API did not finish reading the import in time');
    this.name = 'ReadTimeoutError';
  }
}

/**
 * Resolves with the import once it is out of `uploaded` and `parsing`: the answer a Continue was waiting
 * for. It reads the cache and does not ask the API itself, so the polling of `useImport` is the only
 * traffic. It rejects when the reads fail for good, with a `ReadTimeoutError` when the import is still being
 * read after `timeoutMs`, and with an `AbortError` when the signal fires (the dialog was closed). Before it
 * gives up it asks the API once more (`recheck`): the clock counts the time a tab was hidden, which the
 * polling may not have, and an import that was ready must not be cancelled for a file that went up.
 */
export function settledImport(
  queryClient: QueryClient,
  key: QueryKey,
  signal: AbortSignal,
  timeoutMs: number = READ_TIMEOUT_MS,
  recheck?: () => Promise<KeywordImport>,
): Promise<KeywordImport> {
  return new Promise((resolve, reject) => {
    const abortError = (): DOMException => new DOMException('The wait was stopped', 'AbortError');
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const cache = queryClient.getQueryCache();
    const stop = (): void => {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
    };
    const timer = setTimeout(() => {
      if (recheck === undefined) {
        stop();
        reject(new ReadTimeoutError());
        return;
      }
      // Still listening (the cache's own news and the abort) while the last read is under way
      recheck().then(
        (read) => {
          if (signal.aborted) return;
          stop();
          if (importPhase(read.status) === 'reading') reject(new ReadTimeoutError());
          else resolve(read);
        },
        () => {
          if (signal.aborted) return;
          stop();
          reject(new ReadTimeoutError());
        },
      );
    }, timeoutMs);
    const check = (): void => {
      const state = queryClient.getQueryState<KeywordImport, Error>(key);
      if (state?.data !== undefined && importPhase(state.data.status) !== 'reading') {
        stop();
        resolve(state.data);
      } else if (state?.status === 'error' && state.fetchStatus === 'idle') {
        stop();
        reject(state.error);
      }
    };
    const unsubscribe = cache.subscribe(check);
    const onAbort = (): void => {
      stop();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    check();
  });
}

/** The key of the read of the import being written. */
export const writingImportKey = (scope: ProjectScope): QueryKey => [...importsKey(scope), 'writing'];

/**
 * An import ended: the read of "the import being written" no longer holds it, and must not bring it back
 * (the read is kept for 30 seconds, long enough for the next import to end before it is read again).
 */
export function forgetWritingImport(queryClient: QueryClient, scope: ProjectScope, importId: string): void {
  queryClient.setQueryData<KeywordImport | null>(writingImportKey(scope), (held) =>
    held !== undefined && held !== null && held.import_id === importId ? null : held,
  );
}

/** The import the project is writing now, if any: Rankings asks once on mount to resume its header progress. */
export function useWritingImport(scope: ProjectScope, enabled = true): UseQueryResult<KeywordImport | null> {
  return useQuery({
    queryKey: writingImportKey(scope),
    enabled,
    queryFn: async ({ signal }) => {
      const page = await unwrap(
        api.GET(IMPORTS, {
          params: {
            path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
            query: { 'filter[status]': 'writing', limit: 1 },
          },
          signal,
        }),
      );
      return page.data[0] ?? null;
    },
  });
}

/** One page of an outcome's rows, and where the next page starts (`null` on the last). */
async function readRowsPage(
  scope: ProjectScope,
  importId: string,
  outcome: Outcome,
  limit: number,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<{ rows: ImportRow[]; next: string | null }> {
  const page = await unwrap(
    api.GET(IMPORT_ROWS, {
      params: {
        path: { workspace_id: scope.workspaceId, project_id: scope.projectId, import_id: importId },
        query: { 'filter[outcome_in]': [outcome], limit, ...(cursor === null ? {} : { cursor }) },
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  );
  return { rows: page.data, next: page.page.has_more ? page.page.next_cursor : null };
}

/** The first `limit` rows of an outcome, for the Review lists. */
export async function readRows(
  scope: ProjectScope,
  importId: string,
  outcome: Outcome,
  limit: number,
  signal?: AbortSignal,
): Promise<ImportRow[]> {
  return (await readRowsPage(scope, importId, outcome, limit, null, signal)).rows;
}

/** The most rows the API answers a page. */
const ROWS_PAGE = 200;

/** The reason code of a row that repeats an earlier row of the file: it takes `skip` and nothing else. */
const REPEATED_ROW = 'repeated_row';

/**
 * A row action for every conflict row of the import, read page by page: `merge` is what unarchiving the
 * archived keywords sends just before Confirm, and `skip` takes it back when the person changed their mind
 * after a Confirm that did not go through. A row that repeats an earlier row of the file takes `skip` only
 * (the API refuses `merge` for it), so it is left out of the unarchiving.
 */
export async function conflictRowActions(
  scope: ProjectScope,
  importId: string,
  action: 'merge' | 'skip' = 'merge',
): Promise<RowActionInput[]> {
  const actions: RowActionInput[] = [];
  let cursor: string | null = null;
  do {
    const { rows, next } = await readRowsPage(scope, importId, 'conflict', ROWS_PAGE, cursor);
    for (const row of rows) {
      if (action === 'merge' && row.reason_code === REPEATED_ROW) continue;
      actions.push({ row_no: row.row_no, part: row.part, action });
    }
    cursor = next;
  } while (cursor !== null);
  return actions;
}
