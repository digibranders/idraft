import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCustomize } from '../customize/customize-controller';
import {
  ScreenUnderTest,
  box,
  serveLayouts,
  startCustomizing,
  stateOf,
  stubViewport,
  type UnderTestProps,
} from '@/test/customize-harness';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const SEO_ONLY = { channels: ['seo'], permissions: [], integrations: [] } as const;

let viewport: ReturnType<typeof stubViewport>;

beforeEach(() => {
  serveLayouts();
  viewport = stubViewport();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A button that opens the catalog at the first place, as the Add card slot opens it at the last. */
function OpenAtStart(): ReactElement {
  const { openCatalog } = useCustomize();
  return (
    <button
      type="button"
      onClick={() => {
        openCatalog(0);
      }}
    >
      Open at start
    </button>
  );
}

async function customizing(extra: Partial<UnderTestProps> = {}): Promise<UserEvent> {
  const { user } = renderWithProviders(<ScreenUnderTest addSlot extra={<OpenAtStart />} {...extra} />);
  await startCustomizing(user);
  return user;
}

const slot = (): HTMLElement => within(box()).getByRole('button', { name: 'Add card' });
const polite = (): string => document.getElementById('live-region-polite')?.textContent ?? '';

/** Opens the catalog from the Add card slot and waits until focus is inside it. */
async function openCatalog(user: UserEvent): Promise<HTMLElement> {
  await user.click(slot());
  const dialog = await screen.findByRole('dialog', { name: 'Add card' });
  await waitFor(() => {
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
  return dialog;
}

const rowOf = (dialog: HTMLElement, title: string): HTMLElement => {
  const row = within(dialog).getByText(title).closest('li');
  if (row === null) throw new Error(`no row for ${title}`);
  return row;
};
const closed = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Add card' })).not.toBeInTheDocument();
  });
};
const searchField = (dialog: HTMLElement): HTMLElement =>
  within(dialog).getByRole('searchbox', { name: 'Search cards' });

describe('CardCatalogDialog', () => {
  it('opens with focus in the search field and names what each card follows', async () => {
    const user = await customizing();
    const dialog = await openCatalog(user);
    expect(searchField(dialog)).toHaveFocus();
    expect(within(dialog).getByText('Each card follows the page’s date range, location and filters.')).toBeVisible();
    expect(
      within(dialog)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['SEO', 'AI', 'Cross-channel', 'Activity']);
  });

  it('returns focus to the Add card slot on Escape and on Close, and stays in customize mode', async () => {
    const user = await customizing();
    await openCatalog(user);
    await user.keyboard('{Escape}');
    await closed();
    expect(slot()).toHaveFocus();
    expect(stateOf()).toBe('customize 0');

    const dialog = await openCatalog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await closed();
    expect(slot()).toHaveFocus();
    expect(stateOf()).toBe('customize 0');
  });

  it('adds at the slot, closes without restoring focus and the new card handle gets focus', async () => {
    const user = await customizing();
    const dialog = await openCatalog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Add Top movers' }));
    await closed();
    expect(stateOf()).toBe('customize 1');
    const cards = box().querySelectorAll<HTMLElement>('[data-layout-card]');
    const last = cards[cards.length - 1];
    expect(last).toBeDefined();
    const handle = within(last as HTMLElement).getByRole('button', { name: 'Reorder Top movers' });
    await waitFor(() => {
      expect(handle).toHaveFocus();
    });
    expect(polite()).toBe('Top movers added, position 9 of 9');
  });

  it('adds at the index the catalog was opened with', async () => {
    const user = await customizing();
    await user.click(within(box()).getByRole('button', { name: 'Open at start' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add card' });
    await user.click(within(dialog).getByRole('button', { name: 'Add SERP features' }));
    await closed();
    const first = box().querySelector<HTMLElement>('[data-layout-card]');
    expect(first).not.toBeNull();
    const handle = within(first as HTMLElement).getByRole('button', { name: 'Reorder SERP features' });
    await waitFor(() => {
      expect(handle).toHaveFocus();
    });
  });

  it('adds with Enter and with Space on the focused entry', async () => {
    const user = await customizing();
    let dialog = await openCatalog(user);
    within(dialog).getByRole('button', { name: 'Add Top movers' }).focus();
    await user.keyboard('{Enter}');
    await closed();
    expect(stateOf()).toBe('customize 1');

    dialog = await openCatalog(user);
    within(dialog).getByRole('button', { name: 'Add SERP features' }).focus();
    await user.keyboard(' ');
    await closed();
    expect(stateOf()).toBe('customize 2');
  });

  it('disables Added and says Add another for a type that takes more instances', async () => {
    const user = await customizing();
    let dialog = await openCatalog(user);
    // The built-in layout holds Rank distribution once
    expect(within(rowOf(dialog, 'Rank distribution')).getByRole('button', { name: 'Added' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Add Mention rate trend' }));
    await closed();

    dialog = await openCatalog(user);
    const another = within(rowOf(dialog, 'Mention rate trend')).getByRole('button', {
      name: 'Add another Mention rate trend',
    });
    expect(another).toBeEnabled();
    expect(another).toHaveTextContent('Add another');
  });

  it('disables Unavailable and shows the reason line for a type the project cannot use', async () => {
    const user = await customizing({ capabilities: SEO_ONLY });
    const dialog = await openCatalog(user);
    const row = rowOf(dialog, 'Mention rate trend');
    expect(within(row).getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    expect(within(row).getByText('AI tracking is off in this project')).toBeVisible();
    // The button is described by the card and by why it cannot be added
    expect(within(row).getByRole('button', { name: 'Unavailable' })).toHaveAccessibleDescription(
      'Mention rate trend AI tracking is off in this project',
    );
    // A card the project can use shows no reason
    expect(within(rowOf(dialog, 'Top movers')).queryByText(/tracking is off/)).not.toBeInTheDocument();
  });

  it('disables every entry that is not on the page with Page is full when twelve cards are', async () => {
    const user = await customizing();
    for (const title of ['Top movers', 'SERP features', 'Citation share by domain type', 'Collection status']) {
      const dialog = await openCatalog(user);
      await user.click(within(dialog).getByRole('button', { name: `Add ${title}` }));
      await closed();
    }
    expect(stateOf()).toBe('customize 4');
    await user.click(within(box()).getByRole('button', { name: 'Open at start' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add card' });
    const full = within(rowOf(dialog, 'Share of voice')).getByRole('button', { name: 'Page is full' });
    expect(full).toBeDisabled();
    expect(within(rowOf(dialog, 'Top movers')).getByRole('button', { name: 'Added' })).toBeDisabled();
  });

  it('marks a type added within 30 days with New', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
    const user = await customizing();
    const dialog = await openCatalog(user);
    expect(within(rowOf(dialog, 'Top movers')).getByText('New')).toBeVisible();
    expect(within(rowOf(dialog, 'Key changes')).queryByText('New')).not.toBeInTheDocument();
  });

  it('shows no New badge from day 30', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T09:00:00Z'));
    const user = await customizing();
    const dialog = await openCatalog(user);
    expect(within(dialog).queryByText('New')).not.toBeInTheDocument();
  });

  it('searches titles and descriptions, announces the count and says No cards match with the query', async () => {
    const user = await customizing();
    const dialog = await openCatalog(user);
    await user.type(searchField(dialog), 'top mov');
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1);
    expect(within(dialog).getByText('Top movers')).toBeVisible();
    // One group is left, the others are dropped
    expect(within(dialog).getAllByRole('heading', { level: 3 })).toHaveLength(1);
    await waitFor(() => {
      expect(polite()).toBe('1 card matches');
    });

    await user.clear(searchField(dialog));
    await user.type(searchField(dialog), 'zzz');
    expect(within(dialog).getByText('No cards match “zzz”')).toBeVisible();
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0);
    await waitFor(() => {
      expect(polite()).toBe('No cards match “zzz”');
    });
  });

  it('announces a quick run of typing once, after a pause, and not again when the count stays', async () => {
    const user = await customizing();
    const dialog = await openCatalog(user);
    const region = document.getElementById('live-region-polite');
    if (region === null) throw new Error('no live region');
    const spoken: string[] = [];
    const watch = new MutationObserver(() => {
      if (region.textContent !== '') spoken.push(region.textContent);
    });
    watch.observe(region, { childList: true, characterData: true, subtree: true });
    const search = searchField(dialog);
    const type = (value: string): void => {
      act(() => {
        fireEvent.change(search, { target: { value } });
      });
    };
    const pass = async (ms: number): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      type('t');
      type('to');
      type('top mov');
      await pass(299);
      expect(spoken).toEqual([]);
      await pass(1);
      expect(spoken).toEqual(['1 card matches']);

      // Still one card: the same sentence is not read out a second time
      type('top move');
      await pass(500);
      expect(spoken).toEqual(['1 card matches']);
    } finally {
      watch.disconnect();
      vi.useRealTimers();
    }
  });

  it('keeps focus on the opener after Escape once an earlier add has closed the dialog', async () => {
    const user = await customizing();
    const dialog = await openCatalog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Add Top movers' }));
    await closed();
    await openCatalog(user);
    await user.keyboard('{Escape}');
    await closed();
    expect(slot()).toHaveFocus();
  });

  it('starts empty each time it opens', async () => {
    const user = await customizing();
    let dialog = await openCatalog(user);
    await user.type(searchField(dialog), 'zzz');
    await user.keyboard('{Escape}');
    await closed();
    dialog = await openCatalog(user);
    expect(searchField(dialog)).toHaveValue('');
  });

  it('names every Add button for its card', async () => {
    const user = await customizing();
    const dialog = await openCatalog(user);
    const names = within(dialog)
      .getAllByRole('button')
      .filter((button) => button.textContent === 'Add')
      .map((button) => button.getAttribute('aria-label'));
    expect(names.length).toBeGreaterThan(5);
    // Every button that says Add also says which card; the card's own name is not "New" or its description
    expect(names).toContain('Add Top movers');
    expect(names).toContain('Add Share of voice');
    expect(names.every((name) => name?.startsWith('Add ') === true)).toBe(true);
  });

  it('closes when customize mode ends', async () => {
    const user = await customizing();
    await openCatalog(user);
    // The window narrows below 768 px: a clean customize mode ends, and the dialog goes with it
    act(() => {
      viewport.setWidth(40);
    });
    await closed();
    expect(stateOf()).toBe('view 0');
  });

  it('has no axe violation while open', async () => {
    const user = await customizing();
    await openCatalog(user);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
