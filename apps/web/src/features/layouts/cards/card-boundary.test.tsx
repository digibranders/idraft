import { useSuspenseQuery } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineCards, type CardProps, type CardRegistry } from '../registry';
import { axe } from '@/test/axe';
import { ScreenUnderTest, box, serveLayouts, startCustomizing, stubViewport } from '@/test/customize-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

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

  it('says it once in view mode', async () => {
    const registry = registryOf({ 'seo.rank_distribution': () => Promise.resolve({ default: Breaks }) });
    renderWithProviders(<ScreenUnderTest addSlot registry={registry} />);
    await screen.findByText(FAILED);
    expect(screen.getAllByText(FAILED)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  describe('in customize mode', () => {
    /** The frame of the failed card, once the mode has begun and the failure is on screen. */
    async function failedFrame(registry: CardRegistry): Promise<{ user: ProvidedRender['user']; frame: HTMLElement }> {
      const { user } = renderWithProviders(<ScreenUnderTest addSlot registry={registry} />);
      await screen.findByText(FAILED);
      await startCustomizing(user);
      const frame = await waitFor(() => {
        const found = box().querySelector<HTMLElement>('[data-layout-card="rank-distribution"]');
        if (found === null || within(found).queryByText(FAILED) === null) throw new Error('not failed yet');
        return found;
      });
      return { user, frame };
    }

    it('shows the failure and a Retry outside the inert body, so assistive technology reads them', async () => {
      const registry = registryOf({ 'seo.rank_distribution': () => Promise.resolve({ default: Breaks }) });
      const { frame } = await failedFrame(registry);
      const message = within(frame).getByText(FAILED);
      const retry = within(frame).getByRole('button', { name: 'Retry' });
      expect(message.closest('[inert]')).toBeNull();
      expect(retry.closest('[inert]')).toBeNull();
      // Once: the inert body shows nothing of its own
      expect(within(frame).getAllByText(FAILED)).toHaveLength(1);
      expect(within(frame).getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
      expect(message.closest('[role="group"]')).toHaveAccessibleName('Rank distribution');
    });

    it('Retry does what it does in view mode: resets the registry entry and renders the card again', async () => {
      const registry = registryOf({ 'seo.rank_distribution': () => Promise.resolve({ default: Breaks }) });
      const entry = registry['seo.rank_distribution'];
      if (entry === undefined) throw new Error('the card is not registered');
      const reset = vi.spyOn(entry, 'reset');
      const { user, frame } = await failedFrame(registry);
      state.broken = false;
      await user.click(within(frame).getByRole('button', { name: 'Retry' }));
      expect(await within(frame).findByTestId('body-recovered')).toBeInTheDocument();
      expect(within(frame).queryByText(FAILED)).not.toBeInTheDocument();
      expect(within(frame).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
      expect(reset).toHaveBeenCalledTimes(1);
    });

    it('recovers a card that fails to load its code on Retry', async () => {
      const registry = registryOf({
        'seo.rank_distribution': () =>
          state.loadFails ? Promise.reject(new Error('Loading chunk failed')) : Promise.resolve({ default: Fine }),
      });
      const { user, frame } = await failedFrame(registry);
      state.loadFails = false;
      await user.click(within(frame).getByRole('button', { name: 'Retry' }));
      expect(await within(frame).findByTestId('body-rank-distribution')).toBeInTheDocument();
    });

    it('leaves the other cards alone', async () => {
      const registry = registryOf({
        'seo.rank_distribution': () => Promise.resolve({ default: Breaks }),
        'trend.visibility_mentions': () => Promise.resolve({ default: Fine }),
      });
      const { frame } = await failedFrame(registry);
      expect(await screen.findByTestId('body-trend')).toBeInTheDocument();
      expect(screen.getAllByText(FAILED)).toHaveLength(1);
      expect(within(frame).getByText(FAILED)).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
      const registry = registryOf({ 'seo.rank_distribution': () => Promise.resolve({ default: Breaks }) });
      const { frame } = await failedFrame(registry);
      expect(frame).toBeInTheDocument();
      expect(await axe(document.body)).toHaveNoViolations();
    });
  });

  it('has no accessibility violations', async () => {
    const registry = registryOf({ 'seo.rank_distribution': () => Promise.resolve({ default: Breaks }) });
    const view = renderWithProviders(<ScreenUnderTest addSlot registry={registry} />);
    await screen.findByText(FAILED);
    expect(await axe(view.container)).toHaveNoViolations();
  });
});
