import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { DETAIL } from '../keyword-inspector/inspector-queries';
import { invalid, mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import {
  cleanstart,
  keywordsIn,
  loadedGrid,
  rankingsAs as as,
  restoreWideScreen,
  stubWideScreen,
} from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/keywords',
}));

beforeEach(stubWideScreen);
afterEach(restoreWideScreen);

const BULK_CREATE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-create';
const SETTINGS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/settings';
const QUOTA = '/api/v1/workspaces/{workspace_id}/tracked-keyword-quota';
const PRICE_BOOK = '/api/v1/workspaces/{workspace_id}/price-book';

/** The query strings the screen wrote, newest last. */
function urlWrites(): { onUrlUpdate: (event: UrlUpdateEvent) => void; latest: () => URLSearchParams } {
  const writes: string[] = [];
  return {
    onUrlUpdate: (event) => writes.push(event.queryString),
    latest: () => new URLSearchParams(writes.at(-1) ?? ''),
  };
}

type User = ReturnType<typeof renderWithProviders>['user'];

async function openDialog(user: User): Promise<HTMLElement> {
  await loadedGrid();
  await user.click(screen.getByRole('button', { name: 'Add keywords' }));
  return screen.findByRole('dialog', { name: 'Add keywords' });
}

const countriesField = (dialog: HTMLElement): HTMLElement =>
  within(dialog).getByRole('combobox', { name: /^Countries/ });
const chosenCountries = (dialog: HTMLElement): HTMLElement =>
  within(dialog).getByRole('toolbar', { name: 'Chosen Countries' });

/** Types part of a country's name in the Countries field, picks it, and leaves the field. */
async function pickCountry(user: User, dialog: HTMLElement, typed: string, name: string): Promise<void> {
  await user.type(countriesField(dialog), typed);
  await user.click(await screen.findByRole('option', { name }));
  await user.tab();
}

/** The dialog with the project's country, Germany, chosen once the list of countries is in. */
async function openWithCountry(user: User): Promise<HTMLElement> {
  const dialog = await openDialog(user);
  await within(dialog).findByRole('toolbar', { name: 'Chosen Countries' });
  return dialog;
}

const BULK_BODY = z.object({
  items: z.array(z.object({ keyword: z.string(), location_id: z.number().nullable() })),
});
type BulkItem = z.infer<typeof BULK_BODY>['items'][number];

/** Answers `bulk-create` with every item created, and remembers each request's items. */
function captureBulkCreate(): { requests: BulkItem[][] } {
  const requests: BulkItem[][] = [];
  server.use(
    http.post(mswPath(BULK_CREATE), async ({ request }) => {
      const { items } = BULK_BODY.parse(await request.json());
      requests.push(items);
      return HttpResponse.json({
        data: {
          created: items.map((_, index) => `created-${String(requests.length)}-${String(index)}`),
          restored: [],
          skipped: [],
          rejected: [],
        },
      });
    }),
  );
  return { requests };
}

describe('Add keywords', () => {
  it('counts the list as the API reads it, names a refused line, and adds the rest', async () => {
    const { user, container } = renderWithProviders(as('editor'));
    const dialog = await openDialog(user);
    const keywords = within(dialog).getByRole('textbox', { name: 'Keywords' });
    await user.type(keywords, 'rank tracker api{Enter}Rank Tracker API{Enter}site:fynix.io seo');
    expect(within(dialog).getByText('1 keyword · 1 repeat left out')).toBeInTheDocument();
    // Both devices make two tracked keywords of each
    await user.click(within(dialog).getByRole('radio', { name: 'Desktop and mobile' }));
    expect(within(dialog).getByText('1 keyword × 2 devices × 1 country = 2 checks a day')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await within(dialog).findByText(/^Line 3: search operators/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.clear(keywords);
    await user.type(keywords, 'rank tracker api');
    await user.click(within(dialog).getByRole('radio', { name: 'Desktop' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await screen.findByText('1 keyword added')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add keywords' })).toBeNull());
    const grid = await loadedGrid();
    await waitFor(() => expect(keywordsIn(grid)).toContain('rank tracker api'));
  }, 15_000);

  it('tells a keyword that came back from deletion apart from a new one', async () => {
    server.use(
      http.post(mswPath(BULK_CREATE), () =>
        HttpResponse.json({
          data: {
            created: ['0192d1a8-e007-7a10-8e07-000000000201', '0192d1a8-e007-7a10-8e07-000000000202'],
            restored: ['0192d1a8-e007-7a10-8e07-000000000201'],
            skipped: [],
            rejected: [],
          },
        }),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'old keyword{Enter}new keyword');
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 keywords' }));
    expect(await screen.findByText('2 keywords added')).toBeInTheDocument();
    expect(
      screen.getByText(
        '1 of them was deleted before and is back with its old settings and history. The new ones get their metrics within minutes.',
      ),
    ).toBeInTheDocument();
  });

  it('says so when every keyword came back from deletion, and in the result beside keywords tracked already', async () => {
    const restoredId = '0192d1a8-e007-7a10-8e07-000000000201';
    let skip = false;
    server.use(
      http.post(mswPath(BULK_CREATE), () =>
        HttpResponse.json({
          data: {
            created: [restoredId],
            restored: [restoredId],
            skipped: skip ? [{ index: 1, existing_id: '0192d1a8-e007-7a10-8e07-000000000001' }] : [],
            rejected: [],
          },
        }),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    let dialog = await openDialog(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'old keyword');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    // No new keywords: nothing is said about new ones' metrics
    expect(
      await screen.findByText('1 of them was deleted before and is back with its old settings and history.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add keywords' })).toBeNull());
    skip = true;
    await user.click(screen.getByRole('button', { name: 'Add keywords' }));
    dialog = await screen.findByRole('dialog', { name: 'Add keywords' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'old keyword{Enter}seo agency');
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 keywords' }));
    const result = await screen.findByRole('dialog', { name: 'Keywords added' });
    expect(
      within(result).getByText('1 of them was deleted before and is back with its old settings and history.'),
    ).toBeInTheDocument();
  }, 15_000);

  it('says by how much an add goes over the plan’s keyword limit', async () => {
    server.use(
      http.post(mswPath(BULK_CREATE), ({ request }) =>
        problem(request, 'quota_exceeded', { limit: 2000, used: 1920, requested: 120 }),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'rank tracker api');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(
      await within(dialog).findByText(
        'Your plan has room for 80 more active keywords (1,920 of 2,000 used); this adds 120.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the keywords tracked already, and unarchives an archived one', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openDialog(user);
    // In the project's country (Germany, English, desktop) "seo meme" is archived and "keyword research" active
    expect(within(chosenCountries(dialog)).getByText('Germany')).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Keywords' }),
      'seo meme{Enter}keyword research{Enter}rank api',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add 3 keywords' }));
    const result = await screen.findByRole('dialog', { name: 'Keywords added' });
    expect(within(result).getByText('1 keyword was added.')).toBeInTheDocument();
    expect(await within(result).findByText('seo meme (Germany) · Desktop')).toBeInTheDocument();
    expect(within(result).getByText('Archived')).toBeInTheDocument();
    await user.click(within(result).getByRole('button', { name: 'Unarchive: seo meme (Germany) · Desktop' }));
    expect(await within(result).findByText('Unarchived')).toBeInTheDocument();
    // The button that worked is gone; its row's "Show it" holds the focus
    expect(within(result).getByRole('button', { name: 'Show it: seo meme (Germany) · Desktop' })).toHaveFocus();
    await user.click(within(result).getByRole('button', { name: 'Show it: keyword research (Germany) · Desktop' }));
    expect(
      await screen.findByRole('complementary', { name: 'keyword research' }, { timeout: 3000 }),
    ).toBeInTheDocument();
  }, 15_000);

  it('opens an archived keyword tracked already in the archived view, and says when unarchiving finds no room', async () => {
    server.use(
      http.patch(mswPath(DETAIL), ({ request }) =>
        problem(request, 'quota_exceeded', { limit: 60, used: 60, requested: 1 }),
      ),
    );
    const url = urlWrites();
    const { user } = renderWithProviders(as('editor'), { onUrlUpdate: url.onUrlUpdate });
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'seo meme');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    const result = await screen.findByRole('dialog', { name: 'No keywords added' });
    await user.click(await within(result).findByRole('button', { name: 'Unarchive: seo meme (Germany) · Desktop' }));
    expect(
      await within(result).findByText('Your plan has no room for another active keyword (60 of 60 used); this adds 1.'),
    ).toBeInTheDocument();
    await user.click(within(result).getByRole('button', { name: 'Show it: seo meme (Germany) · Desktop' }));
    await waitFor(() => expect(url.latest().get('archived')).toBe('true'));
    expect(url.latest().get('inspect')).toMatch(/^keyword:/);
  }, 15_000);

  it('names the line of a keyword the API refuses, and counts too long a list', async () => {
    server.use(
      http.post(mswPath(BULK_CREATE), ({ request }) =>
        invalid(request, [
          { location: 'body', path: 'items.1.keyword', code: 'keyword_too_long', message: 'Too long.' },
        ]),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openDialog(user);
    const keywords = within(dialog).getByRole('textbox', { name: 'Keywords' });
    await user.type(keywords, 'first{Enter}{Enter}second');
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 keywords' }));
    // The second keyword is on line 3, after a blank line
    expect(await within(dialog).findByText('Line 3: use at most 700 characters')).toBeInTheDocument();
    await user.clear(keywords);
    await user.click(keywords);
    await user.paste(Array.from({ length: 1001 }, (_, index) => `keyword ${String(index)}`).join('\n'));
    await user.click(within(dialog).getByRole('button', { name: 'Add 1,001 keywords' }));
    expect(
      await within(dialog).findByText('Add at most 1,000 keywords at a time. This list has 1,001.'),
    ).toBeInTheDocument();
  }, 15_000);

  it('starts on the project’s default device, and starts over when opened again', async () => {
    server.use(
      http.get(mswPath(SETTINGS), () =>
        HttpResponse.json({
          data: {
            version: 1,
            entity_config_version: 1,
            seo: {
              default_device: 'both',
              default_depth_profile: 'standard',
              default_frequency: 'daily',
              visibility_volume_mode: 'annual_average',
              visibility_weight_scheme: 'uniform',
            },
          },
        }),
      ),
    );
    const { user } = renderWithProviders(as('editor'));
    let dialog = await openDialog(user);
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Desktop and mobile' })).toBeChecked());
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'rank api');
    await user.click(within(dialog).getByRole('radio', { name: 'Mobile' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add keywords' })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Add keywords' }));
    dialog = await screen.findByRole('dialog', { name: 'Add keywords' });
    expect(within(dialog).getByRole('textbox', { name: 'Keywords' })).toHaveValue('');
    expect(within(dialog).getByRole('radio', { name: 'Desktop and mobile' })).toBeChecked();
  }, 15_000);

  it('asks for a country when none is chosen', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openWithCountry(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'rank api');
    await user.click(within(dialog).getByRole('button', { name: 'Remove Germany' }));
    expect(
      within(dialog).getByText('Each keyword is checked once a day in every country and on every device chosen.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 keyword' }));
    expect(await within(dialog).findByText('Choose at least one country')).toBeInTheDocument();
  });

  it('is offered where the project tracks nothing yet, and not to a viewer', async () => {
    const { unmount } = renderWithProviders(as('editor', cleanstart.project_id));
    const empty = await screen.findByRole('heading', { name: 'No keywords tracked yet' });
    const state = empty.parentElement?.parentElement ?? document.body;
    expect(within(state).getByRole('button', { name: 'Add keywords' })).toBeInTheDocument();
    unmount();
    renderWithProviders(as('viewer'));
    await loadedGrid();
    expect(screen.queryByRole('button', { name: 'Add keywords' })).toBeNull();
  });
});

describe('Add keywords in several countries', () => {
  it('counts the checks a day and sends each keyword once per country', async () => {
    const { requests } = captureBulkCreate();
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openWithCountry(user);
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Keywords' }),
      'rank api{Enter}seo audit{Enter}serp api',
    );
    await user.click(within(dialog).getByRole('radio', { name: 'Desktop' }));
    await pickCountry(user, dialog, 'Uni', 'United States');
    expect(within(chosenCountries(dialog)).getByText('United States')).toBeInTheDocument();
    expect(within(dialog).getByText('3 keywords × 1 device × 2 countries = 6 checks a day')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add 3 keywords' }));
    expect(await screen.findByText('6 tracked keywords added')).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    const sent = requests[0] ?? [];
    expect(sent).toHaveLength(6);
    expect(sent.filter((item) => item.location_id === 2276).map((item) => item.keyword)).toEqual([
      'rank api',
      'seo audit',
      'serp api',
    ]);
    expect(sent.filter((item) => item.location_id === 2840)).toHaveLength(3);
  }, 15_000);

  it('gives the cost of the checks, and leaves it out when the price book cannot be read', async () => {
    const first = renderWithProviders(as('editor'));
    let dialog = await openWithCountry(first.user);
    await first.user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'rank api{Enter}seo audit');
    await first.user.click(within(dialog).getByRole('radio', { name: 'Desktop and mobile' }));
    // 4 checks at $0.0066
    expect(await within(dialog).findByText('Up to $0.03 a day, $0.79 a month')).toBeInTheDocument();
    first.unmount();

    server.use(http.get(mswPath(PRICE_BOOK), () => HttpResponse.json({ title: 'Forbidden' }, { status: 403 })));
    const { user } = renderWithProviders(as('editor'));
    dialog = await openWithCountry(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'rank api');
    expect(await within(dialog).findByText(/^Plan: /)).toBeInTheDocument();
    expect(within(dialog).queryByText(/^Up to /)).toBeNull();
  }, 15_000);

  it('shows the plan use before and after, and refuses an add over the plan', async () => {
    server.use(http.get(mswPath(QUOTA), () => HttpResponse.json({ data: { limit: 5, used: 3 } })));
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openWithCountry(user);
    const keywords = within(dialog).getByRole('textbox', { name: 'Keywords' });
    await user.type(keywords, 'rank api');
    await user.click(within(dialog).getByRole('radio', { name: 'Desktop' }));
    expect(await within(dialog).findByText('Plan: 3 of 5 tracked keywords used, 4 after this add')).toBeInTheDocument();
    await user.type(keywords, '{Enter}seo audit{Enter}serp api');
    await pickCountry(user, dialog, 'Uni', 'United States');
    expect(within(dialog).getByText('Plan: 3 of 5 tracked keywords used, 9 after this add')).toBeInTheDocument();
    expect(within(dialog).getByText('Over the plan by 4 tracked keywords')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add 3 keywords' })).toHaveAttribute('aria-disabled', 'true');
  }, 15_000);

  it('takes ten countries at most', async () => {
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openWithCountry(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Keywords' }), 'rank api');
    for (const name of [
      'United States',
      'United Kingdom',
      'India',
      'France',
      'Canada',
      'Australia',
      'Spain',
      'Italy',
      'Netherlands',
      'Brazil',
    ]) {
      await pickCountry(user, dialog, name, name);
    }
    await user.tab();
    expect(await within(dialog).findByText('Choose at most 10 countries in one add')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add 1 keyword' })).toHaveAttribute('aria-disabled', 'true');
  }, 30_000);

  it('sends a long list in parts that fit one request each', async () => {
    const { requests } = captureBulkCreate();
    server.use(http.get(mswPath(QUOTA), () => HttpResponse.json({ data: { limit: 50_000, used: 0 } })));
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openWithCountry(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Keywords' }));
    await user.paste(Array.from({ length: 250 }, (_, index) => `keyword ${String(index)}`).join('\n'));
    await user.click(within(dialog).getByRole('radio', { name: 'Desktop' }));
    for (const name of [
      'United States',
      'United Kingdom',
      'India',
      'France',
      'Canada',
      'Australia',
      'Spain',
      'Italy',
      'Netherlands',
    ]) {
      await pickCountry(user, dialog, name, name);
    }
    await user.click(within(dialog).getByRole('button', { name: 'Add 250 keywords' }));
    expect(await screen.findByText('2,500 tracked keywords added')).toBeInTheDocument();
    expect(requests.map((items) => items.length)).toEqual([1000, 1000, 500]);
  }, 60_000);

  it('keeps what earlier parts added when a later one finds no room in the plan', async () => {
    let calls = 0;
    server.use(
      http.get(mswPath(QUOTA), () => HttpResponse.json({ data: { limit: 50_000, used: 0 } })),
      http.post(mswPath(BULK_CREATE), async ({ request }) => {
        calls += 1;
        const { items } = BULK_BODY.parse(await request.json());
        if (calls > 1) return problem(request, 'quota_exceeded', { limit: 1500, used: 1000, requested: 1000 });
        return HttpResponse.json({
          data: {
            created: items.map((_, index) => `created-${String(index)}`),
            restored: [],
            skipped: [],
            rejected: [],
          },
        });
      }),
    );
    const { user } = renderWithProviders(as('editor'));
    const dialog = await openWithCountry(user);
    await user.click(within(dialog).getByRole('textbox', { name: 'Keywords' }));
    await user.paste(Array.from({ length: 1000 }, (_, index) => `keyword ${String(index)}`).join('\n'));
    await user.click(within(dialog).getByRole('radio', { name: 'Desktop' }));
    await pickCountry(user, dialog, 'Uni', 'United States');
    await user.click(within(dialog).getByRole('button', { name: 'Add 1,000 keywords' }));
    const result = await screen.findByRole('dialog', { name: 'Keywords added' });
    expect(within(result).getByText('1,000 tracked keywords were added.')).toBeInTheDocument();
    expect(
      within(result).getByText(
        'Your plan has room for 500 more active keywords (1,000 of 1,500 used); this adds 1,000.',
      ),
    ).toBeInTheDocument();
  }, 30_000);
});
