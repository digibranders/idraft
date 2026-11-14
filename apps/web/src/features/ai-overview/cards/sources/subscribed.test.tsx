import { act, screen, waitFor } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DiversityCard from './diversity-card';
import FanoutTopCard from './fanout-top-card';
import NewLostCard from './new-lost-card';
import OwnPagesCard from './own-pages-card';
import RoleShareCard from './role-share-card';
import TopDomainsCard from './top-domains-card';
import type { CardProps } from '@/features/layouts';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

/**
 * Every card of the sources family asks its reads only while it is live (customize mode pauses them): the one place
 * that proves `subscribed: live` reaches each read of each card, since a card that drops it still renders. A card
 * that is not live asks for no domains, pages, changes, diversity or fan-out rows, and shows its loading state: the
 * read is paused, not failed, and not empty.
 */

const CARDS: readonly (readonly [type: string, Card: ComponentType<CardProps>])[] = [
  ['sources.top_domains', TopDomainsCard],
  ['sources.own_pages', OwnPagesCard],
  ['ai.citation_share_by_domain_type', RoleShareCard],
  ['ai.fanout_top', FanoutTopCard],
  ['sources.new_lost', NewLostCard],
  ['sources.diversity', DiversityCard],
];

const listeners: ((info: { request: Request }) => void)[] = [];

/** The paths of the requests the server sees from the start of the test. */
function recordPaths(): string[] {
  const paths: string[] = [];
  const listener = ({ request }: { request: Request }): void => {
    paths.push(new URL(request.url).pathname);
  };
  server.events.on('request:start', listener);
  listeners.push(listener);
  return paths;
}
/** The requests of the sources reads: every route under `ai/sources` and the fan-out rows. */
const sourceReads = (paths: readonly string[]): string[] =>
  paths.filter((path) => /\/ai\/(sources\/|fanout-queries)/.test(path));

const LOADING = 'section[aria-busy="true"] [data-slot="skeleton"]';

function renderCard(
  type: string,
  Card: ComponentType<CardProps>,
  live: boolean,
): ReturnType<typeof renderWithProviders> {
  function Held(props: CardProps): ReactElement {
    return <Card {...props} live={live} />;
  }
  return renderWithProviders(cardInOverview({ type, Card: Held, width: 'two_thirds' }), { searchParams: 'cmp=on' });
}

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(CARDS)('%s', (type, Card) => {
  it('a card that is not live makes no request for its sources and shows a skeleton, not an error', async () => {
    const paths = recordPaths();
    const { container } = renderCard(type, Card, false);
    // The engines are read whatever the card does; once they are in, a live card would have asked for its rows
    await waitFor(() => {
      expect(paths.some((path) => path.endsWith('/engines'))).toBe(true);
      expect(container.querySelector(LOADING)).not.toBeNull();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(sourceReads(paths)).toEqual([]);
    expect(container.querySelector(LOADING)).not.toBeNull();
    expect(screen.queryByText(/^Could not load/)).not.toBeInTheDocument();
  });

  it('a live card asks for its sources', async () => {
    const paths = recordPaths();
    renderCard(type, Card, true);
    await waitFor(() => {
      expect(sourceReads(paths).length).toBeGreaterThan(0);
    });
  });
});
