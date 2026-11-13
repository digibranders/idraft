import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutsLive } from './live-specimen';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

// The canvas stub of the test setup cannot draw: the picked up specimen holds a real chart, so the canvas is stood in for
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

/** The workspace the failure specimen reads on purpose: the mock does not know it. */
const UNKNOWN_WORKSPACE = '00000000-0000-4000-8000-0000000000ff';
const SPECIMENS = ['loading', 'failed', 'refetching', 'empty', 'empty-unavailable', 'picked', 'drawer'] as const;

// jsdom has no media queries; the grid reads the breakpoint
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.unstubAllGlobals();
});

describe('the live layouts gallery', () => {
  it('says that nobody is signed in, and the live specimen asks for no layout', async () => {
    const layoutRequests: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname.includes('/layouts/')) layoutRequests.push(request.url);
    });
    const { container } = renderWithProviders(<LayoutsLive />);
    expect(
      await screen.findByText('Sign in to try the live layout. While you are signed out this page asks for no layout.'),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-specimen="live"]')).not.toBeNull();
    // Only the failure specimen reads a layout, of the workspace the mock does not know
    expect(layoutRequests.every((url) => url.includes(UNKNOWN_WORKSPACE))).toBe(true);
  });

  it('draws every static specimen and titles each group with a level 2 heading', async () => {
    const { container } = renderWithProviders(<LayoutsLive />);
    for (const name of SPECIMENS) expect(container.querySelector(`[data-specimen="${name}"]`)).not.toBeNull();
    for (const title of [
      'Live layout on the mock API',
      'Layout states',
      'A picked up card',
      'Drawer form, one column',
    ]) {
      expect(await screen.findByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
  });
});
