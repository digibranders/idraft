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
  await screen.findByRole('combobox', { name: /^Platform: / });
  return { user, urls };
}

const chip = (name: string): Promise<HTMLElement> => screen.findByRole('button', { name });
const lastUrl = (urls: readonly string[]): string => new URLSearchParams(urls.at(-1) ?? '').toString();

describe('the scope bar', () => {
  it('renders platform, group, compare, reset, then the filter bar with the Branded Excluded chip and no Clear filters', async () => {
    await page();
    const platform = screen.getByRole('combobox', { name: 'Platform: All platforms' });
    const group = screen.getByRole('combobox', { name: 'Group: All groups' });
    const compare = screen.getByRole('button', { name: 'Compare with: vs previous period' });
    const reset = screen.getByRole('button', { name: 'Reset scope' });
    const branded = await chip('Branded: Excluded. Edit filter');
    const follows = (a: HTMLElement, b: HTMLElement): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(platform, group)).toBe(true);
    expect(follows(group, compare)).toBe(true);
    expect(follows(compare, reset)).toBe(true);
    expect(follows(reset, branded)).toBe(true);
    // With the chip on there is nothing to add: no "+ Filter", disabled or not
    expect(screen.queryByRole('button', { name: 'Add a filter' })).not.toBeInTheDocument();
    // Reset keeps its place while the scope is the default, invisible and out of the tab order
    expect(reset).toHaveClass('invisible');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('gives the selects one fixed width from 640 px, so a longer choice moves nothing', async () => {
    await page();
    for (const name of ['Platform: All platforms', 'Group: All groups']) {
      expect(screen.getByRole('combobox', { name })).toHaveClass('w-full', 'sm:w-60');
    }
    const compare = screen.getByRole('button', { name: 'Compare with: vs previous period' });
    // Wider than the other two: "Compare with: vs same period last year" has to show whole
    expect(compare).toHaveClass('type-body', 'w-full', 'sm:w-80');
    expect(compare).not.toHaveClass('type-body-strong');
  });

  it('lists the platforms that are on with Google AI Overview as not available, and writes one choice as one engine', async () => {
    const { user, urls } = await page();
    await user.click(screen.getByRole('combobox', { name: 'Platform: All platforms' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'All platforms',
      'ChatGPT',
      'Gemini',
      'Google AI OverviewNot available',
    ]);
    expect(screen.getByRole('option', { name: /AI Overview/ })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('option', { name: 'Gemini' }));
    await waitFor(() => {
      expect(lastUrl(urls)).toBe('engine=gemini_web');
    });
    expect(await screen.findByRole('combobox', { name: 'Platform: Gemini' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Platform: Gemini' }));
    await user.click(await screen.findByRole('option', { name: 'All platforms' }));
    await waitFor(() => {
      expect(lastUrl(urls)).toBe('');
    });
  });

  it.each(['?engine=chatgpt_web,gemini_web', '?engine=gemini_web,chatgpt_web'])(
    'treats %s, every platform in any order, as no filter',
    async (searchParams) => {
      await page(searchParams);
      expect(screen.getByRole('combobox', { name: 'Platform: All platforms' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset scope' })).toHaveClass('invisible');
    },
  );

  it('does not count every platform as an active filter on a phone', async () => {
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
    // The Prompts tile of the headline names the choice again
    await waitFor(() => {
      const box = screen.getByText('Prompts', { selector: 'span.type-label' }).closest('div.bg-surface');
      expect(box?.querySelector('.type-metric')).toHaveTextContent(/core and branded prompts/);
    });
  });

  it('brings Branded back from + Filter, which offers nothing else', async () => {
    const { user } = await page('?branded=included');
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    expect(await screen.findByRole('button', { name: 'Branded' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Group' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Branded' }));
    await user.click(await screen.findByRole('radio', { name: 'Only' }));
    expect(await chip('Branded: Only. Edit filter')).toBeInTheDocument();
  });

  it('chooses a group from the vocabulary, searches it and writes its id', async () => {
    const { user, urls } = await page();
    await user.click(screen.getByRole('combobox', { name: 'Group: All groups' }));
    // One flat list of groups: a topic below another is named by its path, and a topic above a group is no row
    expect(await screen.findByRole('option', { name: 'SEO / Technical SEO' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'SEO' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Paid Search' })).toBeInTheDocument();
    await user.type(screen.getByRole('combobox', { name: 'Search groups' }), 'technical');
    expect(screen.queryByRole('option', { name: 'Paid Search' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'SEO / Technical SEO' }));
    await waitFor(() => {
      expect(new URLSearchParams(urls.at(-1)).get('topic')).toBe(MOCK_TERM_IDS.technicalSeo);
    });
    expect(await screen.findByRole('combobox', { name: 'Group: SEO / Technical SEO' })).toBeInTheDocument();
  });

  it('keeps a group of the link while the vocabulary loads, and counts the groups below it once it has', async () => {
    renderWithProviders(overviewAs('admin'), { searchParams: `?topic=${SEO}` });
    expect(await screen.findByRole('combobox', { name: 'Group: SEO' })).toBeInTheDocument();
    // Once the vocabulary has loaded the group is named, and the Prompts tile of the headline counts the group's prompts
    await waitFor(() => {
      const box = screen.getByText('Prompts', { selector: 'span.type-label' }).closest('div.bg-surface');
      expect(box?.querySelector('.type-metric')).toHaveTextContent(/in SEO$/);
    });
  });

  it('drops a group of the link that the vocabulary does not hold, and says so once', async () => {
    const { urls } = await page(`?topic=${UNKNOWN_TOPIC}`);
    expect(await screen.findByText('A filter from the link was left out')).toBeInTheDocument();
    expect(screen.getByText('Group: the link holds a value this project has nothing for.')).toBeInTheDocument();
    await waitFor(() => {
      expect(new URLSearchParams(urls.at(-1)).has('topic')).toBe(false);
    });
    expect(screen.getAllByText('A filter from the link was left out')).toHaveLength(1);
  });

  it('drops a platform of the link that is off in the project, and says so once', async () => {
    const { urls } = await page('?engine=chatgpt_web,google_ai_mode');
    expect(await screen.findByText('A filter from the link was left out')).toBeInTheDocument();
    expect(screen.getByText('Platform: the link holds a value this project has nothing for.')).toBeInTheDocument();
    await waitFor(() => {
      expect(urls.at(-1)).toBe('?engine=chatgpt_web');
    });
    expect(await screen.findByRole('combobox', { name: 'Platform: ChatGPT' })).toBeInTheDocument();
    expect(screen.getAllByText('A filter from the link was left out')).toHaveLength(1);
  });

  it('puts the window and the location in the top bar', async () => {
    await page();
    const bar = screen.getByRole('banner');
    expect(await within(bar).findByRole('button', { name: /Last 28 days|28 days/ })).toBeInTheDocument();
    expect(await within(bar).findByRole('combobox', { name: 'Location: All locations' })).toBeInTheDocument();
  });
});

describe('the location control of the scope bar', () => {
  it("lists the prompts' locations and all locations, and writes the one chosen", async () => {
    const { user, urls } = await page();
    const bar = screen.getByRole('banner');
    await user.click(await within(bar).findByRole('combobox', { name: 'Location: All locations' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'All locations',
      'Germany',
      'India',
    ]);
    await user.click(screen.getByRole('option', { name: 'India' }));
    await waitFor(() => {
      expect(lastUrl(urls)).toBe('country=IN');
    });
    expect(await within(bar).findByRole('combobox', { name: 'Location: India' })).toBeInTheDocument();
  });

  it('shows the ISO code under 1024 px and the name from 1024 px', async () => {
    await page('?country=DE');
    const bar = screen.getByRole('banner');
    await within(bar).findByRole('combobox', { name: 'Location: Germany' });
    expect(within(bar).getByText('DE')).toHaveClass('lg:hidden');
    expect(within(bar).getByText('Germany')).toHaveClass('hidden', 'lg:inline');
  });

  it('is a label with one location and no choice', async () => {
    const prompt = {
      prompt_id: '11111111-1111-4111-8111-111111111111',
      country_iso: 'DE',
      terms: [],
      current_version: { text: 'best crm for agencies' },
    };
    server.use(
      http.get(PROMPTS, () =>
        HttpResponse.json({ data: [prompt], page: { has_more: false, next_cursor: null, limit: 200 } }),
      ),
    );
    await page();
    const bar = screen.getByRole('banner');
    // Nothing to choose between: the control is a label (it says all countries, as the one country is all of them)
    expect(await within(bar).findByText('Location: All locations')).toBeInTheDocument();
    expect(within(bar).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /^Location:/ })).not.toBeInTheDocument();
  });

  it('clears the location only: the other scope keys stay', async () => {
    const { user, urls } = await page('?country=DE&engine=gemini_web&branded=only&win=7d&cmp=off');
    const bar = screen.getByRole('banner');
    await user.click(await within(bar).findByRole('combobox', { name: 'Location: Germany' }));
    await user.click(await screen.findByRole('option', { name: 'All locations' }));
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

describe('Reset scope', () => {
  it('is visible while anything differs from the default and puts back the filters, not the window or the location', async () => {
    const { user, urls } = await page(
      `?win=7d&country=DE&cmp=off&engine=gemini_web&branded=only&topic=${MOCK_TERM_IDS.technicalSeo}`,
    );
    const reset = screen.getByRole('button', { name: 'Reset scope' });
    expect(reset).not.toHaveClass('invisible');
    await user.click(reset);
    await waitFor(() => {
      expect(lastUrl(urls)).toBe('win=7d&country=DE');
    });
    expect(screen.getByRole('button', { name: 'Reset scope' })).toHaveClass('invisible');
    expect(await chip('Branded: Excluded. Edit filter')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Platform: All platforms' })).toBeInTheDocument();
  });

  it('stays invisible when only the window and the location are not the default', async () => {
    await page('?win=7d&country=DE');
    expect(screen.getByRole('button', { name: 'Reset scope' })).toHaveClass('invisible');
  });

  it('is visible for the comparison alone', async () => {
    await page('?cmp=off');
    expect(await screen.findByRole('button', { name: 'Reset scope' })).not.toHaveClass('invisible');
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
    expect(within(sheet).getByRole('button', { name: 'Compare with: No comparison' })).toBeInTheDocument();
    expect(within(sheet).getByRole('combobox', { name: 'Platform: Gemini' })).toBeInTheDocument();
    expect(within(sheet).getByRole('combobox', { name: 'Group: All groups' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Branded: Excluded. Edit filter' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Add a filter' })).not.toBeInTheDocument();
    expect(await within(sheet).findByRole('combobox', { name: 'Location: All locations' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /7 days/ })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Reset scope' }));
    await waitFor(() => {
      expect(within(sheet).getByRole('button', { name: 'Reset scope' })).toHaveClass('invisible');
    });
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside the open sheet, and keeps what is behind it out of reach', async () => {
    // The skip link and the project switcher of the app shell sit before the page, as they do in the layout
    const { user } = renderWithProviders(
      <>
        <a href="#main">Skip to main content</a>
        <button type="button">Project switcher</button>
        {overviewAs('admin')}
        <button type="button">After the page</button>
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Filters' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filters' });
    await within(sheet).findByRole('combobox', { name: 'Location: All locations' });
    const behind = [
      document.querySelector('a[href="#main"]'),
      ...screen.getAllByRole('button', { hidden: true }).filter((button) => !sheet.contains(button)),
    ];
    // Every element that took focus: the trap's own guards are allowed to take it for a moment, the page behind is not
    const focused: Element[] = [];
    const record = (event: FocusEvent): void => {
      if (event.target instanceof Element) focused.push(event.target);
    };
    document.addEventListener('focusin', record);
    // More presses than the sheet has stops, so a leak would show as a stop behind it
    for (const shift of [false, true]) {
      for (let press = 0; press < 20; press += 1) {
        await user.tab({ shift });
        await waitFor(() => {
          expect(sheet.contains(document.activeElement)).toBe(true);
        });
      }
    }
    document.removeEventListener('focusin', record);
    expect(focused.length).toBeGreaterThan(20);
    expect(focused.filter((target) => behind.includes(target))).toEqual([]);
  });

  it('shows the Location name in the sheet under its label, not the pin alone', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    await user.click(await screen.findByRole('button', { name: 'Filters' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filters' });
    const control = await within(sheet).findByRole('combobox', { name: 'Location: All locations' });
    expect(control).toHaveTextContent('All locations');
    expect(within(sheet).getByText('Location')).toBeVisible();
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
    await user.click(within(sheet).getByRole('button', { name: 'Compare with: vs previous period' }));
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
