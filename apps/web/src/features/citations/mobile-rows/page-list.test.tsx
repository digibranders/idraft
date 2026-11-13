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
  EMPTY_META,
  gate,
  inspecting,
  NOW,
  PAGES,
  pageOf,
  pagePage,
  renderTab as renderHarness,
  serveDomains,
  servePages,
  share,
  stubPhone,
  stubTablet,
  stubTouchPhone,
  watch,
  type HarnessProps,
} from '@/test/citations-lists-harness';
import { server } from '@/test/msw';
import { restoreWideScreen } from '@/test/rankings-harness';
import type { ProvidedRenderOptions } from '@/test/render';

vi.mock('@/components/app/sparkline/sparkline-cell', () => ({
  SparklineCell: ({ label }: { label: string }): ReactElement => <span role="img" aria-label={label} />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/citations',
  useSearchParams: () => new URLSearchParams(),
}));

const ONE = pageOf(1, { citation_units: 300, source_share: share(300) });
const TWO = pageOf(2, { citation_units: 120, source_share: share(120), title: '<img src=x onerror=alert(1)>' });
const THREE = pageOf(3, { title: null, domain_role: 'own', role_entity_id: 'ent-own' });

function renderTab(
  props: Omit<HarnessProps, 'tab'> = {},
  searchParams = '',
  options: ProvidedRenderOptions = {},
): ReturnType<typeof renderHarness> {
  return renderHarness({ tab: 'pages', ...props }, searchParams, options);
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubPhone();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  servePages([ONE, TWO]);
  serveDomains([]);
});
afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
  restoreWideScreen();
});

const list = (): Promise<HTMLElement> => screen.findByRole('list', { name: /^Cited pages, \d+ results?$/ });
async function rows(): Promise<HTMLElement[]> {
  return within(await list()).getAllByRole('button');
}
const rowNamed = async (name: RegExp): Promise<HTMLElement> => {
  const found = (await rows()).find((row) => name.test(row.textContent ?? ''));
  if (found === undefined) throw new Error(`No row for ${String(name)}`);
  return found;
};

describe('the Pages tab on a phone', () => {
  it('below 768 px the Pages tab is a list of two line rows, 56 px (LIST_ROW_HEIGHT)', async () => {
    renderTab();
    const buttons = await rows();
    expect(screen.queryByRole('grid', { name: 'Cited pages' })).toBeNull();
    expect(buttons).toHaveLength(2);
    expect(LIST_ROW_HEIGHT).toBe(56);
    for (const button of buttons) {
      expect(button.closest('li')).toHaveClass('h-14');
      expect(button.children).toHaveLength(2);
    }
  });

  it('line 1 is the page title and its share, line 2 the role with its units and the change', async () => {
    renderTab();
    const row = await rowNamed(/^Page 1/);
    expect(row).toHaveTextContent('Source share');
    expect(row).toHaveTextContent('1.6%');
    expect(row).toHaveTextContent('Third party, 300 of 18,420 units');
    expect(row).toHaveTextContent('+0.5 pts');
  });

  it("a page's identity is its title as text, or its address when it has none", async () => {
    servePages([ONE, TWO, THREE]);
    const { container } = renderTab();
    const buttons = await rows();
    expect(buttons.map((button) => button.querySelector('span span')?.textContent)).toEqual([
      'Page 1',
      '<img src=x onerror=alert(1)>',
      'https://g2.com/products/p3',
    ]);
    // Provider text never becomes markup
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(buttons[2]).toHaveTextContent('Own, 300 of 18,420 units');
  });

  it('says n/a for a share that cannot be told, never 0%', async () => {
    servePages([pageOf(1, { source_share: { value: null, numerator: 0, denominator: 0, n_observations: 0 } })]);
    renderTab();
    const row = await rowNamed(/^Page 1/);
    expect(row).toHaveTextContent('Share n/a');
    expect(row).not.toHaveTextContent('0%');
  });

  it('tapping a row opens the source inspector, which is a sheet below 768 px', async () => {
    const { inspect, open } = inspecting();
    const { user } = renderTab({ inspect });
    await user.click(await rowNamed(/^Page 2|^<img/));
    expect(open).toHaveBeenCalledWith({ type: 'source', id: '2' }, 'inspector');
    expect(open).toHaveBeenCalledOnce();
  });

  it('marks the open source as the current row', async () => {
    const { inspect } = inspecting({ type: 'source', id: '2' });
    renderTab({ inspect });
    expect(await rowNamed(/^Page 1/)).not.toHaveAttribute('aria-current');
    const rowsNow = await rows();
    expect(rowsNow[1]).toHaveAttribute('aria-current', 'true');
  });

  it('keeps the order the inspector steps through: the pages in the order listed, once each', async () => {
    servePages([ONE, pageOf(1, { domain_role: 'competitor', role_entity_id: 'ent-rival' }), TWO]);
    const { inspect, setOrder } = inspecting();
    const { user } = renderTab({ inspect });
    await rows();
    await waitFor(() => expect(setOrder).toHaveBeenLastCalledWith('source', ['1', '2']));
    await user.type(screen.getByRole('searchbox', { name: 'Search in table' }), 'onerror');
    await waitFor(() => expect(setOrder).toHaveBeenLastCalledWith('source', ['2']));
  });

  it('has no checkbox, no sparkline, no row actions and no link inside a row', async () => {
    const { inspect } = inspecting();
    renderTab({ inspect });
    const found = await list();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(found).queryAllByRole('img')).toHaveLength(0);
    expect(within(found).queryAllByRole('link')).toHaveLength(0);
    expect(within(found).getAllByRole('button')).toHaveLength(2);
  });

  describe('the List and Table switch', () => {
    it('appears on a narrow screen that is not touch-primary, and Table shows the table', async () => {
      const { user } = renderTab();
      await list();
      await user.click(screen.getByRole('radio', { name: 'Table' }));
      expect(await screen.findByRole('grid', { name: 'Cited pages' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: /^Cited pages/ })).toBeNull();
      await user.click(screen.getByRole('radio', { name: 'List' }));
      expect(await list()).toBeInTheDocument();
    });

    it('is not offered on a touch screen', async () => {
      restoreWideScreen();
      stubTouchPhone();
      renderTab();
      await list();
      expect(screen.queryByRole('radio', { name: 'Table' })).toBeNull();
    });
  });

  it('the server sort select and the minimum still work', async () => {
    servePages([ONE, TWO, pageOf(3, { citation_units: 3, source_share: share(3) })]);
    const seen = watch('/sources/pages');
    const { user } = renderTab();
    expect(await rows()).toHaveLength(3);
    await user.click(screen.getByRole('combobox', { name: 'Order by' }));
    await user.click(await screen.findByRole('option', { name: 'Prompts' }));
    await waitFor(() => expect(seen.at(-1)?.searchParams.get('sort')).toBe('-prompts'));
    await user.click(screen.getByRole('combobox', { name: 'Fewest citation units' }));
    await user.click(await screen.findByRole('option', { name: 'At least 10 units' }));
    await waitFor(() => expect(seen.at(-1)?.searchParams.get('min_support')).toBe('10'));
    await waitFor(async () => expect(await rows()).toHaveLength(2));
  });

  it('search finds a page by its title or its address', async () => {
    const { user } = renderTab();
    await rows();
    const search = screen.getByRole('searchbox', { name: 'Search in table' });
    expect(search).toHaveAttribute('placeholder', 'Search listed pages');
    await user.type(search, 'products/p1');
    await waitFor(async () => expect(await rows()).toHaveLength(1));
    expect(await rowNamed(/^Page 1/)).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'nothing');
    expect(await screen.findByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
  });

  it('keeps the domain of the address: the read still asks for that domain only', async () => {
    const seen = watch('/sources/pages');
    renderTab({}, 'domain=equals:g2.com');
    await rows();
    expect(seen[0]?.searchParams.get('filter[registrable_domain]')).toBe('g2.com');
  });

  describe('states', () => {
    it('shows skeleton rows while loading and keeps the rows while it reads again', async () => {
      const first = gate();
      const second = gate();
      let calls = 0;
      server.use(
        http.get(PAGES, async ({ request }) => {
          calls += 1;
          await (calls === 1 ? first.opened : second.opened);
          const min = Number(new URL(request.url).searchParams.get('min_support') ?? '1');
          return HttpResponse.json(pagePage([ONE, TWO].filter((row) => row.citation_units >= min)));
        }),
      );
      const { user } = renderTab();
      expect(await screen.findByRole('status', { name: 'Loading pages' })).toBeInTheDocument();
      act(() => first.open());
      const found = await list();
      await user.click(screen.getByRole('combobox', { name: 'Fewest citation units' }));
      await user.click(await screen.findByRole('option', { name: 'At least 3 units' }));
      await waitFor(() => expect(found).toHaveAttribute('aria-busy', 'true'));
      expect(within(found).getAllByRole('button')).toHaveLength(2);
      act(() => second.open());
      await waitFor(() => expect(found).not.toHaveAttribute('aria-busy'));
    });

    it('is empty when no answer was read', async () => {
      servePages([], { meta: EMPTY_META });
      renderTab();
      expect(await screen.findByRole('heading', { name: 'No citations yet' })).toBeInTheDocument();
    });

    it('filtered to nothing names the filters and offers Clear filters', async () => {
      servePages([]);
      const onClear = vi.fn();
      const { user } = renderTab({ values: { role: { kind: 'enum', values: ['own'] } }, onClear });
      expect(
        await screen.findByRole('heading', { name: 'No domain or page matches these filters' }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(onClear).toHaveBeenCalledOnce();
    });

    it('a failed read shows the inline error with Try again and keeps the toolbar', async () => {
      let calls = 0;
      server.use(
        http.get(PAGES, ({ request }) => {
          calls += 1;
          if (calls === 1) return problem(request, 'not_found');
          return HttpResponse.json(pagePage([ONE, TWO]));
        }),
      );
      const { user } = renderTab();
      expect(await screen.findByText('Citations could not be loaded')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Order by' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await rows()).toHaveLength(2);
    });
  });

  it('from 768 px the table is back', async () => {
    restoreWideScreen();
    stubTablet();
    renderTab();
    const table = await screen.findByRole('grid', { name: 'Cited pages' });
    await waitFor(() => expect(within(table).queryAllByRole('rowheader').length).toBeGreaterThan(0));
    expect(screen.queryByRole('list', { name: /^Cited pages/ })).toBeNull();
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
