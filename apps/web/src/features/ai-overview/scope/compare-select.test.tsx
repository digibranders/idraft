import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompareSelect } from './compare-select';
import { useOverviewScope } from './use-overview-scope';
import { renderWithProviders } from '@/test/render';

beforeEach(() => {
  // The page's today is read from the clock: the default window is Oct 17 to Nov 13 2026
  vi.useFakeTimers({ now: new Date('2026-11-13T09:00:00Z'), toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** The select as the page wires it: the scope from the URL, the choice written back with `setScope`. */
function Wired(): ReactElement {
  const { scope, setScope } = useOverviewScope({ project: { timeZone: 'Europe/Berlin' } });
  return <CompareSelect scope={scope} onCompareChange={(compare) => setScope({ compare })} />;
}

const trigger = (name: RegExp | string): Promise<HTMLElement> => screen.findByRole('button', { name });

describe('CompareSelect', () => {
  it('defaults to vs previous period and No comparison writes cmp=off', async () => {
    const updates: string[] = [];
    const { user } = renderWithProviders(<Wired />, { onUrlUpdate: (event) => updates.push(event.queryString) });
    const button = await trigger('vs previous period');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(button);
    expect(await screen.findByRole('menuitemradio', { name: 'vs previous period' })).toBeChecked();
    await user.click(screen.getByRole('menuitemradio', { name: 'No comparison' }));
    await waitFor(() => {
      expect(updates.at(-1)).toBe('?cmp=off');
    });
    expect(await trigger('No comparison')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'No comparison' }));
    const again = await screen.findByRole('menuitemradio', { name: 'vs previous period' });
    // An item clicked in the instant the menu opens is taken for the end of the click that opened it
    await waitFor(() => {
      expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true);
    });
    await user.click(again);
    await waitFor(() => {
      expect(updates.at(-1)).toBe('');
    });
  });

  it('names the two windows in words at the head of the menu, the previous one from previousWindow', async () => {
    const { user } = renderWithProviders(<Wired />);
    await user.click(await trigger('vs previous period'));
    // 28 days from Oct 17: the 28 days before are Sep 19 to Oct 16
    expect(await screen.findByText('Oct 17 to Nov 13, 2026 against Sep 19 to Oct 16, 2026')).toBeInTheDocument();
  });

  it('says there is no comparison in the head of the menu while it is off', async () => {
    const { user } = renderWithProviders(<Wired />, { searchParams: '?cmp=off' });
    await user.click(await trigger('No comparison'));
    expect(await screen.findByText('Oct 17 to Nov 13, 2026, with no comparison')).toBeInTheDocument();
  });

  it('offers no comparison for a window whose previous days start before the year 2000', async () => {
    const { user } = renderWithProviders(<Wired />, { searchParams: '?from=2000-01-05&to=2000-01-20' });
    await user.click(await trigger('No comparison'));
    const previous = await screen.findByRole('menuitemradio', { name: 'vs previous period' });
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('No days before this window')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'No comparison' })).toBeChecked();
  });

  it('chooses with the arrows and Enter, and Escape closes and returns focus', async () => {
    const updates: string[] = [];
    const { user } = renderWithProviders(<Wired />, { onUrlUpdate: (event) => updates.push(event.queryString) });
    const button = await trigger('vs previous period');
    await user.click(button);
    const menu = await screen.findByRole('menu');
    // Focus moves into the menu after it opens: a key pressed before that goes nowhere
    await waitFor(() => {
      expect(menu.contains(document.activeElement)).toBe(true);
    });
    // Opened by a click nothing is highlighted: the first arrow reaches the first item, the second the next one
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(updates.at(-1)).toBe('?cmp=off');
    });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    await user.click(await trigger('No comparison'));
    const reopened = await screen.findByRole('menu');
    await waitFor(() => {
      expect(reopened.contains(document.activeElement)).toBe(true);
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    expect(await trigger('No comparison')).toHaveFocus();
  });
});
