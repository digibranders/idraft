import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { IMPORT_ROWS, conflictRowActions, readRows } from './import-queries';
import { mswPath } from '@/mocks/respond';
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
});
