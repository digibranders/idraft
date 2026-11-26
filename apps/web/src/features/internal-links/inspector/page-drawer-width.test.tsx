import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectorWidthUserContext, writeInspectorWidth } from '@/lib/inspector/width-store';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { expectNoPixelWidth } from '@/test/drawer-width-scan';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * The page drawer at the least width, the default and the most. jsdom has no layout, so these tests read what decides
 * the width in code: nothing inside the card holds a pixel width of its own, and its three footer buttons share one
 * row that may shrink with the card.
 */

const USER = 'internal-links-drawer-width-user';

beforeEach(() => stubWideScreen());
afterEach(() => {
  writeInspectorWidth(USER, null);
  restoreWideScreen();
});

describe.each([480, 640, 960])('The page drawer at %i px', (width) => {
  it('holds no pixel width of its own, and keeps its footer in one row', async () => {
    writeInspectorWidth(USER, width);
    renderWithProviders(
      <InspectorWidthUserContext value={USER}>{internalLinksAs('editor', EVENTUS_LINKS)}</InspectorWidthUserContext>,
      { searchParams: 'inspect=page:108' },
    );
    const card = await screen.findByRole('complementary', { name: '/pricing' });
    expect(card.style.width).toBe(`${String(width)}px`);
    // Every section has answered: the tier, the strip, the two neighbour lists and the flags
    await within(card).findByRole('heading', { name: /^Linking pages \(\d+\)$/ });
    await waitFor(() => expect(card.querySelector('[aria-busy="true"]')).toBeNull());
    expectNoPixelWidth(card);
    const footer = within(card).getByRole('button', { name: 'Open in journey' }).parentElement?.parentElement;
    expect(footer).not.toBeNull();
    expect(footer).not.toHaveClass('flex-wrap');
  });
});
