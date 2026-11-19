import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';

import { ID_BATCH, selectionsOf, usePageBulk, type BulkTarget } from './use-page-bulk';
import { DEFAULT_PAGE_QUERY } from '@/lib/internal-links/queries';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const TIERS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/pages/tiers');
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };
const BODY = z.object({ url_ids: z.array(z.string()) });
const ids = (count: number): string[] => Array.from({ length: count }, (_, index) => String(index + 1));

afterEach(() => server.events.removeAllListeners());

describe('selectionsOf', () => {
  it('sends a filter as one request and the ids in batches of the most the API takes', () => {
    expect(selectionsOf({ ids: ids(3), allMatching: true }, { ...DEFAULT_PAGE_QUERY, q: '/blog' })).toEqual([
      { filter: { q: '/blog' } },
    ]);
    const batches = selectionsOf({ ids: ids(2 * ID_BATCH + 1), allMatching: false }, DEFAULT_PAGE_QUERY);
    expect(batches.map((batch) => ('url_ids' in batch ? batch.url_ids.length : -1))).toEqual([ID_BATCH, ID_BATCH, 1]);
    expect(selectionsOf({ ids: [], allMatching: false }, DEFAULT_PAGE_QUERY)).toEqual([]);
  });

  it('refuses an id the API would refuse, before any request', () => {
    expect(() => selectionsOf({ ids: ['0'], allMatching: false }, DEFAULT_PAGE_QUERY)).toThrow('Not a url id');
  });
});

/** The hook behind two buttons and its alert, with the target given by the test. */
function Probe({ target, done }: { target: BulkTarget; done: Mock<() => void> }): ReactElement {
  const bulk = usePageBulk(SCOPE, DEFAULT_PAGE_QUERY, done);
  return (
    <div>
      <button type="button" onClick={() => void bulk.setTier(target, null, 'dialog')}>
        run
      </button>
      <p data-testid="alert">{bulk.error}</p>
    </div>
  );
}

describe('usePageBulk', () => {
  it('says some pages changed when a later batch fails, keeps the selection, and a retry goes through', async () => {
    let calls = 0;
    server.use(
      http.put(TIERS, async ({ request }) => {
        calls += 1;
        if (calls === 2) {
          return HttpResponse.json({ type: 'about:blank', title: 'Server error', status: 500 }, { status: 500 });
        }
        const size = BODY.parse(await request.clone().json()).url_ids.length;
        return HttpResponse.json({ data: { matched: size, changed: size } });
      }),
    );
    const done = vi.fn<() => void>();
    const { user } = renderWithProviders(
      <Probe target={{ ids: ids(2 * ID_BATCH + 1), allMatching: false }} done={done} />,
    );
    await user.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(screen.getByTestId('alert')).toHaveTextContent(/Some pages changed and some did not/));
    // Batch 1 landed, batch 2 failed, batch 3 was never sent; the selection stays for the retry
    expect(calls).toBe(2);
    expect(done).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'run' }));
    expect((await screen.findAllByText('10,001 pages are now Untiered.')).length).toBeGreaterThan(0);
    expect(calls).toBe(5);
    expect(done).toHaveBeenCalledOnce();
    expect(screen.getByTestId('alert')).toBeEmptyDOMElement();
  });

  it('sends nothing and says nothing for an empty choice', async () => {
    let calls = 0;
    server.use(
      http.put(TIERS, () => {
        calls += 1;
        return undefined;
      }),
    );
    const done = vi.fn<() => void>();
    const { user } = renderWithProviders(<Probe target={{ ids: [], allMatching: false }} done={done} />);
    await user.click(screen.getByRole('button', { name: 'run' }));
    expect(calls).toBe(0);
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByTestId('alert')).toBeEmptyDOMElement();
    expect(screen.queryByText(/Tier set/)).toBeNull();
  });
});
