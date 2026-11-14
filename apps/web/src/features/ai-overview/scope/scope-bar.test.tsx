import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MOCK_TERM_IDS } from '@/mocks/entity-fixtures';
import { mswPath } from '@/mocks/respond';
import { overviewAs } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const NOW = new Date('2026-11-12T12:00:00Z');
const PROMPTS = mswPath('/api/v1/workspaces/:w/projects/:p/prompts');
const SEO = MOCK_TERM_IDS.seo;
const UNKNOWN_TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';
const NARROW = 24;

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Rendered = ReturnType<typeof renderWithProviders>;

/** The page with the URLs it writes collected, ready once the scope bar has drawn. */
async function page(searchParams = ''): Promise<{ user: Rendered['user']; urls: string[] }> {
  const urls: string[] = [];
  const { user } = renderWithProviders(overviewAs('admin'), {
    searchParams,
    onUrlUpdate: (event) => urls.push(event.queryString),
  });
  await screen.findByRole('button', { name: /^Engines: / });
  return { user, urls };
}

const chip = (name: string): Promise<HTMLElement> => screen.findByRole('button', { name });
const lastUrl = (urls: readonly string[]): string => new URLSearchParams(urls.at(-1) ?? '').toString();

describe('the scope bar', () => {
  it('renders compare, engines, then the filter bar with the Branded Excluded chip and no Clear filters', async () => {
    await page();
    const compare = screen.getByRole('button', { name: 'vs previous period' });
    const engines = screen.getByRole('button', { name: 'Engines: 2 of 2' });
    const branded = await chip('Branded: Excluded. Edit filter');
    const add = screen.getByRole('button', { name: 'Add a filter' });
    const follows = (a: HTMLElement, b: HTMLElement): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(compare, engines)).toBe(true);
    expect(follows(engines, branded)).toBe(true);
    expect(follows(branded, add)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
  });

  it('draws the compare and engines triggers in the type of the chips beside them', async () => {
    await page();
    for (const name of ['vs previous period', 'Engines: 2 of 2']) {
      const trigger = screen.getByRole('button', { name });
      expect(trigger).toHaveClass('type-body');
      expect(trigger).not.toHaveClass('type-body-strong');
    }
  });

  it.each(['?engine=chatgpt_web,gemini_web', '?engine=gemini_web,chatgpt_web'])(
    'treats %s, every engine in any order, as no filter',
    async (searchParams) => {
      await page(searchParams);
      expect(screen.getByRole('button', { name: 'Engines: 2 of 2' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
    },
  );

  it('does not count every engine as an active filter on a phone', async () => {
    stubViewport(NARROW);
    renderWithProviders(overviewAs('admin'), { searchParams: '?engine=gemini_web,chatgpt_web' });
    expect(await screen.findByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });

  it('never writes the default Branded choice to the URL', async () => {
    const { user, urls } = await page('?branded=included');
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    await user.click(await screen.findByRole('button', { name: 'Branded' }));
    await user.click(await screen.findByRole('radio', { name: 'Excluded' }));
    await waitFor(() => {
      expect(lastUrl(urls)).toBe('');
    });
    expect(await chip('Branded: Excluded. Edit filter')).toBeInTheDocument();
  });

  it('removes the chip to mean Included, and the chip goes', async () => {
    const { user, urls } = await page();
    await user.click(await chip('Remove filter Branded: Excluded'));
    await waitFor(() => {
      expect(lastUrl(urls)).toBe('branded=included');
    });
    expect(screen.queryByRole('button', { name: /^Branded:/ })).not.toBeInTheDocument();
    // The strip names the choice again
    expect(await screen.findByRole('group', { name: /branded prompts included$/ })).toBeInTheDocument();
  });

  it('offers Topic and brings Branded back from + Filter', async () => {
    const { user } = await page('?branded=included');
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    expect(await screen.findByRole('button', { name: 'Topic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Branded' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Branded' }));
    await user.click(await screen.findByRole('radio', { name: 'Only' }));
    expect(await chip('Branded: Only. Edit filter')).toBeInTheDocument();
  });

  it('chooses a topic from the vocabulary and writes its id', async () => {
    const { user, urls } = await page();
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    await user.click(await screen.findByRole('button', { name: 'Topic' }));
    // A topic below another is named by its path; the parent says it includes its subtopics
    expect(await screen.findByRole('radio', { name: 'SEO (includes subtopics)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Paid Search' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'SEO / Technical SEO' }));
    await waitFor(() => {
      expect(new URLSearchParams(urls.at(-1)).get('topic')).toBe(MOCK_TERM_IDS.technicalSeo);
    });
    expect(await chip('Topic: SEO / Technical SEO. Edit filter')).toBeInTheDocument();
  });

  it('keeps a topic of the link while the vocabulary loads, and counts the topics below it once it has', async () => {
    renderWithProviders(overviewAs('admin'), { searchParams: `?topic=${SEO}` });
    expect(await chip('Topic: SEO (includes subtopics). Edit filter')).toBeInTheDocument();
    // SEO, Technical SEO and Local SEO: the count of the Prompts number is of the chosen subtree
    await waitFor(() => {
      expect(screen.getAllByRole('definition')[0]).toHaveAccessibleDescription(/in 3 topics/);
    });
  });

  it('drops a topic of the link that the vocabulary does not hold, and says so once', async () => {
    const { urls } = await page(`?topic=${UNKNOWN_TOPIC}`);
    expect(await screen.findByText('A filter from the link was left out')).toBeInTheDocument();
    expect(screen.getByText('Topic: the link holds a value this project has nothing for.')).toBeInTheDocument();
    await waitFor(() => {
      expect(new URLSearchParams(urls.at(-1)).has('topic')).toBe(false);
    });
    expect(screen.getAllByText('A filter from the link was left out')).toHaveLength(1);
  });

  it('drops an engine of the link that is off in the project, and says so once', async () => {
    const { urls } = await page('?engine=chatgpt_web,google_ai_mode');
    expect(await screen.findByText('A filter from the link was left out')).toBeInTheDocument();
    expect(screen.getByText('Engines: the link holds a value this project has nothing for.')).toBeInTheDocument();
    await waitFor(() => {
      expect(urls.at(-1)).toBe('?engine=chatgpt_web');
    });
    expect(screen.getByRole('button', { name: 'Engines: 1 of 2' })).toBeInTheDocument();
    expect(screen.getAllByText('A filter from the link was left out')).toHaveLength(1);
  });

  it('puts the window and the country in the top bar', async () => {
    await page();
    const bar = screen.getByRole('banner');
    expect(await within(bar).findByRole('button', { name: /Last 28 days|28 days/ })).toBeInTheDocument();
    expect(await within(bar).findByRole('combobox', { name: 'Country: All countries' })).toBeInTheDocument();
  });
});

describe('the country control of the scope bar', () => {
  it("lists the prompts' countries and all countries, and writes the one chosen", async () => {
    const { user, urls } = await page();
    const bar = screen.getByRole('banner');
    await user.click(await within(bar).findByRole('combobox', { name: 'Country: All countries' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'All countries',
      'Germany',
      'India',
    ]);
    await user.click(screen.getByRole('option', { name: 'India' }));
    await waitFor(() => {
      expect(lastUrl(urls)).toBe('country=IN');
    });
    expect(await within(bar).findByRole('combobox', { name: 'Country: India' })).toBeInTheDocument();
  });

  it('shows the ISO code under 1024 px and the name from 1024 px', async () => {
    await page('?country=DE');
    const bar = screen.getByRole('banner');
    await within(bar).findByRole('combobox', { name: 'Country: Germany' });
    expect(within(bar).getByText('DE')).toHaveClass('lg:hidden');
    expect(within(bar).getByText('Germany')).toHaveClass('hidden', 'lg:inline');
  });

  it('is a label with one country and no choice', async () => {
    const prompt = {
      prompt_id: '11111111-1111-4111-8111-111111111111',
      country_iso: 'DE',
      terms: [],
    };
    server.use(
      http.get(PROMPTS, () =>
        HttpResponse.json({ data: [prompt], page: { has_more: false, next_cursor: null, limit: 200 } }),
      ),
    );
    await page();
    const bar = screen.getByRole('banner');
    // Nothing to choose between: the control is a label (it says all countries, as the one country is all of them)
    expect(await within(bar).findByText('Country: All countries')).toBeInTheDocument();
    expect(within(bar).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /^Country:/ })).not.toBeInTheDocument();
  });

  it('clears the country only: the other scope keys stay', async () => {
    const { user, urls } = await page('?country=DE&engine=gemini_web&branded=only&win=7d&cmp=off');
    const bar = screen.getByRole('banner');
    await user.click(await within(bar).findByRole('combobox', { name: 'Country: Germany' }));
    await user.click(await screen.findByRole('option', { name: 'All countries' }));
    await waitFor(() => {
      expect(new URLSearchParams(urls.at(-1)).has('country')).toBe(false);
    });
    const kept = new URLSearchParams(urls.at(-1));
    expect(kept.get('engine')).toBe('gemini_web');
    expect(kept.get('branded')).toBe('only');
    expect(kept.get('cmp')).toBe('off');
    expect(kept.get('win')).toBe('7d');
  });
});

describe('Reset filters', () => {
  it('appears while anything differs from the default and puts back the filters, not the window or the country', async () => {
    const { user, urls } = await page(
      `?win=7d&country=DE&cmp=off&engine=gemini_web&branded=only&topic=${MOCK_TERM_IDS.technicalSeo}`,
    );
    await user.click(await screen.findByRole('button', { name: 'Reset filters' }));
    await waitFor(() => {
      expect(lastUrl(urls)).toBe('win=7d&country=DE');
    });
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
    expect(await chip('Branded: Excluded. Edit filter')).toBeInTheDocument();
  });

  it('is absent when only the window and the country are not the default', async () => {
    await page('?win=7d&country=DE');
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
  });

  it('appears for the comparison alone', async () => {
    await page('?cmp=off');
    expect(await screen.findByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
  });
});

describe('the scope bar below 768 px', () => {
  beforeEach(() => {
    stubViewport(NARROW);
  });

  it('is one Filters button with the count of filters that differ, and the controls are in its sheet', async () => {
    const { user } = renderWithProviders(overviewAs('admin'), { searchParams: '?cmp=off&engine=gemini_web&win=7d' });
    const button = await screen.findByRole('button', { name: 'Filters, 2 active' });
    expect(within(button).getByText('2')).toBeInTheDocument();
    // Not in the page: the compare menu, the engines and the chips are all behind the button
    expect(screen.queryByRole('button', { name: 'Add a filter' })).not.toBeInTheDocument();
    // The window and the country left the top bar
    expect(within(screen.getByRole('banner')).queryByRole('combobox')).not.toBeInTheDocument();
    await user.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Filters' });
    expect(within(sheet).getByRole('button', { name: 'No comparison' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Engines: 1 of 2' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Branded: Excluded. Edit filter' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Add a filter' })).toBeInTheDocument();
    expect(await within(sheet).findByRole('combobox', { name: 'Country: All countries' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /7 days/ })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
    });
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();
  });

  it('has no badge while nothing differs', async () => {
    renderWithProviders(overviewAs('admin'));
    const button = await screen.findByRole('button', { name: 'Filters' });
    expect(within(button).queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('applies a choice made in the sheet at once, and Escape closes it with the choice kept', async () => {
    const urls: string[] = [];
    const { user } = renderWithProviders(overviewAs('admin'), {
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    await user.click(await screen.findByRole('button', { name: 'Filters' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filters' });
    await user.click(within(sheet).getByRole('button', { name: 'vs previous period' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'No comparison' }));
    await waitFor(() => {
      expect(lastUrl(urls)).toBe('cmp=off');
    });
    // The menu closes first; Escape then belongs to the sheet
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
    });
    expect(lastUrl(urls)).toBe('cmp=off');
    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toHaveFocus();
  });
});
