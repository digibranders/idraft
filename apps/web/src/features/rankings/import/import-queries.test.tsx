import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KeywordImport } from './import-model';
import {
  IMPORT,
  IMPORT_ROWS,
  ReadTimeoutError,
  conflictRowActions,
  forgetWritingImport,
  readRows,
  settledImport,
  useImport,
  writingImportKey,
} from './import-queries';
import { mswPath } from '@/mocks/respond';
import { importFixture } from '@/test/import-fixtures';
import { server } from '@/test/msw';

const SCOPE = { workspaceId: 'w1', projectId: 'p1' };

const row = (rowNo: number, part = 1): Record<string, unknown> => ({
  row_no: rowNo,
  part,
  raw: {},
  keyword: `keyword ${String(rowNo)}`,
  normalized_text: null,
  location_id: null,
  language_code: null,
  device: 'desktop',
  outcome: 'conflict',
  reason_code: 'conflict',
  reason: null,
  existing_tracked_keyword_id: null,
  action: 'skip',
});

/** Answers the rows of an import in pages of `size`, and records the query of every request. */
function answerRows(all: readonly Record<string, unknown>[], size: number): URLSearchParams[] {
  const asked: URLSearchParams[] = [];
  server.use(
    http.get(mswPath(IMPORT_ROWS), ({ request }) => {
      const url = new URL(request.url);
      asked.push(url.searchParams);
      const from = Number(url.searchParams.get('cursor') ?? '0');
      const next = from + size;
      return HttpResponse.json({
        data: all.slice(from, next),
        page: {
          limit: Number(url.searchParams.get('limit')),
          has_more: next < all.length,
          next_cursor: next < all.length ? String(next) : null,
        },
      });
    }),
  );
  return asked;
}

describe('import rows', () => {
  it('reads the first rows of one outcome with the limit asked for', async () => {
    const asked = answerRows([row(1), row(2), row(3)], 2);
    const rows = await readRows(SCOPE, 'i1', 'conflict', 2);
    expect(rows.map((item) => item.row_no)).toEqual([1, 2]);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.get('filter[outcome_in]')).toBe('conflict');
    expect(asked[0]?.get('limit')).toBe('2');
  });

  it('turns every conflict row, over all pages, into a merge action with its part', async () => {
    const all = Array.from({ length: 450 }, (_, index) => row(index + 1, index % 2 === 0 ? 1 : 2));
    const asked = answerRows(all, 200);
    const actions = await conflictRowActions(SCOPE, 'i1');
    expect(actions).toHaveLength(450);
    expect(actions[0]).toEqual({ row_no: 1, part: 1, action: 'merge' });
    expect(actions[1]).toEqual({ row_no: 2, part: 2, action: 'merge' });
    expect(actions.at(-1)).toEqual({ row_no: 450, part: 2, action: 'merge' });
    // Three pages, each asked for by the cursor the page before gave, and no more
    expect(asked.map((query) => query.get('cursor'))).toEqual([null, '200', '400']);
    expect(asked.every((query) => query.get('limit') === '200')).toBe(true);
  });

  it('answers nothing for an import without conflicts', async () => {
    answerRows([], 200);
    expect(await conflictRowActions(SCOPE, 'i1')).toEqual([]);
  });

  it('leaves a row that repeats an earlier row of the file out of the unarchiving, which it cannot take', async () => {
    answerRows([row(1), { ...row(2), reason_code: 'repeated_row' }, row(3)], 200);
    expect((await conflictRowActions(SCOPE, 'i1')).map((action) => action.row_no)).toEqual([1, 3]);
    // Taking the unarchiving back is a skip, which every row takes
    const skips = await conflictRowActions(SCOPE, 'i1', 'skip');
    expect(skips.map((action) => action.row_no)).toEqual([1, 2, 3]);
    expect(skips.every((action) => action.action === 'skip')).toBe(true);
  });
});

const KEY = ['import', 'i1'];
const importAs = (status: KeywordImport['status'], importId = 'i1'): KeywordImport =>
  importFixture({ import_id: importId, status });

describe('settledImport', () => {
  it('waits while the import is being read and answers it once it is not', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY, importAs('uploaded'));
    const waiting = settledImport(queryClient, KEY, new AbortController().signal, 5_000);
    queryClient.setQueryData(KEY, importAs('preview_ready'));
    await expect(waiting).resolves.toMatchObject({ status: 'preview_ready' });
  });

  it('gives up on an import that stays in uploaded, with an error of its own', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY, importAs('uploaded'));
    await expect(settledImport(queryClient, KEY, new AbortController().signal, 30)).rejects.toBeInstanceOf(
      ReadTimeoutError,
    );
  });

  it('asks the API once more before it gives up, so a tab that polled nothing while hidden is not wrong', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY, importAs('uploaded'));
    const recheck = vi.fn(() => Promise.resolve(importAs('preview_ready')));
    await expect(settledImport(queryClient, KEY, new AbortController().signal, 30, recheck)).resolves.toMatchObject({
      status: 'preview_ready',
    });
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it('gives up when the second read finds the import still being read, or cannot read it', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY, importAs('uploaded'));
    const still = settledImport(queryClient, KEY, new AbortController().signal, 30, () =>
      Promise.resolve(importAs('parsing')),
    );
    await expect(still).rejects.toBeInstanceOf(ReadTimeoutError);
    const unreachable = settledImport(queryClient, KEY, new AbortController().signal, 30, () =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    await expect(unreachable).rejects.toBeInstanceOf(ReadTimeoutError);
  });

  it('does not ask once the dialog closed during the wait', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY, importAs('uploaded'));
    const recheck = vi.fn(() => Promise.resolve(importAs('preview_ready')));
    const controller = new AbortController();
    const waiting = settledImport(queryClient, KEY, controller.signal, 30, recheck);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(recheck).not.toHaveBeenCalled();
  });

  it('stops waiting when the dialog closes, and does not time out afterwards', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY, importAs('uploaded'));
    const controller = new AbortController();
    const waiting = settledImport(queryClient, KEY, controller.signal, 30);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('useImport in a tab that is hidden', () => {
  const asHidden = (): void => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const answers = (): { reads: () => number } => {
    let reads = 0;
    server.use(
      http.get(mswPath(IMPORT), () => {
        reads += 1;
        return HttpResponse.json({ data: importAs(reads < 3 ? 'uploaded' : 'preview_ready') });
      }),
    );
    return { reads: () => reads };
  };
  const view = (background: boolean) => {
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(() => useImport(SCOPE, 'i1', 20, background), { wrapper });
  };
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps polling for the dialog, which is waiting for the import to be read', async () => {
    const asked = answers();
    asHidden();
    const { result } = view(true);
    await waitFor(() => expect(result.current.data?.status).toBe('preview_ready'));
    expect(asked.reads()).toBeGreaterThanOrEqual(3);
  });

  it('does not poll for a header that nobody sees', async () => {
    const asked = answers();
    asHidden();
    const { result } = view(false);
    await waitFor(() => expect(result.current.data?.status).toBe('uploaded'));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(asked.reads()).toBe(1);
  });
});

describe('forgetWritingImport', () => {
  it('empties the read of the import being written when it is the one that ended, and only then', () => {
    const queryClient = new QueryClient();
    const key = writingImportKey(SCOPE);
    // Nothing read yet: nothing is made up
    forgetWritingImport(queryClient, SCOPE, 'i1');
    expect(queryClient.getQueryData(key)).toBeUndefined();
    queryClient.setQueryData(key, importAs('writing'));
    forgetWritingImport(queryClient, SCOPE, 'i2');
    expect(queryClient.getQueryData(key)).toMatchObject({ import_id: 'i1' });
    forgetWritingImport(queryClient, SCOPE, 'i1');
    expect(queryClient.getQueryData(key)).toBeNull();
  });
});
