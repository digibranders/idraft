import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cardName, SCREENS } from '@/lib/layouts';
import { handlers } from '@/mocks/handlers';
import { mswPath } from '@/mocks/respond';
import { CARD_ID, cardInOverview, overviewAs } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';
import { useOverview } from './overview-context';
import type { ReactElement } from 'react';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const NOW = new Date('2026-11-12T12:00:00Z');
const ENGINES = mswPath('/api/v1/workspaces/:w/projects/:p/engines');
const CARDS = 'AI visibility cards';

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

  it('shows the nine cards of the built-in layout, each a pending card with its catalog title', async () => {
    renderWithProviders(overviewAs('admin'));
    const names = SCREENS.ai_overview.builtin.cards?.map(cardName) ?? [];
    expect(names).toHaveLength(9);
    await waitFor(() => {
      expect(within(cardsRegion()).getAllByRole('heading', { level: 2 })).toHaveLength(9);
    });
    expect(
      within(cardsRegion())
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(names);
    expect(within(cardsRegion()).getAllByText('This card is not built yet')).toHaveLength(9);
    expect(
      within(cardsRegion()).getAllByText(
        'It will show here as soon as its data is ready. You can keep it in your layout.',
      ),
    ).toHaveLength(9);
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
