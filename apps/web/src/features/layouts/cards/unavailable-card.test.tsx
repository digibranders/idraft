import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UnavailableCard } from './unavailable-card';
import type { Capabilities } from '@/lib/layouts';
import { axe } from '@/test/axe';
import { ScreenUnderTest, box, serveLayouts, startCustomizing, stubViewport } from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const SEO_ONLY: Capabilities = { channels: ['seo'], permissions: [], integrations: [] };
const REASON = 'AI tracking is off in this project';
const NOTE = 'This card shows in projects that have what it needs.';

beforeEach(() => {
  serveLayouts();
  stubViewport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UnavailableCard', () => {
  it('shows the card name, the reason and the note in customize mode', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest addSlot capabilities={SEO_ONLY} />);
    await startCustomizing(user);
    const frame = box().querySelector<HTMLElement>('[data-layout-card="ai-by-engine"]');
    if (frame === null) throw new Error('the unavailable card has no frame');
    expect(within(frame).getByText('AI by engine')).toBeInTheDocument();
    expect(within(frame).getByText(REASON)).toBeInTheDocument();
    expect(within(frame).getByText(NOTE)).toBeInTheDocument();
    // Outside the inert body: read by assistive technology, and not taken out of the tab order of the frame
    expect(within(frame).getByText(REASON).closest('[inert]')).toBeNull();
    // The card can still be moved or hidden
    expect(within(frame).getByRole('button', { name: 'Hide AI by engine' })).toBeInTheDocument();
  });

  it('is skipped in view mode', async () => {
    renderWithProviders(<ScreenUnderTest addSlot capabilities={SEO_ONLY} />);
    await waitFor(() => {
      expect(document.querySelector('[data-layout-card="rank-distribution"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-layout-card="ai-by-engine"]')).toBeNull();
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { user, container } = renderWithProviders(<ScreenUnderTest addSlot capabilities={SEO_ONLY} />);
    await startCustomizing(user);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders on its own from a card and a reason', () => {
    renderWithProviders(<UnavailableCard item={{ id: 'x', type: 'ai.by_engine' }} reason="Because" />);
    expect(screen.getByText('Because')).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });
});
