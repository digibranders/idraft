import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { overviewAs } from '@/test/ai-overview-harness';
import { MOCK_ENTITY_IDS } from '@/mocks/entity-fixtures';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const TIMEOUT = { timeout: 8000 };

/** The Overview of the Fynix fixture with the drawer closed; `urls` collects every address the page writes. */
function render(searchParams = 'cmp=off'): { urls: URLSearchParams[]; user: UserEvent } {
  const urls: URLSearchParams[] = [];
  const { user } = renderWithProviders(overviewAs('admin'), {
    searchParams,
    onUrlUpdate: ({ searchParams: params }) => urls.push(new URLSearchParams(params)),
  });
  return { urls, user };
}

const openFromBars = async (user: UserEvent, name: string): Promise<HTMLElement> => {
  const [button] = await screen.findAllByRole('button', { name: `Open ${name}` }, TIMEOUT);
  if (button === undefined) throw new Error(`No button opens ${name}`);
  await user.click(button);
  return button;
};

const drawer = async (name: string): Promise<HTMLElement> =>
  within(await screen.findByRole('complementary', { name }, TIMEOUT))
    .getByRole('tablist')
    .closest('aside') as HTMLElement;

describe('opening the competitor drawer', () => {
  it('opens from a competitor name, writes inspect=competitor:<id> and names the scope in the header', async () => {
    const { urls, user } = render();
    await openFromBars(user, 'Brightwave Digital');
    const aside = await drawer('Brightwave Digital');
    expect(within(aside).getByRole('tablist', { name: 'Competitor details' })).toBeInTheDocument();
    // Each tab reserves the width of its heavier label, so the names are asked, not the text
    for (const name of ['Overview', 'Prompts', 'Cited domains']) {
      expect(within(aside).getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(within(aside).getAllByRole('tab')).toHaveLength(3);
    expect(within(aside).getByText('All platforms')).toBeInTheDocument();
    expect(within(aside).getByText('All groups')).toBeInTheDocument();
    expect(within(aside).getByText(/tracked in AI answers/)).toBeInTheDocument();
    expect(within(aside).getByText(/^\d+ of \d+$/)).toBeInTheDocument();
    const last = urls.at(-1);
    expect(last?.get('inspect')).toMatch(/^competitor:[0-9a-f-]{36}$/);
    // The Overview tab is the default one, so no tab is written
    expect(last?.get('itab')).toBeNull();
  });

  it('shows you against the competitor on every measure, with n/a where a value is not there', async () => {
    const { user } = render();
    await openFromBars(user, 'Brightwave Digital');
    const aside = await drawer('Brightwave Digital');
    const table = await within(aside).findByRole('table', { name: 'You against Brightwave Digital' }, TIMEOUT);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    ['Mention rate', 'Share of voice', 'Citation share'].forEach((label, index) => {
      expect(within(rows[index + 1] as HTMLElement).getByRole('rowheader')).toHaveTextContent(new RegExp(`^${label}`));
    });
    const mention = within(rows[1] as HTMLElement).getAllByRole('cell');
    expect(mention[0]?.textContent).toMatch(/^\d+%/);
    expect(mention[1]?.textContent).toMatch(/^\d+%/);
    // The gap is an icon whose words say it is not tested for detectability
    expect(within(mention[2] as HTMLElement).getAllByText(/Not tested for detectability/).length).toBeGreaterThan(0);
  });

  it('gives the focus back to the name that opened it when it closes', async () => {
    const { user } = render();
    const opener = await openFromBars(user, 'Brightwave Digital');
    await drawer('Brightwave Digital');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('opens from a link and closes with Escape, which takes the inspect key out of the address', async () => {
    const { urls, user } = render(`cmp=off&inspect=competitor:${MOCK_ENTITY_IDS.brightwave}`);
    const aside = await drawer('Brightwave Digital');
    within(aside).getByRole('heading', { name: 'Brightwave Digital' }).focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Brightwave Digital' })).toBeNull());
    expect(urls.at(-1)?.get('inspect')).toBeNull();
  });

  it('steps through the competitors with J and K and the buttons, and wraps around', async () => {
    const { user } = render();
    await openFromBars(user, 'Brightwave Digital');
    const aside = await drawer('Brightwave Digital');
    const position = (): string => within(aside).getByText(/^\d+ of \d+$/).textContent;
    const [, total] = position().split(' of ');
    expect(position()).toBe(`1 of ${total}`);
    // J and K work from inside the drawer
    within(aside).getByRole('heading', { name: 'Brightwave Digital' }).focus();
    await user.keyboard('j');
    await waitFor(() => expect(position()).toBe(`2 of ${total}`));
    await user.keyboard('k');
    await waitFor(() => expect(position()).toBe(`1 of ${total}`));
    await user.keyboard('k');
    await waitFor(() => expect(position()).toBe(`${total} of ${total}`));
    await user.click(within(aside).getByRole('button', { name: 'Next competitor' }));
    await waitFor(() => expect(position()).toBe(`1 of ${total}`));
  });

  it('says so for a competitor that is not tracked', async () => {
    render('cmp=off&inspect=competitor:00000000-0000-4000-8000-00000000dead');
    expect(await screen.findByText('Could not open this competitor', undefined, TIMEOUT)).toBeInTheDocument();
    expect(screen.getByText('This competitor does not exist or you do not have access to it.')).toBeInTheDocument();
  });
});

describe('a drawer opened from a link while the summary cannot be read', () => {
  it('says the competitor could not be loaded and offers a retry, instead of "not found"', async () => {
    server.use(
      http.get('*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error' },
          { status: 500 },
        ),
      ),
    );
    render(`cmp=off&inspect=competitor:${MOCK_ENTITY_IDS.brightwave}`);
    expect(await screen.findByText('Could not load this competitor', undefined, TIMEOUT)).toBeInTheDocument();
    expect(screen.queryByText('Could not open this competitor')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
  });
});

describe('the Prompts tab', () => {
  it('lists the prompts of the lead being read, each a link that opens the prompt inspector, and switches the lead', async () => {
    const { user } = render();
    await openFromBars(user, 'Brightwave Digital');
    const aside = await drawer('Brightwave Digital');
    await user.click(within(aside).getByRole('tab', { name: 'Prompts' }));
    const lead = within(aside).getByRole('radiogroup', { name: 'Who leads' });
    expect(
      within(lead)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('aria-label') ?? radio.textContent),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/They lead/),
        expect.stringMatching(/You lead/),
        expect.stringMatching(/Equal/),
      ]),
    );
    expect(
      await within(aside).findByRole('heading', { name: 'Prompts where Brightwave Digital leads' }, TIMEOUT),
    ).toBeInTheDocument();
    await user.click(within(lead).getByRole('radio', { name: /You lead/ }));
    const list = await within(aside).findByRole('heading', { name: 'Prompts where you lead' }, TIMEOUT);
    const links = within(list.closest('section') as HTMLElement).getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(10);
    for (const link of links)
      expect(link.getAttribute('href')).toMatch(/\/ai\/prompts\?.*inspect=prompt%3A[0-9a-f-]{36}/);
  });

  it('opens on the prompts of a count of the competitor gap card, with that lead chosen', async () => {
    const { user, urls } = render();
    const [button] = await screen.findAllByRole('button', { name: /^Prompts where you lead: \d+ of \d+$/ }, TIMEOUT);
    if (button === undefined) throw new Error('The gap card has no count');
    await user.click(button);
    const aside = await screen.findByRole('complementary', undefined, TIMEOUT);
    expect(within(aside).getByRole('tab', { name: 'Prompts', selected: true })).toBeInTheDocument();
    expect(within(aside).getByRole('radio', { name: /You lead/, checked: true })).toBeInTheDocument();
    expect(urls.at(-1)?.get('itab')).toBe('prompts');
  });
});

describe('the scope of the page', () => {
  it('names the platform of the page in the badges and reads the drawer over it', async () => {
    render(`cmp=off&engine=chatgpt_web&inspect=competitor:${MOCK_ENTITY_IDS.brightwave}`);
    const aside = await drawer('Brightwave Digital');
    expect(within(aside).getByText('ChatGPT')).toBeInTheDocument();
    // One platform is its own figures: the count behind a mention rate is named in the cell
    const table = await within(aside).findByRole('table', { name: 'You against Brightwave Digital' }, TIMEOUT);
    expect(within(table).getAllByText(/^\d+ of \d+ answers$/).length).toBeGreaterThan(0);
  });
});

describe('the Cited domains tab', () => {
  it('says nothing is cited when the answers cite no page', async () => {
    server.use(
      http.get('*/api/v1/workspaces/:w/projects/:p/ai/sources/overlap', () =>
        HttpResponse.json({ data: { theirs: [], yours: [] } }),
      ),
    );
    const { user } = render(`cmp=off&inspect=competitor:${MOCK_ENTITY_IDS.brightwave}&itab=sources`);
    expect(await screen.findByText('No citations in this scope', undefined, TIMEOUT)).toBeInTheDocument();
    expect(screen.getByText(/nothing to compare/)).toBeInTheDocument();
    expect(user).toBeDefined();
  });

  it('says Not collected yet in production, where the read does not exist, and asks nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_MOCKING', 'off');
    const asked: string[] = [];
    const listener = ({ request }: { request: Request }): void => {
      asked.push(new URL(request.url).pathname);
    };
    server.events.on('request:start', listener);
    render(`cmp=off&inspect=competitor:${MOCK_ENTITY_IDS.brightwave}&itab=sources`);
    const aside = await drawer('Brightwave Digital');
    expect(await within(aside).findByRole('heading', { name: 'Not collected yet' }, TIMEOUT)).toBeInTheDocument();
    expect(within(aside).getByText(/is not collected yet/)).toBeInTheDocument();
    expect(asked.filter((path) => path.endsWith('/sources/overlap'))).toEqual([]);
    server.events.removeListener('request:start', listener);
  });

  it('compares the domains cited when each of you is mentioned, from the sample read of the mock', async () => {
    const { user } = render();
    await openFromBars(user, 'Brightwave Digital');
    const aside = await drawer('Brightwave Digital');
    await user.click(within(aside).getByRole('tab', { name: 'Cited domains' }));
    expect(
      await within(aside).findByRole('heading', { name: 'Where they are cited and you are not' }, TIMEOUT),
    ).toBeInTheDocument();
    expect(within(aside).getByText(/of their domains \(Jaccard overlap\)\.$/)).toBeInTheDocument();
    expect(within(aside).getByRole('heading', { name: 'When Brightwave Digital is mentioned' })).toBeInTheDocument();
    expect(within(aside).getByRole('heading', { name: 'When you are mentioned' })).toBeInTheDocument();
    expect(within(aside).getAllByRole('table')).toHaveLength(2);
  });
});
