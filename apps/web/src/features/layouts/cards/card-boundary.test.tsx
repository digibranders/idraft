import { useSuspenseQuery } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineCards, type CardProps, type CardRegistry } from '../registry';
import { axe } from '@/test/axe';
import { ScreenUnderTest, box, serveLayouts, startCustomizing, stubViewport } from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const FAILED = 'This card could not be shown.';

/** What a card does when it is rendered: a switch the test turns. */
const state = { broken: true, queryFails: true, loadFails: true };

function Fine({ item }: CardProps): ReactElement {
  return <p data-testid={`body-${item.id}`}>{`Body of ${item.id}`}</p>;
}
function Breaks(): ReactElement {
  if (state.broken) throw new Error('This card has a bug');
  return <p data-testid="body-recovered">Recovered</p>;
}
function Remote(): ReactElement {
  const { data } = useSuspenseQuery({
    queryKey: ['card-boundary-test'],
    queryFn: () => (state.queryFails ? Promise.reject(new Error('The data failed')) : Promise.resolve('Fresh data')),
  });
  return <p data-testid="body-remote">{data}</p>;
}

const registryOf = (
  cards: Record<string, () => Promise<{ default: (props: CardProps) => ReactElement }>>,
): CardRegistry => defineCards(Object.fromEntries(Object.entries(cards).map(([type, load]) => [type, { load }])));

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.broken = true;
  state.queryFails = true;
  state.loadFails = true;
  serveLayouts();
  stubViewport();
  // React and the query cache report the errors they hand to a boundary
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

describe('CardBoundary', () => {
  it('shows This card could not be shown. with Retry for a card that throws, and names the card', async () => {
    const registry = registryOf({ 'seo.rank_distribution': () => Promise.resolve({ default: Breaks }) });
    renderWithProviders(<ScreenUnderTest addSlot registry={registry} />);
    const message = await screen.findByText(FAILED);
    const group = message.closest('[role="group"]');
    expect(group).toHaveAccessibleName('Rank distribution');
    expect(within(group as HTMLElement).getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('keeps the other cards rendering', async () => {
    const registry = registryOf({
      'seo.rank_distribution': () => Promise.resolve({ default: Breaks }),
      'trend.visibility_mentions': () => Promise.resolve({ default: Fine }),
      'ai.by_engine': () => Promise.resolve({ default: Fine }),
    });
    renderWithProviders(<ScreenUnderTest addSlot registry={registry} />);
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(await screen.findByTestId('body-trend')).toBeInTheDocument();
    expect(await screen.findByTestId('body-ai-by-engine')).toBeInTheDocument();
    expect(screen.getAllByText(FAILED)).toHaveLength(1);
  });

  it('Retry resets the registry entry and renders the card again', async () => {
    const registry = registryOf({ 'seo.rank_distribution': () => Promise.resolve({ default: Breaks }) });
    const entry = registry['seo.rank_distribution'];
    if (entry === undefined) throw new Error('the card is not registered');
    const reset = vi.spyOn(entry, 'reset');
    const { user } = renderWithProviders(<ScreenUnderTest addSlot registry={registry} />);
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    // Still broken: the fallback is back, and the registry was asked first
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(reset).toHaveBeenCalledTimes(1);

    state.broken = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('body-recovered')).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it('Retry resets the query errors, so a card whose data failed asks for it again', async () => {
    const registry = registryOf({ 'seo.rank_distribution': () => Promise.resolve({ default: Remote }) });
    const { user } = renderWithProviders(<ScreenUnderTest addSlot registry={registry} />);
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    state.queryFails = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('body-remote')).toHaveTextContent('Fresh data');
  });

  it('recovers a card that fails to load its code on Retry (the React.lazy cache)', async () => {
    let loads = 0;
    const registry = registryOf({
      'seo.rank_distribution': () => {
        loads += 1;
        return state.loadFails ? Promise.reject(new Error('Loading chunk failed')) : Promise.resolve({ default: Fine });
      },
    });
    const { user } = renderWithProviders(<ScreenUnderTest addSlot registry={registry} />);
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(loads).toBe(2);
    state.loadFails = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('body-rank-distribution')).toBeInTheDocument();
    expect(loads).toBe(3);
  });

  it('shows the failure in customize mode without a Retry, which the inert card could not use', async () => {
    const registry = registryOf({ 'seo.rank_distribution': () => Promise.resolve({ default: Breaks }) });
    const { user } = renderWithProviders(<ScreenUnderTest addSlot registry={registry} />);
    await screen.findByText(FAILED);
    await startCustomizing(user);
    await waitFor(() => {
      expect(within(box()).getByText(FAILED)).toBeInTheDocument();
    });
    expect(within(box()).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const registry = registryOf({ 'seo.rank_distribution': () => Promise.resolve({ default: Breaks }) });
    const view = renderWithProviders(<ScreenUnderTest addSlot registry={registry} />);
    await screen.findByText(FAILED);
    expect(await axe(view.container)).toHaveNoViolations();
  });
});
