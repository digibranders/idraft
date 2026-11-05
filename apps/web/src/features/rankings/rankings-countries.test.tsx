import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { KeywordCountry } from './keyword-countries';
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
    opensOn,
  }: {
    location: ProjectDefaults['location'];
    inUse: readonly KeywordCountry[];
    opensOn?: number;
  }) {
    return <span data-testid="opens">{String(useKeywordScope(location, inUse, opensOn).countryId)}</span>;
  }
  const opens = (location: ProjectDefaults['location'], inUse: readonly KeywordCountry[], opensOn?: number): string => {
    const { unmount } = renderWithProviders(
      <Opens location={location} inUse={inUse} {...(opensOn === undefined ? {} : { opensOn })} />,
    );
    const shown = screen.getByTestId('opens').textContent ?? '';
    unmount();
    return shown;
  };

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
