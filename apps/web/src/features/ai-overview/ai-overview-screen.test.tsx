import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_REGION_ID } from '@/lib/a11y/announcer';
import { cardName, SCREENS } from '@/lib/layouts';
import { handlers } from '@/mocks/handlers';
import { mswPath } from '@/mocks/respond';
import { CARD_ID, cardInOverview, overviewAs } from '@/test/ai-overview-harness';
import { serveLayouts, stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';
import { ACTIVITY_CARDS } from './cards/activity';
import { COMPETITOR_CARDS } from './cards/competitors';
import { ENGINE_CARDS } from './cards/engines';
import { SOURCE_CARDS } from './cards/sources';
import { TOPIC_CARDS } from './cards/topics';
import { useOverview } from './overview-context';
import { buildOverviewPresets, EXECUTIVE_LAYOUT } from './presets/presets';
import type { ReactElement } from 'react';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
// Real zrender cannot draw in jsdom ("ctx.save is not a function"), which would turn every built chart card into its error
// state; the tests of this page are about the screen, and each card tests its chart itself
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

const NOW = new Date('2026-11-12T12:00:00Z');
const ENGINES = mswPath('/api/v1/workspaces/:w/projects/:p/engines');
const CARDS = 'AI visibility cards';
/** The family maps of the page: a type listed in one is no longer a pending card. */
const FAMILIES: readonly Readonly<Record<string, unknown>>[] = [
  ENGINE_CARDS,
  COMPETITOR_CARDS,
  TOPIC_CARDS,
  SOURCE_CARDS,
  ACTIVITY_CARDS,
];

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const customize = (): HTMLElement => screen.getByRole('button', { name: 'Customize' });
const cardsRegion = (): HTMLElement => screen.getByRole('region', { name: CARDS });
/**
 * The layout item id of each card frame, in page order. A built card words its own title (a card of one engine says
 * which), so the cards are told apart by item id and not by the catalog title.
 */
const cardIds = (): string[] =>
  [...cardsRegion().querySelectorAll<HTMLElement>('[data-layout-card]')].map((frame) => frame.dataset.layoutCard ?? '');

describe('the AI visibility page without access', () => {
  it('says so and reads nothing without data:read', async () => {
    const requests: string[] = [];
    const listener = ({ request }: { request: Request }): void => {
      requests.push(new URL(request.url).pathname);
    };
    server.events.on('request:start', listener);
    renderWithProviders(overviewAs('viewer', { withoutPermissions: ['data:read'] }));
    expect(screen.getByRole('heading', { level: 1, name: 'AI visibility' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'You cannot see AI visibility for this project' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests.filter((path) => /\/(engines|ai\/|layouts)/.test(path))).toEqual([]);
    server.events.removeListener('request:start', listener);
  });
});

describe('the AI visibility page of a project with engines on', () => {
  it('has the title, the meta line from the answers, Customize and More actions in the header', async () => {
    renderWithProviders(overviewAs('admin'));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'AI visibility' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/^AI updated .+ · \d+ prompts · 2 engines$/)).toBeInTheDocument();
    });
    expect(customize()).toHaveClass('hidden', 'md:inline-flex');
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
    expect(screen.queryByText('Customizing')).not.toBeInTheDocument();
  });

  it('copies the link from the More actions menu', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const { user } = renderWithProviders(overviewAs('admin'));
    // After the render: the user event library puts a clipboard of its own on the navigator
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy link' }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledExactlyOnceWith(window.location.href);
    });
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('shows the nine cards of the built-in layout, each card a pending card with its catalog title until its family builds it', async () => {
    renderWithProviders(overviewAs('admin'));
    const cards = SCREENS.ai_overview.builtin.cards ?? [];
    expect(cards).toHaveLength(9);
    // A card that a family registers replaces its placeholder: only the others are pending
    const built = new Set(FAMILIES.flatMap((family) => Object.keys(family)));
    const pending = cards.filter((card) => !built.has(card.type));
    const pendingNames = pending.map(cardName);
    await waitFor(() => {
      expect(cardIds()).toEqual(cards.map((card) => card.id));
    });
    // The pending cards keep the order of the layout
    expect(
      within(cardsRegion())
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent ?? '')
        .filter((text) => pendingNames.includes(text)),
    ).toEqual(pendingNames);
    const reason = 'This card is being built. You can keep it in your layout.';
    await waitFor(() => {
      expect(cardsRegion().querySelectorAll('[data-slot="pending-card"]')).toHaveLength(pending.length);
    });
    for (const body of cardsRegion().querySelectorAll('[data-slot="pending-card"]')) {
      expect(body.querySelector('p.type-subsection-title')).toHaveTextContent('This card is not built yet');
      expect(body.querySelector('p.type-body')).toHaveTextContent(reason);
      // No Table view or menu on a card with nothing to show
      expect(within(body as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    }
    expect(within(cardsRegion()).queryAllByText(reason)).toHaveLength(pending.length);
  });

  it('does not offer Customize while the engines load, and offers it once they are read', async () => {
    const release = gate();
    server.use(
      http.get(ENGINES, async ({ request }) => {
        await release.promise;
        return getResponse([...handlers], new Request(request.url, { headers: request.headers }));
      }),
    );
    renderWithProviders(overviewAs('admin'));
    expect(screen.getByRole('heading', { level: 1, name: 'AI visibility' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: CARDS })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No AI engine is on' })).not.toBeInTheDocument();
    release.open();
    expect(await screen.findByRole('button', { name: 'Customize' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: CARDS })).toBeInTheDocument();
  });

  it('shows the Customizing badge beside the title, outside the heading, while customizing', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    const button = await screen.findByRole('button', { name: 'Customize' });
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(button);
    expect(await screen.findByText('Customizing')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('AI visibility');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByText('Customizing')).not.toBeInTheDocument();
    });
  });

  it('has one save bar, the one the screen draws at its end, and only while customizing', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    const button = await screen.findByRole('button', { name: 'Customize' });
    expect(document.querySelectorAll('[data-slot="layout-save-bar"]')).toHaveLength(0);
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(button);
    await waitFor(() => {
      expect(document.querySelectorAll('[data-slot="layout-save-bar"]')).toHaveLength(1);
    });
  });
});

describe('the AI visibility page of a project with AI off', () => {
  it('shows the no engine state and no cards, with the action to turn engines on for a person who may', async () => {
    renderWithProviders(overviewAs('admin', { world: 'cleanstart' }));
    expect(await screen.findByRole('heading', { name: 'No AI engine is on' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: CARDS })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn on engines' })).toHaveAttribute(
      'href',
      '/digibranders/cleanstart/settings/engines',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'AI visibility' })).toBeInTheDocument();
  });

  it('asks a viewer to ask a workspace admin, with no link', async () => {
    renderWithProviders(overviewAs('viewer', { world: 'cleanstart' }));
    expect(await screen.findByRole('heading', { name: 'No AI engine is on' })).toBeInTheDocument();
    expect(screen.getByText('Ask a workspace admin to turn on an engine')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Turn on engines' })).not.toBeInTheDocument();
  });

  it('shows placeholders for the AI cards in customize mode', async () => {
    const { user } = renderWithProviders(overviewAs('admin', { world: 'cleanstart' }));
    const button = await screen.findByRole('button', { name: 'Customize' });
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(button);
    const region = await screen.findByRole('region', { name: CARDS });
    await waitFor(() => {
      expect(region.querySelectorAll('[data-slot="unavailable-card"]').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('heading', { name: 'No AI engine is on' })).not.toBeInTheDocument();
  });
});

describe('the numbers strip of the AI visibility page', () => {
  const STRIP = 'AI visibility numbers for Oct 16 to Nov 12, 2026, branded prompts excluded';
  const stripOf = (): Promise<HTMLElement> => screen.findByRole('group', { name: STRIP });
  const valuesOf = (strip: HTMLElement): HTMLElement[] => within(strip).getAllByRole('definition');

  it('shows the Fynix numbers, the engines in the order ChatGPT, Gemini, AI Mode, named by the window and the branded choice', async () => {
    renderWithProviders(overviewAs('admin'));
    const strip = await stripOf();
    await waitFor(() => {
      expect(strip).not.toHaveAttribute('aria-busy');
    });
    const terms = within(strip)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(terms).toHaveLength(4);
    expect(terms[0]).toBe('Prompts');
    expect(terms[1]).toMatch(/^Mention rate.*ChatGPT$/);
    expect(terms[2]).toMatch(/^Mention rate.*Gemini$/);
    expect(terms[3]).toMatch(/^Mention rate.*AI Mode$/);
    const [prompts, chatgpt, gemini, aiMode] = valuesOf(strip);
    expect(prompts).toHaveTextContent(/^\d+/);
    // No engine is pooled: each number is its own engine's, with its counts beside it
    expect(chatgpt).toHaveTextContent(/%.*\d[\d,]* of \d[\d,]* answers|answers?/);
    expect(gemini).toHaveTextContent(/%.*\d[\d,]* of \d[\d,]* answers|answers?/);
    // Fynix has AI Mode off: it is not asked, and never a zero
    expect(aiMode).toHaveTextContent('Not asked');
    expect(aiMode).toHaveTextContent('Off in this project');
    expect(aiMode).not.toHaveTextContent('0%');
    expect(chatgpt).toHaveAttribute('tabindex', '0');
    expect(chatgpt).toHaveAccessibleDescription(/Window: Oct 16 to Nov 12, 2026 \(branded prompts excluded\)/);
  });

  it('is a plain cell until the links of the drill-down exist: no number is a link', async () => {
    renderWithProviders(overviewAs('admin'));
    const strip = await stripOf();
    await waitFor(() => {
      expect(strip).not.toHaveAttribute('aria-busy');
    });
    expect(within(strip).queryAllByRole('link')).toHaveLength(0);
  });

  it('shows the single engine of the filter and says the others are not asked', async () => {
    renderWithProviders(overviewAs('admin'), { searchParams: '?engine=gemini_web' });
    const strip = await stripOf();
    await waitFor(() => {
      expect(strip).not.toHaveAttribute('aria-busy');
    });
    const [, chatgpt, gemini] = valuesOf(strip);
    expect(chatgpt).toHaveTextContent('Not asked');
    expect(chatgpt).toHaveTextContent('Not in the engine filter');
    expect(gemini).not.toHaveTextContent('Not asked');
  });

  it('shows no change with the comparison off', async () => {
    renderWithProviders(overviewAs('admin'), { searchParams: '?cmp=off' });
    const strip = await stripOf();
    await waitFor(() => {
      expect(strip).not.toHaveAttribute('aria-busy');
    });
    expect(within(strip).queryByText(/ pts$/)).toBeNull();
    expect(valuesOf(strip)[1]).not.toHaveAccessibleDescription(/Change against/);
  });

  it('changes the numbers and the address when the scope bar changes the scope', async () => {
    const urls: string[] = [];
    const { user } = renderWithProviders(overviewAs('admin'), {
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    const strip = await stripOf();
    await waitFor(() => {
      expect(strip).not.toHaveAttribute('aria-busy');
    });
    expect(valuesOf(strip)[1]).not.toHaveTextContent('Not asked');
    await user.click(await screen.findByRole('button', { name: 'Engines: 2 of 2' }));
    await user.click(await screen.findByRole('checkbox', { name: 'ChatGPT' }));
    await waitFor(() => {
      expect(urls.at(-1)).toBe('?engine=gemini_web');
    });
    await waitFor(() => {
      expect(valuesOf(screen.getByRole('group', { name: STRIP }))[1]).toHaveTextContent('Not asked');
    });
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'vs previous period' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'No comparison' }));
    await waitFor(() => {
      expect(urls.at(-1)).toBe('?engine=gemini_web&cmp=off');
    });
  });

  it('shows the strip error with Try again when the summary fails, and the cards keep their own states', async () => {
    server.use(
      http.get(mswPath('/api/v1/workspaces/:w/projects/:p/ai/prompts-summary'), () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req-7' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    renderWithProviders(overviewAs('admin'));
    const title = await screen.findByText('The AI numbers could not be read');
    // A built card shows the request id of its own failed read too, so the strip's id is looked up in the strip's panel.
    const panel = title.closest<HTMLElement>('.min-h-metric-strip');
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByText('Error ID req-7')).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: STRIP })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(cardIds()).toHaveLength(9);
    });
  });

  it('keeps the strip in customize mode with the controls of each number, and no links', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    const button = await screen.findByRole('button', { name: 'Customize' });
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(button);
    const strip = await stripOf();
    for (const name of ['Prompts', 'Mention rate ChatGPT', 'Mention rate Gemini', 'Mention rate AI Mode']) {
      expect(within(strip).getByRole('button', { name: `Reorder ${name}` })).toBeInTheDocument();
      expect(within(strip).getByRole('button', { name: `Remove ${name}` })).toBeInTheDocument();
    }
    expect(within(strip).getByRole('button', { name: 'Add number' })).toBeInTheDocument();
    expect(within(strip).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('the presets of the AI visibility page', () => {
  type User = ReturnType<typeof renderWithProviders>['user'];

  const polite = (): HTMLElement | null => document.getElementById(LIVE_REGION_ID.polite);
  async function startCustomizing(user: User): Promise<void> {
    const button = await screen.findByRole('button', { name: 'Customize' });
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });
    await user.click(button);
    await screen.findByRole('button', { name: 'Start from' });
  }

  /** Opens the Start from menu and waits for focus to move into it before any key is pressed. */
  async function openMenu(user: User): Promise<HTMLElement> {
    await user.click(screen.getByRole('button', { name: 'Start from' }));
    const menu = await screen.findByRole('menu');
    await waitFor(() => {
      expect(menu.contains(document.activeElement)).toBe(true);
    });
    return menu;
  }

  const items = (menu: HTMLElement): string[] =>
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent ?? '');

  it('lists Built-in default, then the four presets in order', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    await startCustomizing(user);
    expect(items(await openMenu(user))).toEqual([
      'Built-in default',
      'Executive summary',
      'SEO analyst',
      'Competitive',
      'Topic owner',
    ]);
  });

  it('offers the presets it is given instead of its own', async () => {
    const presets = buildOverviewPresets({
      executive: 'Alpha',
      seo_analyst: 'Beta',
      competitive: 'Gamma',
      topic_owner: 'Delta',
    });
    const { user } = renderWithProviders(overviewAs('admin', { presets }));
    await startCustomizing(user);
    expect(items(await openMenu(user))).toEqual(['Built-in default', 'Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  it('replaces the draft with a preset, counts the change, announces it and writes nothing', async () => {
    const served = serveLayouts();
    const writes: string[] = [];
    const listener = ({ request }: { request: Request }): void => {
      if (request.method !== 'GET') writes.push(`${request.method} ${new URL(request.url).pathname}`);
    };
    server.events.on('request:start', listener);
    const { user } = renderWithProviders(overviewAs('admin'));
    await startCustomizing(user);
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Executive summary' }));
    const ids = EXECUTIVE_LAYOUT.cards?.map((card) => card.id) ?? [];
    await waitFor(() => {
      expect(cardIds()).toEqual(ids);
    });
    expect(screen.getByRole('group', { name: /^[1-9]\d* changes?$/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(polite()).toHaveTextContent('Executive summary applied. Save to keep it.');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.events.removeListener('request:start', listener);
    expect(writes).toEqual([]);
    expect(served.puts).toEqual([]);
    expect(served.deletes).toEqual([]);
  });

  it('restores the layout from before the preset on Undo', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    await startCustomizing(user);
    await waitFor(() => {
      expect(cardIds()).toHaveLength(9);
    });
    const before = cardIds();
    await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'Executive summary' }));
    await waitFor(() => {
      expect(cardIds()).toHaveLength(6);
    });
    await user.click(
      within(screen.getByRole('group', { name: /^[1-9]\d* changes?$/ })).getByRole('button', { name: 'Undo' }),
    );
    await waitFor(() => {
      expect(cardIds()).toEqual(before);
    });
    expect(screen.getByRole('group', { name: 'No changes' })).toBeInTheDocument();
  });
});

describe('a card inside the overview harness', () => {
  it('reads the overview context and sits in the grid with its frame', async () => {
    function Card(): ReactElement {
      const { project, enabledEngines } = useOverview();
      return <p>{`${project.slug} with ${String(enabledEngines.length)} engines`}</p>;
    }
    renderWithProviders(cardInOverview({ type: 'ai.outcome_mix', Card }));
    expect(await screen.findByText('fynix with 2 engines')).toBeInTheDocument();
    expect(document.querySelector(`[data-layout-card="${CARD_ID}"]`)).not.toBeNull();
  });
});
