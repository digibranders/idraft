import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { parseAsString, useQueryStates } from 'nuqs';
import { Suspense, useEffect, type ComponentProps, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { Role } from '@/lib/api/types';
import { topicRow } from './topics-by-engine/cells-fixtures';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_TERM_IDS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender, type ProvidedRenderOptions } from '@/test/render';
// The harness also answers the entities and the tracked keywords with none
import { summaryOf } from '@/test/topic-drawer-harness';

/*
 * The topic drawer as the Topics tab mounts it (WP-20 task 7): the header, the Overview sections, the four tabs, the
 * engine drill-down and the two actions, each through the real screen. The parts are tested on their own beside their
 * files; this file proves they are wired to the screen.
 */

// jsdom has no canvas: the drawer's charts are drawn as an empty box, and their words are what the tests read
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
const address = vi.hoisted(() => ({ search: '', follow: undefined as ((href: string) => void) | undefined }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(address.search),
}));
// The router's link moves nothing in jsdom: the stand-in hands the address to the test's follower
vi.mock('next/link', () => ({
  default: ({ href, replace, children, onClick, ...props }: ComponentProps<'a'> & { replace?: boolean }) => (
    <a
      href={String(href)}
      data-replace={replace === true ? 'true' : 'false'}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
        address.follow?.(String(href));
      }}
      {...props}
    >
      {children}
    </a>
  ),
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
  server.events.removeAllListeners();
});

/** Follows a link of the drawer the way the app's router does: the keys of the address it names are written. */
function Follower(): null {
  const [, set] = useQueryStates({ inspect: parseAsString, itab: parseAsString, eng: parseAsString });
  useEffect(() => {
    address.follow = (href) => {
      const params = new URL(href, 'http://localhost').searchParams;
      void set({ inspect: params.get('inspect'), itab: params.get('itab'), eng: params.get('eng') });
    };
    return () => {
      address.follow = undefined;
    };
  }, [set]);
  return null;
}

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
        <Follower />
      </Suspense>
    </PermissionProvider>
  );
}

const renderOn = (role: Role, searchParams: string, options: ProvidedRenderOptions = {}): ProvidedRender => {
  address.search = searchParams;
  return renderWithProviders(promptsAs(role), { ...options, searchParams });
};
const inspect = (id: string, tab?: string, extra = ''): string =>
  `?inspect=${encodeURIComponent(`topic:${id}`)}${tab === undefined ? '' : `&itab=${tab}`}${extra}`;
const drawer = (name: string): Promise<HTMLElement> => screen.findByRole('complementary', { name });
const PAID_SEARCH = MOCK_TERM_IDS.paidSearch;

describe('the topic drawer: the header', () => {
  it('shows the prompt count, the scope and the freshness as badges, and Add prompt and Run now to an editor', async () => {
    renderOn('editor', inspect(PAID_SEARCH));
    const panel = await drawer('Paid Search');
    expect(await within(panel).findByText('2 prompts')).toBeInTheDocument();
    expect(within(panel).getByRole('group', { name: 'Scope of the counts: 2 engines and Non-branded' })).toBeVisible();
    expect(await within(panel).findByRole('button', { name: 'Add prompt' })).toBeInTheDocument();
    expect(await within(panel).findByRole('button', { name: 'Run now' })).toBeInTheDocument();
  });

  it('gives a viewer neither Add prompt nor Run now, once the engines and the summary are in', async () => {
    renderOn('viewer', inspect(PAID_SEARCH));
    const panel = await drawer('Paid Search');
    expect(await within(panel).findByText('2 prompts')).toBeInTheDocument();
    // The engines are what Add prompt waits for: with them in, the absence is the role's and not the load's
    expect(await within(panel).findByRole('link', { name: /^ChatGPT/ })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Add prompt' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Run now' })).toBeNull();
  });

  it('says where the topic is in the Topics tab and steps with J and K', async () => {
    const { user } = renderOn('viewer', inspect(MOCK_TERM_IDS.seo));
    const panel = await drawer('SEO');
    // The order is the one the table drew, which the drawer reads from the store the Topics tab fills
    const place = await within(panel).findByText(/^\d+ of \d+$/);
    const [, at = '', total = ''] = /^(\d+) of (\d+)$/.exec(place.textContent ?? '') ?? [];
    expect(Number(at)).toBeGreaterThan(1);
    expect(Number(at)).toBeLessThan(Number(total));
    await user.keyboard('j');
    await waitFor(() =>
      expect(
        within(screen.getByRole('complementary')).getByText(`${String(Number(at) + 1)} of ${total}`),
      ).toBeVisible(),
    );
    expect(screen.queryByRole('complementary', { name: 'SEO' })).toBeNull();
    await user.keyboard('k');
    await drawer('SEO');
    expect(within(screen.getByRole('complementary')).getByText(`${at} of ${total}`)).toBeVisible();
  });
});

describe('the topic drawer: the Overview', () => {
  it('shows the engine panel, the trend by engine, the trend against competitors and In search', async () => {
    renderOn('viewer', inspect(PAID_SEARCH));
    const panel = await drawer('Paid Search');
    for (const name of ['By engine', 'Trend by engine', 'Visibility trend against competitors', 'In search']) {
      expect(await within(panel).findByRole('heading', { name })).toBeInTheDocument();
    }
    // The old per-engine cards are gone: the panel is the one By engine section
    expect(within(panel).getAllByRole('heading', { name: 'By engine' })).toHaveLength(1);
  });
});

describe('the topic drawer: the tabs', () => {
  it('has Overview, Prompts, Competitors and Related, reached with the arrow keys', async () => {
    const { user } = renderOn('viewer', inspect(MOCK_TERM_IDS.seo));
    const panel = await drawer('SEO');
    const tabs = within(panel).getAllByRole('tab');
    const place = (name: string): number => tabs.indexOf(within(panel).getByRole('tab', { name }));
    expect(['Overview', 'Prompts', 'Competitors', 'Related'].map(place)).toEqual([0, 1, 2, 3]);
    tabs[0]?.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(within(panel).getByRole('tab', { name: 'Competitors' })).toHaveAttribute('aria-selected', 'true');
    expect(await within(panel).findByRole('heading', { name: 'Competitors by engine' })).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(within(panel).getByRole('tab', { name: 'Related' })).toHaveAttribute('aria-selected', 'true');
    expect(await within(panel).findByRole('heading', { name: 'Topics beside this one' })).toBeInTheDocument();
  });
});

describe('the topic drawer: an engine row leads to that engine', () => {
  it('lists the prompts answered on the engine with its chip from the engine row, and Close takes ?eng away', async () => {
    const writes: string[] = [];
    const { user } = renderOn('viewer', inspect(MOCK_TERM_IDS.seo), {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const panel = await drawer('SEO');
    await user.click(await within(panel).findByRole('link', { name: /^ChatGPT/ }));
    await waitFor(() => expect(new URLSearchParams(writes.at(-1)).get('eng')).toBe('chatgpt_web'));
    expect(await within(panel).findByRole('tab', { name: 'Prompts', selected: true })).toBeInTheDocument();
    expect(await within(panel).findByText('Engine: ChatGPT')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'SEO' })).toBeNull());
    const last = new URLSearchParams(writes.at(-1));
    expect(last.has('eng')).toBe(false);
    expect(last.has('inspect')).toBe(false);
  });
});

describe('the topic drawer: Add prompt and Run now', () => {
  it('opens the add dialog with the topic chosen', async () => {
    const { user } = renderOn('editor', inspect(PAID_SEARCH));
    const panel = await drawer('Paid Search');
    await user.click(await within(panel).findByRole('button', { name: 'Add prompt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add prompts' });
    expect(within(dialog).getByRole('combobox', { name: /Topic/ })).toHaveTextContent('Paid Search');
  });

  it('asks first and starts the prompts of the topic', async () => {
    const bodies: { prompt_ids: string[] }[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/ai/runs')) {
        bodies.push((await request.clone().json()) as (typeof bodies)[number]);
      }
    });
    const { user } = renderOn('editor', inspect(PAID_SEARCH));
    const panel = await drawer('Paid Search');
    const run = await within(panel).findByRole('button', { name: 'Run now' });
    // The prompts are read from the list: the button waits for it
    await waitFor(() => expect(run).not.toHaveAttribute('aria-disabled', 'true'));
    await user.click(run);
    await user.click(await screen.findByRole('button', { name: 'Run 2 prompts' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]?.prompt_ids).toHaveLength(2);
  });

  it('disables Run now with its reason for a topic that holds no prompt', async () => {
    server.use(
      http.get(SUMMARY_PATH, () => HttpResponse.json({ data: summaryOf([topicRow(PAID_SEARCH, 'Paid Search', 0)]) })),
    );
    const { user } = renderOn('editor', inspect(PAID_SEARCH));
    const panel = await drawer('Paid Search');
    const run = await within(panel).findByRole('button', { name: 'Run now' });
    // First the list is read, then the topic is known to hold nothing
    await waitFor(() => expect(run).toHaveAttribute('aria-disabled', 'true'));
    await user.hover(run);
    expect((await screen.findAllByText('This topic holds no prompt to run.')).length).toBeGreaterThan(0);
  });
});

describe('the topic drawer: topics without a row, and a topic without a topic', () => {
  it('says an unknown topic could not be loaded and offers no action', async () => {
    renderOn('editor', inspect('99999999-0000-4000-8000-000000000001'));
    const panel = await screen.findByRole('complementary');
    expect(
      await within(panel).findByText('This topic does not exist or you do not have access to it.'),
    ).toBeInTheDocument();
    // The engines are in, so the absence is the topic's and not the load's
    await waitFor(() => expect(within(panel).queryByRole('button', { name: 'Add prompt' })).toBeNull());
    expect(within(panel).queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(within(panel).queryByRole('tab')).toBeNull();
  });

  it('opens No topic without Add prompt or In search, and says its competitors are read per topic', async () => {
    server.use(http.get(SUMMARY_PATH, () => HttpResponse.json({ data: summaryOf([topicRow(null, null, 3)]) })));
    renderOn('editor', inspect('__none'));
    const panel = await drawer('No topic');
    expect(await within(panel).findByText('3 prompts')).toBeInTheDocument();
    expect(await within(panel).findByRole('button', { name: 'Run now' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Add prompt' })).toBeNull();
    expect(
      await within(panel).findByRole('heading', { name: 'Visibility trend against competitors' }),
    ).toBeInTheDocument();
    expect(await within(panel).findByText('Read per topic')).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { name: 'In search' })).toBeNull();
  });

  it('keeps the drawer content while the summary is read again', async () => {
    const { user, queryClient } = renderOn('viewer', inspect(PAID_SEARCH));
    const panel = await drawer('Paid Search');
    expect(await within(panel).findByRole('link', { name: /^ChatGPT/ })).toBeInTheDocument();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(SUMMARY_PATH, async () => {
        await gate;
        return undefined;
      }),
    );
    void queryClient.invalidateQueries();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Nothing of the drawer goes while the new answer is on its way
    expect(within(panel).getByRole('heading', { name: 'Rates' })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /^ChatGPT/ })).toBeInTheDocument();
    expect(within(panel).getByText('2 prompts')).toBeInTheDocument();
    release();
    await user.click(await within(panel).findByRole('tab', { name: 'Prompts' }));
    // The Rates panel goes when the Prompts tab opens: wait for it, so the count is the Prompts list's alone
    await waitFor(() => expect(within(panel).getAllByRole('listitem')).toHaveLength(2));
  });
});

describe('the topic drawer: Close', () => {
  it('goes back to the page the drawer was opened from, also after a prompt was opened from the drawer', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { user } = renderOn('viewer', '');
    const tree = await screen.findByRole('treegrid', { name: 'Topics' });
    await user.click(await within(tree).findByRole('button', { name: 'Open the topic Paid Search' }));
    const panel = await drawer('Paid Search');
    const top = (await within(panel).findByRole('heading', { name: 'Top prompts' })).closest('section');
    if (top === null) throw new Error('The Top prompts card is missing');
    const [first] = await within(top).findAllByRole('listitem');
    await user.click(within(first ?? top).getByRole('button'));
    const prompt = await screen.findByRole('complementary', { name: /\?$/ });
    await user.click(within(prompt).getByRole('button', { name: 'Close' }));
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });
});

describe('the built rows of the topic drawer, confirmed through the real screen', () => {
  it('WB-TI-01 shows the topic name, the type Topic, the prompt count as a badge, and Close takes the drawer away', async () => {
    const { user } = renderOn('viewer', inspect(PAID_SEARCH));
    const panel = await drawer('Paid Search');
    expect(within(panel).getByRole('heading', { level: 2, name: 'Paid Search' })).toBeInTheDocument();
    expect(within(panel).getByText('Topic')).toBeInTheDocument();
    expect(await within(panel).findByText('2 prompts')).toBeInTheDocument();
    // The Back button is the sheet's (a phone); a docked drawer leaves with Close, the same way out
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Paid Search' })).toBeNull());
  });

  it('WB-TI-15 lists the 5 top prompts of a topic with more, and Show all opens the Prompts tab with every one', async () => {
    const { user } = renderOn('viewer', inspect(MOCK_TERM_IDS.seo));
    const panel = await drawer('SEO');
    const top = (await within(panel).findByRole('heading', { name: 'Top prompts' })).closest('section');
    if (top === null) throw new Error('The Top prompts card is missing');
    expect(await within(top).findAllByRole('listitem')).toHaveLength(5);
    await user.click(within(top).getByRole('button', { name: 'Show all 12 prompts' }));
    expect(await within(panel).findByRole('tab', { name: 'Prompts', selected: true })).toBeInTheDocument();
    expect(await within(panel).findAllByRole('listitem')).toHaveLength(12);
  });

  it('WB-TI-21 says a topic with no prompt has none to list', async () => {
    server.use(
      http.get(SUMMARY_PATH, () => HttpResponse.json({ data: summaryOf([topicRow(PAID_SEARCH, 'Paid Search', 0)]) })),
    );
    renderOn('viewer', inspect(PAID_SEARCH));
    const panel = await drawer('Paid Search');
    expect((await within(panel).findAllByText('No prompts to list')).length).toBeGreaterThan(0);
  });

  it('WB-TI-21 says the prompts of a topic the tree does not hold are not known, and a failed read has Try again', async () => {
    const ghost = '33333333-0000-4000-8000-0000000000aa';
    server.use(
      http.get(SUMMARY_PATH, () => HttpResponse.json({ data: summaryOf([topicRow(ghost, 'Ghost topic', 3)]) })),
    );
    const { unmount } = renderOn('viewer', inspect(ghost));
    const panel = await drawer('Ghost topic');
    expect((await within(panel).findAllByText('The prompts of this topic are not known yet')).length).toBeGreaterThan(
      0,
    );
    unmount();

    server.use(
      http.get(SUMMARY_PATH, () =>
        HttpResponse.json({ status: 500, code: 'internal_error', title: 'Failed' }, { status: 500 }),
      ),
    );
    renderOn('viewer', inspect(PAID_SEARCH));
    const failed = await screen.findByRole('complementary');
    expect((await within(failed).findAllByText('The topics could not be loaded.')).length).toBeGreaterThan(0);
    expect(within(failed).getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
  });

  it('WB-TPE-18 says "avg of 2" on the drawer rate card and in the average column of the By engine view', async () => {
    const { unmount } = renderOn('viewer', inspect(PAID_SEARCH));
    const panel = await drawer('Paid Search');
    const rates = (await within(panel).findByRole('heading', { name: 'Rates' })).closest('section');
    if (rates === null) throw new Error('The Rates card is missing');
    expect((await within(rates).findAllByText('avg of 2')).length).toBeGreaterThan(0);
    unmount();

    renderOn('viewer', '?view=engines');
    const table = await screen.findByRole('treegrid', { name: 'Topics' });
    expect((await within(table).findAllByText(/avg of 2/)).length).toBeGreaterThan(0);
  });
});
