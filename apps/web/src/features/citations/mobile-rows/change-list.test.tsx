import { act, screen, waitFor, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { getResponse, http } from 'msw';
import { useMemo, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIST_ROW_HEIGHT } from '@/components/app/data-table/data-table-list';
import { NewLostTab } from '../new-lost/new-lost-tab';
import { usePreviousMeta, useScopeMeta } from '../citation-reads';
import { toFilters, useCitationScope } from '../citation-scope';
import type { CitationTabContext } from '../citation-tabs';
import { citationFilterFields } from '../citations-filters';
import messages from '../../../../messages/en.json';
import type { FilterValues } from '@/components/app/filters/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { handlers } from '@/mocks/handlers';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import {
  ENABLED,
  gate,
  inspecting,
  labelOf,
  NOW,
  stubPhone,
  stubTablet,
  stubTouchPhone,
  watch,
} from '@/test/citations-lists-harness';
import { server } from '@/test/msw';
import { restoreWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRenderOptions } from '@/test/render';

vi.mock('@/components/app/sparkline/sparkline-cell', () => ({
  SparklineCell: ({ label }: { label: string }): ReactElement => <span role="img" aria-label={label} />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/citations',
  useSearchParams: () => new URLSearchParams(),
}));

const CHANGES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/changes');
// The mock world of the Fynix project: its reads are the real mock handlers'
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SOURCE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
// The two domains the mock world makes new and lost (WP-22 T1)
const NEWCOMER = 'agency-radar.example';
const FADED = 'legacy-seo-wiki.example';

const FIELDS = citationFilterFields({
  t: createTranslator({ locale: 'en', messages, namespace: 'citations.filters' }),
  flagWords: createTranslator({ locale: 'en', messages, namespace: 'citations.flagFilters' }),
  tab: 'new-lost',
  engines: ENABLED.map((code) => ({ code, label: labelOf(code) })),
  enginesLoading: false,
  roleUnits: null,
  topics: [],
  topicsLoading: false,
});

interface HarnessProps {
  values?: FilterValues;
  inspect?: CitationTabContext['inspect'];
}

/** The tab as the page gives it its context: the real scope from the address and the real scope reads. */
function Harness({ values = {}, inspect }: HarnessProps): ReactElement {
  const { scope, range, setSearch } = useCitationScope('UTC', ENABLED);
  const filters = useMemo(() => toFilters(scope, range), [scope, range]);
  const scopeMeta = useScopeMeta(SOURCE, filters);
  const previousMeta = usePreviousMeta(SOURCE, filters, scopeMeta.data?.meta, scope.compare);
  const context: CitationTabContext = {
    source: SOURCE,
    workspaceSlug: 'digibranders',
    projectSlug: 'fynix',
    timeZone: 'UTC',
    scope: { ...scope, tab: 'new-lost' },
    filters,
    range,
    enabledEngines: ENABLED,
    labelOf,
    meta: scopeMeta,
    previousMeta,
    setSearch,
    inspect,
    filterBar: { fields: FIELDS, values, onClear: () => undefined },
  };
  return (
    <div className="flex h-96 flex-col">
      <NewLostTab context={context} />
    </div>
  );
}

function renderTab(
  searchParams = '',
  options: ProvidedRenderOptions = {},
  props: HarnessProps = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<Harness {...props} />, { searchParams, ...options });
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubPhone();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
  restoreWideScreen();
});

const newList = (): Promise<HTMLElement> => screen.findByRole('list', { name: /^New sources, \d+ results?$/ });
const lostList = (): Promise<HTMLElement> => screen.findByRole('list', { name: /^Lost sources, \d+ results?$/ });
const rowsOf = async (found: Promise<HTMLElement> = newList()): Promise<HTMLElement[]> =>
  within(await found).getAllByRole('button');

describe('the New and lost tab on a phone', () => {
  it('below 768 px each kind is a list of two line rows, 56 px (LIST_ROW_HEIGHT)', async () => {
    const { user } = renderTab();
    const [row] = await rowsOf();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(LIST_ROW_HEIGHT).toBe(56);
    expect(row?.closest('li')).toHaveClass('h-14');
    expect(row?.children).toHaveLength(2);
    // Lost is a list of its own, picked by the same segment as the table's
    await user.click(screen.getByRole('radio', { name: /^Lost/ }));
    const [lost] = await rowsOf(lostList());
    expect(lost?.closest('li')).toHaveClass('h-14');
    expect(screen.queryByRole('list', { name: /^New sources/ })).toBeNull();
  });

  it('a new row says the domain, its units and the date it was first cited', async () => {
    renderTab();
    const [row] = await rowsOf();
    expect(row).toHaveTextContent(NEWCOMER);
    expect(row).toHaveTextContent('Citation units');
    const value = row?.querySelector('.num')?.textContent ?? '';
    expect(value).toMatch(/^[\d,]+$/);
    expect(Number(value.replace(/,/g, ''))).toBeGreaterThanOrEqual(2);
    expect(row).toHaveTextContent(/Third party, first cited [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);
  });

  it('a lost row says the units it had before it went quiet', async () => {
    renderTab('kind=lost');
    const [row] = await rowsOf(lostList());
    expect(row).toHaveTextContent(FADED);
    expect(row).toHaveTextContent('Units before it went quiet');
    expect(row).toHaveTextContent('Third party, quiet for 2 windows');
    expect(row?.textContent).not.toMatch(/first cited/);
  });

  it('shows no share, no percent and no change: counts only', async () => {
    renderTab();
    const found = await newList();
    expect(found.textContent).not.toContain('%');
    expect(found.textContent).not.toContain('pts');
    expect(found.querySelector('[data-slot="list-delta"]')).toBeNull();
  });

  it('tapping a row opens the domain inspector, which is a sheet below 768 px', async () => {
    const { inspect, open } = inspecting();
    const { user } = renderTab('', {}, { inspect });
    const [row] = await rowsOf();
    if (row === undefined) throw new Error('The list has no row');
    await user.click(row);
    expect(open).toHaveBeenCalledWith({ type: 'domain', id: NEWCOMER }, 'inspector');
    await user.click(screen.getByRole('radio', { name: /^Lost/ }));
    const [lost] = await rowsOf(lostList());
    if (lost === undefined) throw new Error('The lost list has no row');
    await user.click(lost);
    expect(open).toHaveBeenLastCalledWith({ type: 'domain', id: FADED }, 'inspector');
  });

  it('marks the open domain as the current row', async () => {
    const { inspect } = inspecting({ type: 'domain', id: NEWCOMER });
    renderTab('', {}, { inspect });
    const [row] = await rowsOf();
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('keeps the order the inspector steps through: the domains of the list on screen', async () => {
    const { inspect, setOrder } = inspecting();
    const { user } = renderTab('', {}, { inspect });
    await rowsOf();
    await waitFor(() => expect(setOrder).toHaveBeenLastCalledWith('domain', [NEWCOMER]));
    await user.click(screen.getByRole('radio', { name: /^Lost/ }));
    await rowsOf(lostList());
    await waitFor(() => expect(setOrder).toHaveBeenLastCalledWith('domain', [FADED]));
  });

  it('has no checkbox, no sparkline, no row actions and no link inside a row', async () => {
    renderTab();
    const found = await newList();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(found).queryAllByRole('img')).toHaveLength(0);
    expect(within(found).queryAllByRole('link')).toHaveLength(0);
    expect(within(found).getAllByRole('button')).toHaveLength(1);
  });

  it('asks for the two reads the table asks for, and no more', async () => {
    const seen = watch('/sources/changes');
    renderTab();
    await rowsOf();
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2));
    expect(seen.map((url) => url.searchParams.get('kind')).sort()).toEqual(['lost', 'new']);
  });

  describe('the List and Table switch', () => {
    it('appears on a narrow screen that is not touch-primary, and Table shows the table', async () => {
      const { user } = renderTab();
      await newList();
      await user.click(screen.getByRole('radio', { name: 'Table' }));
      expect(await screen.findByRole('grid', { name: 'New sources' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: /^New sources/ })).toBeNull();
      await user.click(screen.getByRole('radio', { name: 'List' }));
      expect(await newList()).toBeInTheDocument();
    });

    it('is not offered on a touch screen', async () => {
      restoreWideScreen();
      stubTouchPhone();
      renderTab();
      await newList();
      expect(screen.queryByRole('radio', { name: 'Table' })).toBeNull();
    });
  });

  it('the minimum still works: both reads ask again with it, and the address keeps it', async () => {
    const seen = watch('/sources/changes');
    const updates: string[] = [];
    const { user } = renderTab('', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    await newList();
    await user.click(screen.getByRole('combobox', { name: 'Fewest citation units' }));
    await user.click(await screen.findByRole('option', { name: 'At least 10 units' }));
    await waitFor(() => expect(seen.at(-1)?.searchParams.get('min_support')).toBe('10'));
    expect(updates.at(-1)).toContain('min=10');
  });

  it('search narrows the listed rows and says so when none matches', async () => {
    const { user } = renderTab();
    await newList();
    const search = screen.getByRole('searchbox', { name: 'Search in table' });
    expect(search).toHaveAttribute('placeholder', 'Search listed domains');
    await user.type(search, 'radar');
    expect(await rowsOf()).toHaveLength(1);
    await user.clear(search);
    await user.type(search, 'nothing-like-it');
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
  });

  describe('states', () => {
    it('shows skeleton rows while loading, and no spinner', async () => {
      const held = gate();
      server.use(
        http.get(CHANGES, async ({ request }) => {
          await held.opened;
          return getResponse([...handlers], request);
        }),
      );
      renderTab();
      expect(await screen.findByRole('status', { name: 'Loading sources' })).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).toBeNull();
      act(() => held.open());
      await newList();
    });

    it('empty New names the minimum', async () => {
      renderTab('min=1000');
      expect(await screen.findByRole('heading', { name: 'No new source' })).toBeInTheDocument();
    });

    it('empty Lost names the days it needs behind the window', async () => {
      renderTab('kind=lost&min=1000');
      expect(await screen.findByRole('heading', { name: 'No lost source' })).toBeInTheDocument();
    });

    it('a failed read shows the inline error with Try again and keeps the toolbar', async () => {
      let failing = true;
      server.use(
        http.get(CHANGES, ({ request }) => {
          if (failing && new URL(request.url).searchParams.get('kind') === 'new') return problem(request, 'not_found');
          return getResponse([...handlers], request);
        }),
      );
      const { user } = renderTab();
      expect(await screen.findByText('The new sources could not be loaded.')).toBeInTheDocument();
      expect(screen.getByRole('searchbox', { name: 'Search in table' })).toBeInTheDocument();
      failing = false;
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await rowsOf()).toHaveLength(1);
    });
  });

  it('from 768 px the table is back', async () => {
    restoreWideScreen();
    stubTablet();
    renderTab();
    const table = await screen.findByRole('grid', { name: 'New sources' });
    await waitFor(() => expect(within(table).queryAllByRole('rowheader').length).toBeGreaterThan(0));
    expect(screen.queryByRole('list', { name: /^New sources/ })).toBeNull();
  });

  it.each(['new', 'lost'])('is axe clean for %s, in the light and the dark theme', async (kind) => {
    const { container } = renderTab(`kind=${kind}`);
    await rowsOf(kind === 'new' ? newList() : lostList());
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.removeAttribute('data-theme');
  });
});
