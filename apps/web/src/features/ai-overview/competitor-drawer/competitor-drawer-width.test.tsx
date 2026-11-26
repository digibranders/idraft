import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectorWidthUserContext, writeInspectorWidth } from '@/lib/inspector/width-store';
import { MOCK_ENTITY_IDS } from '@/mocks/entity-fixtures';
import { overviewAs } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { expectNoPixelWidth } from '@/test/drawer-width-scan';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

/**
 * The competitor drawer at the least width, the default and the most. jsdom has no layout, so these tests read what
 * decides the width in code: nothing inside the card holds a pixel width of its own, and every table fills it.
 */

const USER = 'competitor-drawer-width-user';
const TIMEOUT = { timeout: 8000 };

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
  vi.stubGlobal('innerWidth', 1680);
});
afterEach(() => {
  writeInspectorWidth(USER, null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function open(width: number, tab: string): Promise<{ card: HTMLElement; user: UserEvent }> {
  writeInspectorWidth(USER, width);
  const { user } = renderWithProviders(
    <InspectorWidthUserContext value={USER}>{overviewAs('admin')}</InspectorWidthUserContext>,
    {
      searchParams: `cmp=off&inspect=competitor:${MOCK_ENTITY_IDS.brightwave}&itab=${tab}`,
    },
  );
  const card = await screen.findByRole('complementary', { name: 'Brightwave Digital' }, TIMEOUT);
  expect(card.style.width).toBe(`${String(width)}px`);
  await within(card).findByRole('tab', { selected: true }, TIMEOUT);
  await waitFor(() => expect(card.querySelector('[aria-busy="true"]')).toBeNull(), TIMEOUT);
  return { card, user };
}

describe.each([480, 640, 960])('The competitor drawer at %i px', (width) => {
  it.each(['overview', 'prompts', 'sources'])(
    'holds no pixel width of its own on its %s tab',
    async (tab) => {
      const { card, user } = await open(width, tab);
      // What each tab draws is there, so the scan reads its rows and not a loading card
      if (tab === 'overview') expect(within(card).getAllByRole('table')).toHaveLength(2);
      if (tab === 'prompts') {
        // The prompts of the lead the fixture has some for: the rows, their bars and the group strip are drawn
        await user.click(within(card).getByRole('radio', { name: /You lead/ }));
        expect((await within(card).findAllByRole('link', undefined, TIMEOUT)).length).toBeGreaterThan(0);
        expect(within(card).getAllByRole('button', { pressed: false }).length).toBeGreaterThan(0);
      }
      if (tab === 'sources') expect(within(card).getAllByRole('table')).toHaveLength(2);
      for (const table of card.querySelectorAll('table')) expect(table).toHaveClass('w-full');
      expectNoPixelWidth(card);
    },
    30_000,
  );
});
