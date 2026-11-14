import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLayoutScreen } from '../layout-provider';
import { definePresets } from './presets';
import { LIVE_REGION_ID } from '@/lib/a11y/announcer';
import type { LayoutDocument } from '@/lib/layouts';
import { ScreenUnderTest, serveLayouts, startCustomizing, stateOf, stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { renderWithProviders } from '@/test/render';

// The screen's leave guard reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const EXECUTIVE: LayoutDocument = {
  schema: 1,
  numbers: [{ id: 'visibility', metric: 'seo.visibility_volume' }],
  cards: [
    { id: 'trend', type: 'trend.visibility_mentions', width: 'full' },
    { id: 'matrix', type: 'cross.matrix_summary', width: 'half' },
  ],
};
const SEO_FOCUS: LayoutDocument = {
  schema: 1,
  numbers: [{ id: 'top10', metric: 'seo.top10_count' }],
  cards: [{ id: 'ranks', type: 'seo.rank_distribution', width: 'half' }],
};
const PRESETS = definePresets('overview', [
  { id: 'executive', label: 'Executive summary', document: EXECUTIVE },
  { id: 'seo', label: 'SEO focus', document: SEO_FOCUS },
]);

const TEAM: LayoutDocument = { schema: 1, numbers: [], cards: [{ id: 't1', type: 'ai.by_engine', width: 'full' }] };
const WITH_TEAM = { team_default_exists: true, team_document: TEAM };

beforeEach(() => {
  serveLayouts();
  stubViewport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type User = ReturnType<typeof renderWithProviders>['user'];

/** The card types of the draft that renders, in order. */
function DraftProbe(): ReactElement {
  const { document: draft } = useLayoutScreen();
  return <p data-testid="draft">{(draft.cards ?? []).map((card) => card.type).join(',')}</p>;
}
const drafted = (): string => screen.getByTestId('draft').textContent ?? '';

const polite = (): HTMLElement | null => document.getElementById(LIVE_REGION_ID.polite);
const trigger = (): HTMLElement => screen.getByRole('button', { name: 'Start from' });
const isDisabled = (element: HTMLElement): boolean =>
  element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';

/** Opens the menu and waits for focus to move into it before any key is pressed. */
async function openMenu(user: User): Promise<HTMLElement> {
  await user.click(trigger());
  const menu = await screen.findByRole('menu');
  await waitFor(() => {
    expect(menu.contains(document.activeElement)).toBe(true);
  });
  return menu;
}

async function choose(user: User, name: string): Promise<void> {
  const menu = await openMenu(user);
  await user.click(within(menu).getByRole('menuitem', { name }));
  await waitFor(() => {
    expect(screen.queryByRole('menu')).toBeNull();
  });
}

describe('StartFromMenu', () => {
  it('is not rendered when the page has no presets and there is no team default', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    expect(screen.queryByRole('button', { name: 'Start from' })).toBeNull();
  });

  it('lists Built-in default, then the presets of the page in order', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest presets={PRESETS} />);
    await startCustomizing(user);
    const menu = await openMenu(user);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Built-in default', 'Executive summary', 'SEO focus']);
  });

  it('is there for a page without presets once a team default exists, and lists it after the built-in layout', async () => {
    serveLayouts({ layout: WITH_TEAM });
    const { user } = renderWithProviders(<ScreenUnderTest />);
    await startCustomizing(user);
    const menu = await openMenu(user);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Built-in default', 'Team default']);
  });

  it('is only in customize mode', async () => {
    renderWithProviders(<ScreenUnderTest presets={PRESETS} />);
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
    expect(screen.queryByRole('button', { name: 'Start from' })).toBeNull();
  });

  it('choosing a preset replaces the draft, counts as changes and announces it', async () => {
    const served = serveLayouts();
    const { user } = renderWithProviders(<ScreenUnderTest presets={PRESETS} extra={<DraftProbe />} />);
    await startCustomizing(user);
    await choose(user, 'Executive summary');
    expect(drafted()).toBe('trend.visibility_mentions,cross.matrix_summary');
    expect(stateOf()).toMatch(/^customize [1-9]/);
    await waitFor(() => {
      expect(polite()).toHaveTextContent('Executive summary applied. Save to keep it.');
    });
    // Nothing is stored until Save
    expect(served.puts).toEqual([]);
    expect(served.deletes).toEqual([]);
  });

  it('choosing the layout the draft already shows does nothing', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest presets={PRESETS} extra={<DraftProbe />} />);
    await startCustomizing(user);
    await choose(user, 'Executive summary');
    await waitFor(() => {
      expect(polite()).toHaveTextContent('Executive summary applied.');
    });
    const changes = stateOf();
    // The same preset again, and the built-in layout while the draft is the built-in one after an Undo
    await choose(user, 'Executive summary');
    expect(stateOf()).toBe(changes);
    await user.click(within(screen.getByRole('group', { name: /change/ })).getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(stateOf()).toBe('customize 0');
    });
    await choose(user, 'Built-in default');
    expect(stateOf()).toBe('customize 0');
    expect(polite()).not.toHaveTextContent('Built-in default applied');
    expect(
      isDisabled(within(screen.getByRole('group', { name: 'No changes' })).getByRole('button', { name: 'Undo' })),
    ).toBe(true);
  });

  it('applies the team default as a preset', async () => {
    serveLayouts({ layout: { source: 'personal', document: EXECUTIVE, ...WITH_TEAM } });
    const { user } = renderWithProviders(<ScreenUnderTest extra={<DraftProbe />} />);
    await startCustomizing(user);
    expect(drafted()).toBe('trend.visibility_mentions,cross.matrix_summary');
    await choose(user, 'Team default');
    expect(drafted()).toBe('ai.by_engine');
    await waitFor(() => {
      expect(polite()).toHaveTextContent('Team default applied. Save to keep it.');
    });
  });

  it('Undo restores the draft from before the preset, and Redo applies it again', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest presets={PRESETS} extra={<DraftProbe />} />);
    await startCustomizing(user);
    const before = drafted();
    await choose(user, 'SEO focus');
    expect(drafted()).toBe('seo.rank_distribution');
    const group = screen.getByRole('group', { name: /change/ });
    await user.click(within(group).getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(drafted()).toBe(before);
    });
    expect(stateOf()).toBe('customize 0');
    await user.click(within(screen.getByRole('group', { name: 'No changes' })).getByRole('button', { name: 'Redo' }));
    await waitFor(() => {
      expect(drafted()).toBe('seo.rank_distribution');
    });
  });

  it('asks nothing, and puts focus back on the trigger when the menu closes', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest presets={PRESETS} />);
    await startCustomizing(user);
    await choose(user, 'Executive summary');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => {
      expect(trigger()).toHaveFocus();
    });
  });

  it('is disabled while a save is under way', async () => {
    const held = gate();
    serveLayouts({ holdSave: held.promise });
    const { user } = renderWithProviders(<ScreenUnderTest presets={PRESETS} />);
    await startCustomizing(user);
    await choose(user, 'Executive summary');
    await user.click(
      within(screen.getByRole('group', { name: /change/ })).getByRole('button', { name: 'Save layout' }),
    );
    await waitFor(() => {
      expect(isDisabled(trigger())).toBe(true);
    });
    held.open();
    await waitFor(() => {
      expect(stateOf()).toBe('view 0');
    });
  });

  it('makes the preset a change that Cancel asks about', async () => {
    const { user } = renderWithProviders(<ScreenUnderTest presets={PRESETS} />);
    await startCustomizing(user);
    await choose(user, 'Executive summary');
    await user.click(within(screen.getByRole('group', { name: /change/ })).getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
  });
});
