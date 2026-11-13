import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIST_ROW_HEIGHT } from '@/components/app/data-table/data-table-list';
import { mockUser } from '@/mocks/fixtures';
import { problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import {
  domainOf,
  domainPage,
  DOMAINS,
  EMPTY_META,
  G2,
  gate,
  HUBSPOT,
  inspecting,
  NOW,
  OWN,
  renderTab as renderHarness,
  serveDomains,
  stubPhone,
  stubTablet,
  stubTouchPhone,
  watch,
  type HarnessProps,
} from '@/test/citations-lists-harness';
import { server } from '@/test/msw';
import { restoreWideScreen } from '@/test/rankings-harness';
import type { ProvidedRenderOptions } from '@/test/render';

// The canvas of the real sparkline draws nothing in jsdom: a sparkline anywhere shows as an image of its label
vi.mock('@/components/app/sparkline/sparkline-cell', () => ({
  SparklineCell: ({ label }: { label: string }): ReactElement => <span role="img" aria-label={label} />,
}));

const address = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/citations',
  useSearchParams: () => new URLSearchParams(address.search),
}));

function renderTab(
  props: Omit<HarnessProps, 'tab'> = {},
  searchParams = '',
  options: ProvidedRenderOptions = {},
): ReturnType<typeof renderHarness> {
  address.search = searchParams;
  return renderHarness({ tab: 'domains', ...props }, searchParams, options);
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubPhone();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  serveDomains([G2, HUBSPOT]);
});
afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
  restoreWideScreen();
  address.search = '';
});

const list = (): Promise<HTMLElement> => screen.findByRole('list', { name: /^Cited domains, \d+ results?$/ });
/** The buttons of the list once its rows have loaded. */
async function rows(): Promise<HTMLElement[]> {
  const found = await list();
  return within(found).getAllByRole('button');
}
const rowNamed = async (name: RegExp): Promise<HTMLElement> => {
  const found = (await rows()).find((row) => name.test(row.textContent ?? ''));
  if (found === undefined) throw new Error(`No row for ${String(name)}`);
  return found;
};

describe('the Domains tab on a phone', () => {
  it('below 768 px the Domains tab is a list of two line rows, 56 px (LIST_ROW_HEIGHT)', async () => {
    renderTab();
    const buttons = await rows();
    expect(screen.queryByRole('treegrid')).toBeNull();
    expect(buttons).toHaveLength(2);
    // jsdom has no layout: the box is h-14 (3.5rem), which is LIST_ROW_HEIGHT, and each row has two lines
    expect(LIST_ROW_HEIGHT).toBe(56);
    for (const button of buttons) {
      expect(button.closest('li')).toHaveClass('h-14');
      expect(button.children).toHaveLength(2);
    }
  });

  it('line 1 is the domain and its share, line 2 the role with its units and the change', async () => {
    serveDomains([G2, HUBSPOT, OWN]);
    renderTab();
    const g2 = await rowNamed(/^g2\.com/);
    expect(g2).toHaveTextContent('g2.com');
    expect(g2).toHaveTextContent('Source share');
    expect(g2).toHaveTextContent('10.4%');
    expect(g2).toHaveTextContent('Third party, 1,912 of 18,420 units');
    // A neutral change in points, from the period before
    expect(g2).toHaveTextContent('+2.1 pts');
    // The own row says Own in words, and a share of 4 units is 4 of 18,420, not a bare 0.0%
    expect(await rowNamed(/^fynix\.com/)).toHaveTextContent('Own, 4 of 18,420 units');
    expect(await rowNamed(/^hubspot\.com/)).toHaveTextContent('Competitor, 800 of 18,420 units');
  });

  it('says n/a for a share that cannot be told, never 0%', async () => {
    serveDomains([domainOf({ source_share: { value: null, numerator: 0, denominator: 0, n_observations: 0 } })]);
    renderTab();
    const row = await rowNamed(/^g2\.com/);
    expect(row).toHaveTextContent('Share n/a');
    expect(row).toHaveTextContent('n/a');
    expect(row).not.toHaveTextContent('0%');
  });

  it('colours nothing: no test of a source share change exists, so every change is neutral', async () => {
    renderTab();
    const found = await list();
    // HubSpot fell and g2.com rose: both changes are there, and neither has a tone
    expect(found).toHaveTextContent('+2.1 pts');
    expect(found).toHaveTextContent(/2\.4 pts/);
    expect(found.innerHTML).not.toMatch(/(?:text|bg|border)-(?:positive|negative|warning|success|danger|info)/);
  });

  it('leaves the change out when the row has nothing to compare with, and shows no 0', async () => {
    serveDomains([domainOf({ previous: null })]);
    renderTab();
    const row = await rowNamed(/^g2\.com/);
    expect(row).not.toHaveTextContent('pts');
    expect(row.querySelector('[data-slot="list-delta"]')).toBeNull();
  });

  it('tapping a row opens the domain inspector, which is a sheet below 768 px', async () => {
    const { inspect, open } = inspecting();
    const { user } = renderTab({ inspect });
    await user.click(await rowNamed(/^hubspot\.com/));
    // The inspector is the page's: its placement makes it a full-screen sheet on a phone
    expect(open).toHaveBeenCalledWith({ type: 'domain', id: 'hubspot.com' }, 'inspector');
    expect(open).toHaveBeenCalledOnce();
  });

  it('marks the open domain as the current row', async () => {
    const { inspect } = inspecting({ type: 'domain', id: 'hubspot.com' });
    renderTab({ inspect });
    expect(await rowNamed(/^hubspot\.com/)).toHaveAttribute('aria-current', 'true');
    expect(await rowNamed(/^g2\.com/)).not.toHaveAttribute('aria-current');
  });

  it('keeps the order the inspector steps through: the domains in the order listed, once each', async () => {
    serveDomains([G2, domainOf({ domain_role: 'competitor', role_entity_id: 'ent-rival' }), HUBSPOT]);
    const { inspect, setOrder } = inspecting();
    const { user } = renderTab({ inspect });
    await rows();
    await waitFor(() => expect(setOrder).toHaveBeenLastCalledWith('domain', ['g2.com', 'hubspot.com']));
    await user.type(screen.getByRole('searchbox', { name: 'Search in table' }), 'hub');
    await waitFor(() => expect(setOrder).toHaveBeenLastCalledWith('domain', ['hubspot.com']));
  });

  it('has no checkbox, no sparkline and no row actions', async () => {
    const { inspect } = inspecting();
    renderTab({ inspect });
    const found = await list();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(found).queryAllByRole('img')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    // Each row is one button and nothing else: no link inside it that would open the inspector twice
    expect(within(found).getAllByRole('button')).toHaveLength(2);
    expect(within(found).queryAllByRole('link')).toHaveLength(0);
  });

  it('lists domains flat: a domain never expands into its pages on a phone', async () => {
    const { user } = renderTab();
    await user.click(await rowNamed(/^g2\.com/));
    expect(screen.queryByRole('button', { name: /^Expand pages of/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /View all/ })).toBeNull();
  });

  describe('the List and Table switch', () => {
    it('appears on a narrow screen that is not touch-primary, and Table shows the table', async () => {
      const { user } = renderTab();
      await list();
      expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();
      await user.click(screen.getByRole('radio', { name: 'Table' }));
      expect(await screen.findByRole('treegrid', { name: 'Cited domains' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: /^Cited domains/ })).toBeNull();
      // The way back is in the table's own toolbar
      expect(screen.getByRole('radio', { name: 'Table' })).toBeChecked();
      await user.click(screen.getByRole('radio', { name: 'List' }));
      expect(await list()).toBeInTheDocument();
      expect(screen.queryByRole('treegrid')).toBeNull();
    });

    it('is not offered on a touch screen', async () => {
      restoreWideScreen();
      stubTouchPhone();
      renderTab();
      await list();
      expect(screen.queryByRole('radio', { name: 'Table' })).toBeNull();
    });
  });

  it('the server sort select and the minimum still work, and the strip is not asked again', async () => {
    serveDomains([G2, HUBSPOT, OWN]);
    const seen = watch('/sources/domains');
    const updates: string[] = [];
    const { user } = renderTab({}, '', { onUrlUpdate: ({ queryString }) => updates.push(queryString) });
    expect(await rows()).toHaveLength(3);
    await user.click(screen.getByRole('combobox', { name: 'Order by' }));
    await user.click(await screen.findByRole('option', { name: 'Answers' }));
    await waitFor(() => expect(seen.at(-1)?.searchParams.get('sort')).toBe('-observations'));
    expect(updates.at(-1)).toContain('sort=-observations');
    await user.click(screen.getByRole('combobox', { name: 'Fewest citation units' }));
    await user.click(await screen.findByRole('option', { name: 'At least 10 units' }));
    await waitFor(() => expect(seen.at(-1)?.searchParams.get('min_support')).toBe('10'));
    await waitFor(async () => expect(await rows()).toHaveLength(2));
    expect(updates.at(-1)).toContain('min=10');
    // The reads are the table's: 200 domains, the same blocks
    expect(seen.every((url) => url.searchParams.get('limit') === '200')).toBe(true);
    expect(seen.at(-1)?.searchParams.get('include')).toBe('series,cited_with,by_role_by_engine');
  });

  it('search narrows the listed rows and says so when none matches', async () => {
    const { user } = renderTab();
    await rows();
    const search = screen.getByRole('searchbox', { name: 'Search in table' });
    expect(search).toHaveAttribute('placeholder', 'Search listed domains');
    await user.type(search, 'hub');
    await waitFor(async () => expect(await rows()).toHaveLength(1));
    expect(await rowNamed(/^hubspot\.com/)).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'nothing');
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
  });

  it('reads no pages: no domain is open on a phone', async () => {
    const seen = watch('/sources/pages');
    renderTab();
    await rows();
    expect(seen).toHaveLength(0);
  });

  describe('states', () => {
    it('shows skeleton rows while loading and keeps the rows while it reads again', async () => {
      const first = gate();
      const second = gate();
      let calls = 0;
      server.use(
        http.get(DOMAINS, async ({ request }) => {
          calls += 1;
          await (calls === 1 ? first.opened : second.opened);
          const min = Number(new URL(request.url).searchParams.get('min_support') ?? '1');
          return HttpResponse.json(domainPage([G2, HUBSPOT].filter((row) => row.citation_units >= min)));
        }),
      );
      const { user } = renderTab();
      expect(await screen.findByRole('status', { name: 'Loading domains' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: /^Cited domains/ })).toBeNull();
      act(() => first.open());
      const found = await list();
      expect(found).not.toHaveAttribute('aria-busy');
      await user.click(screen.getByRole('combobox', { name: 'Fewest citation units' }));
      await user.click(await screen.findByRole('option', { name: 'At least 3 units' }));
      await waitFor(() => expect(found).toHaveAttribute('aria-busy', 'true'));
      expect(within(found).getAllByRole('button')).toHaveLength(2);
      act(() => second.open());
      await waitFor(() => expect(found).not.toHaveAttribute('aria-busy'));
    });

    it('is empty when no answer was read, with the tab empty state', async () => {
      serveDomains([], { meta: EMPTY_META });
      renderTab();
      expect(await screen.findByRole('heading', { name: 'No citations yet' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: /^Cited domains/ })).toBeNull();
    });

    it('filtered to nothing names the filters and offers Clear filters', async () => {
      serveDomains([]);
      const onClear = vi.fn();
      const { user } = renderTab({ values: { role: { kind: 'enum', values: ['own'] } }, onClear });
      expect(
        await screen.findByRole('heading', { name: 'No domain or page matches these filters' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Role: Own')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(onClear).toHaveBeenCalledOnce();
    });

    it('a failed read shows the inline error with Try again and keeps the toolbar', async () => {
      let calls = 0;
      server.use(
        http.get(DOMAINS, ({ request }) => {
          calls += 1;
          if (calls === 1) return problem(request, 'not_found');
          return HttpResponse.json(domainPage([G2, HUBSPOT]));
        }),
      );
      const { user } = renderTab();
      expect(await screen.findByText('Citations could not be loaded')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Order by' })).toBeInTheDocument();
      expect(screen.getByRole('searchbox', { name: 'Search in table' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await rows()).toHaveLength(2);
      expect(screen.queryByText('Citations could not be loaded')).toBeNull();
    });
  });

  it('from 768 px the table is back', async () => {
    restoreWideScreen();
    stubTablet();
    renderTab();
    const table = await screen.findByRole('treegrid', { name: 'Cited domains' });
    await waitFor(() => expect(within(table).queryAllByRole('rowheader').length).toBeGreaterThan(0));
    expect(screen.queryByRole('list', { name: /^Cited domains/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Table' })).toBeNull();
  });

  it('is axe clean in the light and the dark theme', async () => {
    const { container } = renderTab();
    await rows();
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.removeAttribute('data-theme');
  });
});
