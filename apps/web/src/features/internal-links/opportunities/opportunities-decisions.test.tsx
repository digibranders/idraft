import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HISTORY_RUN_IDS } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';
import type { Opportunity, OpportunityPage, OpportunityStatus } from '@/lib/internal-links/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const BASE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/opportunities';
const LIST = mswPath(BASE);
const DECISIONS = mswPath(`${BASE}/decisions`);
const PROBLEM = { 'content-type': 'application/problem+json' };
const RUN_ID = HISTORY_RUN_IDS[0] ?? '';
const ROWS = 101;

beforeEach(() => stubWideScreen());
afterEach(() => {
  restoreWideScreen();
  server.events.removeAllListeners();
});

const row = (index: number, status: OpportunityStatus): Opportunity => ({
  key: `${String(index + 1)}>${String(1000 + index)}`,
  source: {
    url_id: String(index + 1),
    url: `https://e.test/s/${String(index)}`,
    path: `/s/${String(index)}`,
    tier: null,
  },
  target: {
    url_id: String(1000 + index),
    url: `https://e.test/t/${String(index)}`,
    path: `/t/${String(index)}`,
    tier: null,
  },
  phrase: 'phrase',
  context: 'A sentence with a phrase in it.',
  anchor: 'phrase',
  source_equity_share: null,
  status,
  origin: 'keyword',
});

/** A list of `ROWS` rows served by offset, whose decisions the held PUT handler records. */
function world(): { decided: Map<string, OpportunityStatus>; reads: () => number } {
  const decided = new Map<string, OpportunityStatus>();
  let reads = 0;
  const all = (): Opportunity[] =>
    Array.from({ length: ROWS }, (_, index) => row(index, 'open')).map((candidate) => ({
      ...candidate,
      status: decided.get(candidate.key) ?? candidate.status,
    }));
  server.use(
    http.get(LIST, ({ request }) => {
      const query = new URL(request.url).searchParams;
      if (query.get('export') !== null) return undefined;
      // The tab badge reads the same route with a window of one row: that read is not the list's
      if (query.get('limit') !== '1') reads += 1;
      const status = query.get('status');
      const everything = all();
      const shown = status === null ? everything : everything.filter((candidate) => candidate.status === status);
      const offset = Number(query.get('offset') ?? 0);
      const limit = Number(query.get('limit') ?? 50);
      const count = (wanted: OpportunityStatus): number =>
        everything.filter((candidate) => candidate.status === wanted).length;
      const page: OpportunityPage = {
        data: shown.slice(offset, offset + limit),
        meta: {
          run_id: RUN_ID,
          total: shown.length,
          counts: { open: count('open'), accepted: count('accepted'), dismissed: count('dismissed') },
        },
      };
      return HttpResponse.json(page);
    }),
  );
  return { decided, reads: () => reads };
}

/** A PUT that waits until the test lets it answer; `answer` settles it with success or a server error. */
function heldDecision(decided: Map<string, OpportunityStatus>): {
  answer: (outcome: 'ok' | 'fail') => void;
  calls: () => number;
} {
  let release: (outcome: 'ok' | 'fail') => void = () => undefined;
  let calls = 0;
  server.use(
    http.put(DECISIONS, async ({ request }) => {
      calls += 1;
      const body = (await request.json()) as {
        status: OpportunityStatus;
        items: { source_url_id: string; target_url_id: string }[];
      };
      const outcome = await new Promise<'ok' | 'fail'>((resolve) => {
        release = resolve;
      });
      if (outcome === 'fail') {
        return HttpResponse.json(
          { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error', detail: 'It broke.' },
          { status: 500, headers: PROBLEM },
        );
      }
      for (const item of body.items) decided.set(`${item.source_url_id}>${item.target_url_id}`, body.status);
      return HttpResponse.json({ data: { matched: body.items.length, changed: body.items.length } });
    }),
  );
  return { answer: (outcome) => release(outcome), calls: () => calls };
}

const open = (search: string): ProvidedRender =>
  renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?tab=opportunities${search}` });

const accept = (index: number): string => `Accept: /s/${String(index)} to /t/${String(index)}`;
const chips = (): HTMLElement => screen.getByRole('group', { name: 'Status' });
const names = (): string[] =>
  screen.getAllByRole('button', { name: /^Accept: / }).map((button) => button.getAttribute('aria-label') ?? '');

describe('a decision in flight', () => {
  it('shows the counts, the text and the rows as decided, and puts back exactly what was there when it fails', async () => {
    const { decided } = world();
    const held = heldDecision(decided);
    const { user } = open('&os=open');
    await screen.findByRole('button', { name: accept(0) });
    const before = names();
    expect(chips()).toHaveTextContent('Open 101');
    expect(screen.getAllByText('101 opportunities').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: accept(0) }));
    await waitFor(() => expect(screen.queryByRole('button', { name: accept(0) })).not.toBeInTheDocument());
    expect(chips()).toHaveTextContent('Open 100');
    expect(chips()).toHaveTextContent('Accepted 1');
    expect(screen.getAllByText('100 of 101 opportunities').length).toBeGreaterThan(0);
    held.answer('fail');
    expect(await screen.findByRole('button', { name: accept(0) })).toBeInTheDocument();
    expect(names()).toEqual(before);
    expect(chips()).toHaveTextContent('Open 101');
    expect(chips()).toHaveTextContent('Accepted 0');
    expect(screen.queryByText('100 of 101 opportunities')).not.toBeInTheDocument();
    expect(screen.getAllByText('101 opportunities').length).toBeGreaterThan(0);
  });

  it('keeps the decided state when a read of the list starts and ends while the request is in flight', async () => {
    const { decided, reads } = world();
    const held = heldDecision(decided);
    const { user, queryClient } = open('&os=open');
    await user.click(await screen.findByRole('button', { name: accept(0) }));
    await waitFor(() => expect(screen.queryByRole('button', { name: accept(0) })).not.toBeInTheDocument());
    const before = reads();
    await queryClient.refetchQueries({
      predicate: (query) => JSON.stringify(query.queryKey).includes('opportunities'),
    });
    expect(reads()).toBe(before);
    expect(screen.queryByRole('button', { name: accept(0) })).not.toBeInTheDocument();
    expect(chips()).toHaveTextContent('Accepted 1');
    held.answer('ok');
    await waitFor(() => expect(chips()).toHaveTextContent('Open 100'));
    expect(screen.queryByRole('button', { name: accept(0) })).not.toBeInTheDocument();
  });

  it('sends one request and leaves focus alone when a bulk action is pressed meanwhile', async () => {
    const { decided } = world();
    const held = heldDecision(decided);
    const { user } = open('');
    await user.click(await screen.findByRole('button', { name: accept(0) }));
    await user.click(await screen.findByRole('checkbox', { name: 'Select /s/1 to /t/1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select /s/2 to /t/2' }));
    const bulk = await screen.findByRole('button', { name: 'Accept' });
    expect(bulk).toHaveAttribute('aria-disabled', 'true');
    await user.click(bulk);
    expect(held.calls()).toBe(1);
    expect(screen.getByText('2 opportunities selected')).toBeInTheDocument();
    held.answer('ok');
    await waitFor(() => expect(chips()).toHaveTextContent('Accepted 1'));
    expect(held.calls()).toBe(1);
  });
});

describe('a decision on the last row of a later page', () => {
  const toSecondPage = async (user: ProvidedRender['user']): Promise<void> => {
    await screen.findByRole('button', { name: accept(0) });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByRole('button', { name: accept(100) });
  };

  it('steps back one page when it succeeds', async () => {
    const { decided } = world();
    const held = heldDecision(decided);
    const { user } = open('&os=open');
    await toSecondPage(user);
    await user.click(screen.getByRole('button', { name: accept(100) }));
    held.answer('ok');
    expect(await screen.findByRole('button', { name: accept(0) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: accept(100) })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Accept: / })).toHaveLength(100);
  });

  it('stays on the page, with the row back, when it fails', async () => {
    const { decided } = world();
    const held = heldDecision(decided);
    const { user } = open('&os=open');
    await toSecondPage(user);
    await user.click(screen.getByRole('button', { name: accept(100) }));
    await waitFor(() => expect(screen.queryByRole('button', { name: accept(100) })).not.toBeInTheDocument());
    held.answer('fail');
    expect(await screen.findByRole('button', { name: accept(100) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: accept(0) })).not.toBeInTheDocument();
    expect(within(screen.getByRole('grid', { name: 'Link opportunities' })).getAllByRole('row').length).toBeGreaterThan(
      1,
    );
  });
});
