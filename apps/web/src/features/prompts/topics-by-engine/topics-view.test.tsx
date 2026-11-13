import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTopicOrder } from '@/features/prompts/topic-drawer/topic-order-store';
import { PromptsScreen } from '@/features/prompts/prompts-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_TERM_IDS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender, type ProvidedRenderOptions } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const SUMMARY_PATH = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary');

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const FYNIX_ID = fynix.project_id;

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: FYNIX_ID,
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const renderOn = (searchParams: string, options: ProvidedRenderOptions = {}): ProvidedRender =>
  renderWithProviders(promptsAs('viewer'), { ...options, searchParams });
const treegrid = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Topics' });
const headers = (table: HTMLElement): string[] =>
  within(table)
    .getAllByRole('columnheader')
    .map((header) => header.textContent ?? '');
const query = (write: string | undefined): URLSearchParams => new URLSearchParams(write);

/** The requests of the summary that ask for topic rows only, which is how the entities read is told from the page's own. */
function watchEntityReads(): { count: () => number } {
  let reads = 0;
  server.use(
    http.get(SUMMARY_PATH, ({ request }) => {
      if (new URL(request.url).searchParams.get('rows') === 'topics') reads += 1;
      return undefined;
    }),
  );
  return { count: () => reads };
}

describe('the Topics tab: the views', () => {
  it('opens on the List exactly as before', async () => {
    const reads = watchEntityReads();
    renderOn('');
    const table = await treegrid();
    await within(table).findByRole('button', { name: 'Open the topic Paid Search' });
    expect(headers(table).some((header) => header.startsWith('Engine gap'))).toBe(false);
    // The count columns of the List are in the chooser's reach, and the By engine columns are not there
    expect(headers(table)).toContain('ChatGPT mentioned');
    expect(
      headers(table).some((header) => header.startsWith('ChatGPT mention') && !header.startsWith('ChatGPT mentioned')),
    ).toBe(false);
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();
    expect(reads.count()).toBe(0);
  });

  it('an unknown view is the List', async () => {
    renderOn('?view=bogus');
    const table = await treegrid();
    await waitFor(() => expect(headers(table)).toContain('ChatGPT mentioned'));
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();
  });

  it('shows the By engine columns for ?view=engines and the metric of ?metric=', async () => {
    renderOn('?view=engines');
    const table = await treegrid();
    await waitFor(() => expect(headers(table)).toContain('ChatGPT mention'));
    expect(headers(table)).toContain('Gemini mention');
    expect(headers(table).some((header) => header.startsWith('Engine gap'))).toBe(true);
    // The count columns wait in the chooser
    expect(headers(table)).not.toContain('ChatGPT mentioned');
    expect(screen.getByRole('radio', { name: 'By engine' })).toBeChecked();
  });

  it('reads ?metric= for the engine columns', async () => {
    renderOn('?view=engines&metric=citation');
    const table = await treegrid();
    await waitFor(() => expect(headers(table)).toContain('ChatGPT citation'));
    expect(headers(table)).not.toContain('ChatGPT mention');
  });

  it('the metric select writes ?metric and changes the columns', async () => {
    const writes: string[] = [];
    const { user } = renderOn('?view=engines', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    const table = await treegrid();
    await user.click(await screen.findByRole('combobox', { name: 'Metric of the engine columns' }));
    await user.click(await screen.findByRole('option', { name: 'Share of voice' }));
    await waitFor(() => expect(headers(table)).toContain('ChatGPT SOV'));
    expect(query(writes.at(-1)).get('metric')).toBe('sov');
    expect(query(writes.at(-1)).get('view')).toBe('engines');
  });

  it('the view switch writes ?view and keeps the other keys', async () => {
    const writes: string[] = [];
    const { user } = renderOn('?density=compact&q=paid', {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await treegrid();
    await user.click(screen.getByRole('radio', { name: 'By engine' }));
    await waitFor(() => expect(query(writes.at(-1)).get('view')).toBe('engines'));
    expect(query(writes.at(-1)).get('density')).toBe('compact');
    expect(query(writes.at(-1)).get('q')).toBe('paid');
    await user.click(screen.getByRole('radio', { name: 'List' }));
    await waitFor(() => expect(query(writes.at(-1)).get('view')).toBeNull());
    expect(query(writes.at(-1)).get('density')).toBe('compact');
  });

  it('sorts by the ChatGPT rate from ?sort=chatgpt_web_rate', async () => {
    renderOn('?view=engines&sort=chatgpt_web_rate');
    const table = await treegrid();
    expect(await within(table).findByRole('columnheader', { name: /^ChatGPT mention/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('sorts by the engine gap from ?sort=-engine_gap', async () => {
    renderOn('?view=engines&sort=-engine_gap');
    const table = await treegrid();
    expect(await within(table).findByRole('columnheader', { name: /^Engine gap/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('an engine cell opens the drawer on the Prompts tab with ?eng=', async () => {
    const writes: string[] = [];
    const { user } = renderOn('?view=engines', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    const table = await treegrid();
    await user.click(await within(table).findByRole('button', { name: 'Open the prompts of Paid Search on ChatGPT' }));
    const last = query(writes.at(-1));
    expect(last.get('inspect')).toBe(`topic:${MOCK_TERM_IDS.paidSearch}`);
    expect(last.get('itab')).toBe('prompts');
    expect(last.get('eng')).toBe('chatgpt_web');
    expect(last.get('view')).toBe('engines');
    const panel = await screen.findByRole('complementary', { name: 'Paid Search' });
    expect(within(panel).getByRole('tab', { name: 'Prompts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a topic opened onto its prompts shows each prompt with its value on every engine (child rows)', async () => {
    const { user } = renderOn('?view=engines');
    const table = await treegrid();
    await user.click(await within(table).findByRole('button', { name: 'Expand Paid Search, 2 prompts' }));
    const promptRows = within(table)
      .getAllByRole('row')
      .filter((row) => row.getAttribute('aria-level') === '2');
    expect(promptRows.length).toBeGreaterThan(0);
    const [first] = promptRows;
    if (first === undefined) throw new Error('No prompt row');
    // Each prompt row has a cell on both engines, as text and not as a button
    expect(
      within(first)
        .getAllByRole('gridcell')
        .some((cell) => /%|answer|n\/a|No answers/.test(cell.textContent ?? '')),
    ).toBe(true);
    expect(within(first).queryByRole('button', { name: /^Open the prompts of/ })).toBeNull();
  });

  it('reads the entities once for the view and not in the List', async () => {
    const reads = watchEntityReads();
    const { user } = renderOn('');
    await treegrid();
    expect(reads.count()).toBe(0);
    await user.click(screen.getByRole('radio', { name: 'By engine' }));
    await waitFor(() => expect(reads.count()).toBe(1));
    // Coming back to the List asks nothing more
    await user.click(screen.getByRole('radio', { name: 'List' }));
    expect(reads.count()).toBe(1);
  });

  it('keeps the rows and shows the refetch state while the entities are read', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(SUMMARY_PATH, async ({ request }) => {
        if (new URL(request.url).searchParams.get('rows') === 'topics') await gate;
        return undefined;
      }),
    );
    renderOn('?view=engines');
    const table = await treegrid();
    await within(table).findByRole('button', { name: 'Open the topic Paid Search' });
    expect(table).toHaveAttribute('aria-busy', 'true');
    release();
    await waitFor(() => expect(table).not.toHaveAttribute('aria-busy', 'true'));
    expect(within(table).getByRole('button', { name: 'Open the topic Paid Search' })).toBeInTheDocument();
  });

  it('says competitors could not be loaded and keeps the other columns', async () => {
    server.use(
      http.get(SUMMARY_PATH, ({ request }) =>
        new URL(request.url).searchParams.get('rows') === 'topics'
          ? HttpResponse.json({ status: 500, code: 'internal_error', title: 'Failed' }, { status: 500 })
          : undefined,
      ),
    );
    renderOn('?view=engines');
    const table = await treegrid();
    expect(
      await screen.findByText('Competitors could not be loaded. The other columns are shown.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(headers(table)).toContain('ChatGPT mention');
  });

  it('fills the topic order store in drawn order and empties it on unmount', async () => {
    const { unmount } = renderOn('');
    const table = await treegrid();
    await within(table).findByRole('button', { name: 'Open the topic Paid Search' });
    await waitFor(() => expect(getTopicOrder(FYNIX_ID)).not.toBeNull());
    const order = getTopicOrder(FYNIX_ID) ?? [];
    expect(order).toEqual(expect.arrayContaining(Object.values(MOCK_TERM_IDS).slice(0, 6)));
    expect(new Set(order).size).toBe(order.length);
    // A topic comes straight after its parent and before the next top level topic
    const place = (id: string): number => order.indexOf(id);
    expect(place(MOCK_TERM_IDS.technicalSeo)).toBeGreaterThan(place(MOCK_TERM_IDS.seo));
    expect(place(MOCK_TERM_IDS.localSeo)).toBeGreaterThan(place(MOCK_TERM_IDS.seo));
    expect(place(MOCK_TERM_IDS.blogStrategy)).toBe(place(MOCK_TERM_IDS.contentMarketing) + 1);
    // The top level rows are drawn in the order of the store
    const tops = within(table)
      .getAllByRole('button', { name: /^Open the topic / })
      .map((button) => button.getAttribute('aria-label')?.replace('Open the topic ', ''));
    const ids: Record<string, string> = {
      SEO: MOCK_TERM_IDS.seo,
      'Content Marketing': MOCK_TERM_IDS.contentMarketing,
      'Paid Search': MOCK_TERM_IDS.paidSearch,
    };
    const drawn = tops.flatMap((name) => (name !== undefined && ids[name] !== undefined ? [place(ids[name])] : []));
    expect(drawn).toEqual([...drawn].sort((a, b) => a - b));
    unmount();
    expect(getTopicOrder(FYNIX_ID)).toBeNull();
  });
});
