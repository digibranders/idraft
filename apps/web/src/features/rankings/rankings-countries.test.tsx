import { screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import en from '../../../messages/en.json';

import type { KeywordCountry } from './keyword-countries';
import type { Country } from './keyword-filters';
import { DEFAULT_COUNTRY_ID, useKeywordScope } from './keyword-scope';
import type { ProjectDefaults } from './add-keywords/add-keywords-dialog';
import { cleanstart, loadedGrid, rankingsAs as as, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/msw';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

beforeEach(stubWideScreen);
afterEach(restoreWideScreen);

const GERMANY = 2276;
const UNITED_STATES = 2840;

/** The query strings of the list reads, newest last. */
function listQueries(): URLSearchParams[] {
  const asked: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.pathname.endsWith('/tracked-keywords')) return;
    if (url.searchParams.get('limit') === '1' || url.searchParams.get('sort') === '-created_at') return;
    asked.push(url.searchParams);
  });
  return asked;
}

const COUNTRIES_IN_USE = '*/api/v1/workspaces/:w/projects/:p/tracked-keywords/countries';

/** The countries the project has keywords in, as the API answers them, after `wait` milliseconds. */
const inUseAnswer = (
  entries: readonly (readonly [number, string, string, number])[],
  wait = 0,
): ReturnType<typeof http.get> =>
  http.get(COUNTRIES_IN_USE, async () => {
    if (wait > 0) await delay(wait);
    return HttpResponse.json({
      data: entries.map(([id, name, iso, count]) => ({
        location: { location_id: id, name, country_iso: iso, location_type: 'Country' },
        keyword_count: count,
      })),
    });
  });

const headerNames = (grid: HTMLElement): string[] =>
  within(grid)
    .getAllByRole('columnheader')
    .map((header) => header.textContent?.replace(/\s+/g, ' ').trim() ?? '');

describe('the country control', () => {
  it('lists the countries the project has keywords in, and all countries, and no other', async () => {
    const { user } = renderWithProviders(as('viewer'));
    await loadedGrid();
    await user.click(await screen.findByRole('combobox', { name: 'Country: All countries' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['All countries', 'Germany', 'United States']);
    expect(screen.queryByRole('option', { name: 'Japan' })).toBeNull();
  });

  it('is a label, not a control, for a project with no keywords, and names its default country', async () => {
    renderWithProviders(as('viewer', cleanstart.project_id, { opensOnOwnCountry: true }));
    await screen.findByRole('grid', { name: 'Tracked keywords' });
    await waitFor(() => expect(screen.getByText('United States', { selector: '[aria-hidden]' })).toBeInTheDocument());
    // Not a control: no button or combobox, so it is not a tab stop
    expect(screen.queryByRole('combobox', { name: /^Country:/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Country:/ })).toBeNull();
    expect(screen.queryByText('All countries')).toBeNull();
  });

  it('is a label when the scope is the one country in use', async () => {
    server.use(inUseAnswer([[2356, 'India', 'IN', 4]]));
    renderWithProviders(as('viewer', undefined, { opensOnOwnCountry: true }));
    await waitFor(() => expect(screen.getByText('India', { selector: '[aria-hidden]' })).toBeInTheDocument());
    expect(screen.queryByRole('combobox', { name: /^Country:/ })).toBeNull();
  });

  it('stays a control when a link names a country other than the one in use, so the person can leave it', async () => {
    server.use(inUseAnswer([[2356, 'India', 'IN', 4]]));
    const { user } = renderWithProviders(as('viewer'), { searchParams: `?loc=${String(UNITED_STATES)}` });
    await screen.findByRole('grid', { name: 'Tracked keywords' });
    await user.click(await screen.findByRole('combobox', { name: 'Country: United States' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'All countries',
      'India',
    ]);
  });

  it('stays a control for all countries when only one is in use', async () => {
    server.use(inUseAnswer([[2356, 'India', 'IN', 4]]));
    renderWithProviders(as('viewer'), { searchParams: '?loc=0' });
    await screen.findByRole('grid', { name: 'Tracked keywords' });
    expect(await screen.findByRole('combobox', { name: 'Country: All countries' })).toBeInTheDocument();
  });
});

describe('a shared Country chip', () => {
  it('is kept when the countries in use cannot be read', async () => {
    server.use(http.get(COUNTRIES_IN_USE, () => HttpResponse.json({ error: 'down' }, { status: 500 })));
    const asked = listQueries();
    renderWithProviders(as('viewer'), { searchParams: `?loc=0&country=${String(GERMANY)}` });
    await loadedGrid();
    await waitFor(() =>
      expect(asked.some((query) => query.get('filter[country_id_in]') === String(GERMANY))).toBe(true),
    );
    expect(screen.queryByText(/left out/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Country: .*\. Edit filter$/ })).toHaveLength(1);
  });
});

describe('waiting for the countries in use', () => {
  it('asks for the list in the country it resolves to, never in the guess, and shows no empty state meanwhile', async () => {
    // The project's own country is Germany, which has no keywords: the table opens on the United States
    server.use(inUseAnswer([[UNITED_STATES, 'United States', 'US', 5]], 150));
    const asked = listQueries();
    const flashed = vi.fn();
    const watcher = new MutationObserver(() => {
      if (document.body.textContent?.includes(en.rankings.empty.title) === true) flashed();
    });
    watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
    renderWithProviders(as('viewer', undefined, { opensOnOwnCountry: true }));
    await loadedGrid();
    watcher.disconnect();
    expect(asked.length).toBeGreaterThan(0);
    expect(asked[0]?.get('filter[country_id]')).toBe(String(UNITED_STATES));
    expect(asked.some((query) => query.get('filter[country_id]') === String(GERMANY))).toBe(false);
    expect(flashed).not.toHaveBeenCalled();
  });

  it('does not wait for ever when the countries in use cannot be read: it asks in the project’s own country', async () => {
    server.use(http.get(COUNTRIES_IN_USE, () => HttpResponse.json({ error: 'down' }, { status: 500 })));
    const asked = listQueries();
    renderWithProviders(as('viewer', undefined, { opensOnOwnCountry: true }));
    await waitFor(() => expect(asked.some((query) => query.get('filter[country_id]') === String(GERMANY))).toBe(true));
  });

  it('asks at once when the link names the country', async () => {
    server.use(inUseAnswer([[UNITED_STATES, 'United States', 'US', 5]], 400));
    const asked = listQueries();
    renderWithProviders(as('viewer', undefined, { opensOnOwnCountry: true }), {
      searchParams: `?loc=${String(GERMANY)}`,
    });
    await waitFor(() => expect(asked.some((query) => query.get('filter[country_id]') === String(GERMANY))).toBe(true));
  });
});

describe('the Country column', () => {
  it('shows with both countries while every country is in view', async () => {
    renderWithProviders(as('viewer'), { searchParams: '?loc=0' });
    const grid = await loadedGrid();
    await waitFor(() => expect(headerNames(grid)).toContain('Country'));
    const names = new Set(
      within(grid)
        .getAllByRole('rowheader')
        .map((header) => header.closest('tr'))
        .flatMap((row) => (row === null ? [] : [...row.cells].map((cell) => cell.textContent ?? '')))
        .filter((text) => text === 'Germany' || text === 'United States'),
    );
    expect(names).toEqual(new Set(['Germany', 'United States']));
    // Right after the keyword column
    expect(headerNames(grid).indexOf('Country')).toBe(headerNames(grid).findIndex((name) => name === 'Keyword') + 1);
  });

  it('is left out while one country is in view', async () => {
    renderWithProviders(as('viewer'), { searchParams: `?loc=${String(GERMANY)}` });
    const grid = await loadedGrid();
    expect(headerNames(grid)).not.toContain('Country');
  });

  it('keeps a person’s choice of it in the URL while it is out of view', async () => {
    const written: string[] = [];
    const { user } = renderWithProviders(as('viewer'), {
      searchParams: `?loc=${String(GERMANY)}&cols=keyword,country,search_volume`,
      onUrlUpdate: (event) => written.push(event.queryString),
    });
    const grid = await loadedGrid();
    expect(headerNames(grid)).not.toContain('Country');
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(await screen.findByRole('checkbox', { name: 'KD' }));
    await waitFor(() => expect(new URLSearchParams(written.at(-1) ?? '').get('cols')).toContain('country'));
    expect(new URLSearchParams(written.at(-1) ?? '').get('cols')).toBe(
      'keyword,country,search_volume,keyword_difficulty',
    );
  });
});

describe('the Country column and the default columns', () => {
  it('stays among the columns written to the URL when another is hidden while one country is in view', async () => {
    const written: string[] = [];
    const { user } = renderWithProviders(as('viewer'), {
      searchParams: `?loc=${String(GERMANY)}`,
      onUrlUpdate: (event) => written.push(event.queryString),
    });
    const grid = await loadedGrid();
    expect(headerNames(grid)).not.toContain('Country');
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(await screen.findByRole('checkbox', { name: 'CPC (USD)' }));
    await waitFor(() => expect(new URLSearchParams(written.at(-1) ?? '').has('cols')).toBe(true));
    const columns = (new URLSearchParams(written.at(-1) ?? '').get('cols') ?? '').split(',');
    expect(columns.slice(0, 2)).toEqual(['keyword', 'country']);
    expect(columns).not.toContain('cpc_usd');
  });
});

describe('the Country filter', () => {
  it('sends the countries chosen as filter[country_id_in] and shows one chip', async () => {
    const asked = listQueries();
    const { user } = renderWithProviders(as('viewer'));
    const grid = await loadedGrid();
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    const picker = (await screen.findAllByRole('button', { name: 'Country' })).find((button) => !grid.contains(button));
    if (picker === undefined) throw new Error('The field picker has no Country');
    await user.click(picker);
    await user.click(await screen.findByRole('checkbox', { name: /^Germany/ }));
    await user.click(screen.getByRole('checkbox', { name: /^United States/ }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(
        asked.some((query) => query.get('filter[country_id_in]') === `${String(GERMANY)},${String(UNITED_STATES)}`),
      ).toBe(true),
    );
    expect(screen.getAllByRole('button', { name: /^Country: .*\. Edit filter$/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Country: Germany, United States. Edit filter' })).toBeInTheDocument();
  });
});

describe('the country the table opens on', () => {
  const germany: KeywordCountry = { locationId: GERMANY, name: 'Germany', countryIso: 'DE', keywordCount: 3 };
  const us: KeywordCountry = { locationId: UNITED_STATES, name: 'United States', countryIso: 'US', keywordCount: 9 };
  const inCountry = (location_id: number, country_iso: string): ProjectDefaults['location'] => ({
    location_id,
    name: 'Somewhere',
    location_type: 'Country',
    country_iso,
  });

  function Opens({
    location,
    inUse,
    loading,
    opensOn,
    known,
  }: {
    location: ProjectDefaults['location'];
    inUse: readonly KeywordCountry[];
    loading: boolean;
    opensOn?: number;
    known: readonly Country[];
  }) {
    const scope = useKeywordScope(location, { countries: inUse, loading }, opensOn, known);
    return (
      <span data-testid="opens">
        {String(scope.countryId)} {scope.ready ? 'ready' : 'waiting'}
      </span>
    );
  }
  const readScope = (
    location: ProjectDefaults['location'],
    inUse: readonly KeywordCountry[],
    options: { loading?: boolean; opensOn?: number; known?: readonly Country[] } = {},
  ): string => {
    const { unmount } = renderWithProviders(
      <Opens
        location={location}
        inUse={inUse}
        loading={options.loading ?? false}
        known={options.known ?? []}
        {...(options.opensOn === undefined ? {} : { opensOn: options.opensOn })}
      />,
    );
    const shown = screen.getByTestId('opens').textContent ?? '';
    unmount();
    return shown;
  };
  const opens = (location: ProjectDefaults['location'], inUse: readonly KeywordCountry[]): string =>
    readScope(location, inUse).split(' ')[0] ?? '';

  it('resolves the country of a city through the countries in use, else through the known countries', () => {
    const city: ProjectDefaults['location'] = {
      location_id: 1003854,
      name: 'Berlin',
      location_type: 'City',
      country_iso: 'DE',
    };
    const known: readonly Country[] = [
      {
        location_id: GERMANY,
        name: 'Germany',
        country_iso: 'DE',
        location_type: 'Country',
        parent_id: null,
        supports: ['serp'],
      },
    ];
    // Keywords only in the United States: the city's country has none, so the one with keywords opens
    expect(readScope(city, [us], { known })).toBe(`${String(UNITED_STATES)} ready`);
    // No keywords at all: the country of the city, found among the known countries
    expect(readScope(city, [], { known })).toBe(`${String(GERMANY)} ready`);
    expect(readScope(city, [germany], { known: [] })).toBe(`${String(GERMANY)} ready`);
  });

  it('is not ready while the countries in use load, unless the link or the screen names the country', () => {
    expect(readScope(inCountry(GERMANY, 'DE'), [], { loading: true })).toBe(`${String(GERMANY)} waiting`);
    expect(readScope(inCountry(GERMANY, 'DE'), [], { loading: true, opensOn: 0 })).toBe('0 ready');
  });

  it('is the project’s own country when it has keywords there', () => {
    expect(opens(inCountry(GERMANY, 'DE'), [us, germany])).toBe(String(GERMANY));
  });

  it('is the country with most keywords when the project’s own has none', () => {
    expect(opens(inCountry(2356, 'IN'), [germany, us])).toBe(String(UNITED_STATES));
  });

  it('is the project’s default when it has no keywords, and India without a default', () => {
    expect(opens(inCountry(GERMANY, 'DE'), [])).toBe(String(GERMANY));
    expect(opens(null, [])).toBe(String(DEFAULT_COUNTRY_ID));
  });
});
