import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutGrid } from './layout-grid';
import { LayoutProvider, useLayoutScreen } from './layout-provider';
import { defineCards } from './registry';
import { announce } from '@/lib/a11y/announcer';
import type * as Announcer from '@/lib/a11y/announcer';
import type { CardItem } from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

/** The real announcer, watched: the live region still gets every message, and a double announcement can be counted. */
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const original = await importOriginal<typeof Announcer>();
  return { ...original, announce: vi.fn(original.announce) };
});

const WORKSPACE = MOCK_WORKSPACE.workspace_id;

const CARDS: CardItem[] = [
  { id: 'movers', type: 'seo.top_movers', width: 'half' },
  { id: 'trend-chatgpt', type: 'ai.mention_trend', width: 'half', options: { engine: 'chatgpt_web' } },
  { id: 'trend-gemini', type: 'ai.mention_trend', width: 'half', options: { engine: 'gemini_web' } },
  { id: 'changes', type: 'activity.key_changes', width: 'half', options: { rows: '8' } },
  { id: 'rank', type: 'seo.rank_distribution', width: 'third' },
];

function Enter(): ReactElement {
  const { actions, canCustomize } = useLayoutScreen();
  return (
    <button type="button" disabled={!canCustomize} onClick={actions.enter}>
      Customize
    </button>
  );
}

async function customize(cards: CardItem[] = CARDS): Promise<ProvidedRender> {
  server.use(
    http.get(mswPath(`/api/v1/workspaces/${WORKSPACE}/layouts/overview`), () =>
      HttpResponse.json(
        {
          data: {
            screen: 'overview',
            source: 'personal',
            document: { schema: 1, numbers: [], cards },
            team_default_exists: false,
            team_document: null,
            updated_at: '2026-11-10T09:12:44Z',
            updated_by: { user_id: '0000005a-7c1e-4a52-9b3d-00000000005a', name: 'Mara Voss' },
          },
        },
        { headers: { etag: '"e1"' } },
      ),
    ),
  );
  const view = renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <LayoutProvider
        screen="overview"
        workspaceId={WORKSPACE}
        capabilities={{ channels: ['seo', 'ai'], permissions: [], integrations: [] }}
        registry={defineCards({})}
      >
        <Enter />
        <LayoutGrid label="Cards" />
      </LayoutProvider>
    </PermissionProvider>,
  );
  const enter = screen.getByRole('button', { name: 'Customize' });
  await waitFor(() => {
    expect(enter).toBeEnabled();
  });
  await view.user.click(enter);
  await waitFor(() => {
    expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
  });
  return view;
}

const polite = (): string => document.getElementById('live-region-polite')?.textContent ?? '';
/** Every sentence sent to the announcer since the test began, but the one of entering customize mode. */
const said = (): string[] =>
  vi
    .mocked(announce)
    .mock.calls.map(([message]) => message)
    .filter((message) => !message.startsWith('Customizing'));
const toolbarOf = (id: string): HTMLElement => {
  const frame = document.querySelector<HTMLElement>(`[data-layout-card="${id}"]`);
  if (frame === null) throw new Error(`no frame for ${id}`);
  return within(frame).getByRole('group');
};

/** Opens the Options popover of a card and returns it. */
async function openOptions(view: ProvidedRender, id: string, card: string): Promise<HTMLElement> {
  await view.user.click(within(toolbarOf(id)).getByRole('button', { name: `Options for ${card}` }));
  return screen.findByRole('dialog', { name: `Options for ${card}` });
}

beforeEach(() => {
  vi.mocked(announce).mockClear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CardOptionsPopover', () => {
  it('opens from the Options button with one radio group per option, the legend being the option label', async () => {
    const view = await customize();
    const popover = await openOptions(view, 'movers', 'Top movers');
    const show = within(popover).getByRole('radiogroup', { name: 'Show' });
    expect(within(show).getAllByRole('radio')).toHaveLength(3);
    expect(within(show).getByRole('radio', { name: 'Improved and declined' })).toBeChecked();
    expect(within(show).getByRole('radio', { name: 'Improved only' })).not.toBeChecked();
    const rows = within(popover).getByRole('radiogroup', { name: 'Rows' });
    expect(within(rows).getByRole('radio', { name: '5 rows' })).toBeChecked();
    expect(within(rows).getByRole('radio', { name: '10 rows' })).not.toBeChecked();
    expect(within(popover).getAllByRole('radiogroup')).toHaveLength(2);
  });

  it('shows the value the card has, not the default', async () => {
    const view = await customize();
    const popover = await openOptions(view, 'changes', 'Key changes');
    expect(within(popover).getByRole('radio', { name: '8 rows' })).toBeChecked();
    expect(within(popover).getByRole('radio', { name: '5 rows' })).not.toBeChecked();
  });

  it('applies a choice at once, says it once, and keeps the popover open for the next option', async () => {
    const view = await customize();
    const popover = await openOptions(view, 'movers', 'Top movers');
    await view.user.click(within(popover).getByRole('radio', { name: 'Improved only' }));
    await waitFor(() => {
      expect(polite()).toBe('Top movers: Show Improved only');
    });
    // The provider already says it: the popover adds nothing
    expect(said()).toEqual(['Top movers: Show Improved only']);
    await waitFor(() => {
      expect(within(popover).getByRole('radio', { name: 'Improved only' })).toBeChecked();
    });
    expect(screen.getByRole('dialog', { name: 'Options for Top movers' })).toBe(popover);

    await view.user.click(within(popover).getByRole('radio', { name: '10 rows' }));
    await waitFor(() => {
      expect(polite()).toBe('Top movers: Rows 10 rows');
    });
    expect(said()).toEqual(['Top movers: Show Improved only', 'Top movers: Rows 10 rows']);
    expect(within(popover).getByRole('radio', { name: 'Improved only' })).toBeChecked();
    expect(within(popover).getByRole('radio', { name: '10 rows' })).toBeChecked();
  });

  it('disables the engine another instance has, with the reason, and leaves the free ones', async () => {
    const view = await customize();
    const popover = await openOptions(view, 'trend-gemini', 'Mention rate trend: Gemini');
    const chatgpt = within(popover).getByRole('radio', { name: 'ChatGPT' });
    expect(chatgpt).toHaveAttribute('aria-disabled', 'true');
    expect(chatgpt).toHaveAccessibleDescription('Already on this page');
    expect(within(popover).getByRole('radio', { name: 'Gemini' })).toBeChecked();
    expect(within(popover).getByRole('radio', { name: 'Gemini' })).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(popover).getByRole('radio', { name: 'AI Mode' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('does not change the card when a taken engine is clicked', async () => {
    const view = await customize();
    const popover = await openOptions(view, 'trend-gemini', 'Mention rate trend: Gemini');
    const said = polite();
    await view.user.click(within(popover).getByRole('radio', { name: 'ChatGPT' }));
    expect(within(popover).getByRole('radio', { name: 'Gemini' })).toBeChecked();
    expect(within(popover).getByRole('radio', { name: 'ChatGPT' })).not.toBeChecked();
    expect(polite()).toBe(said);
  });

  it('disables the engine of the second instance for the first instance too', async () => {
    const view = await customize();
    const popover = await openOptions(view, 'trend-chatgpt', 'Mention rate trend: ChatGPT');
    expect(within(popover).getByRole('radio', { name: 'Gemini' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(popover).getByRole('radio', { name: 'Gemini' })).toHaveAccessibleDescription('Already on this page');
    expect(within(popover).getByRole('radio', { name: 'ChatGPT' })).toBeChecked();
  });

  it('renames the card when the engine changes: AI Mode', async () => {
    const view = await customize();
    const popover = await openOptions(view, 'trend-gemini', 'Mention rate trend: Gemini');
    await view.user.click(within(popover).getByRole('radio', { name: 'AI Mode' }));
    await waitFor(() => {
      expect(polite()).toBe('Mention rate trend: AI Mode: Engine AI Mode');
    });
    expect(screen.getByRole('group', { name: 'Mention rate trend: AI Mode card' })).toBeInTheDocument();
    // The engine it left is free again
    expect(within(popover).getByRole('radio', { name: 'Gemini' })).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(popover).getByRole('radio', { name: 'AI Mode' })).toBeChecked();
  });

  it('keeps focus on the radio an arrow key chose, so the next arrow key works', async () => {
    const view = await customize();
    const popover = await openOptions(view, 'changes', 'Key changes');
    within(popover).getByRole('radio', { name: '8 rows' }).focus();
    await view.user.keyboard('{ArrowUp}');
    await waitFor(() => {
      expect(polite()).toBe('Key changes: Rows 5 rows');
    });
    expect(within(popover).getByRole('radio', { name: '5 rows' })).toBeChecked();
    expect(within(popover).getByRole('radio', { name: '5 rows' })).toHaveFocus();
    await view.user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(within(popover).getByRole('radio', { name: '8 rows' })).toBeChecked();
    });
    expect(within(popover).getByRole('radio', { name: '8 rows' })).toHaveFocus();
  });

  it('changes two options from the keyboard in one visit, then Escape returns to the Options button', async () => {
    const view = await customize();
    const popover = await openOptions(view, 'movers', 'Top movers');
    within(popover).getByRole('radio', { name: 'Improved and declined' }).focus();
    await view.user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(within(popover).getByRole('radio', { name: 'Improved only' })).toHaveFocus();
    });
    await view.user.tab();
    expect(within(popover).getByRole('radio', { name: '5 rows' })).toHaveFocus();
    await view.user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(within(popover).getByRole('radio', { name: '10 rows' })).toHaveFocus();
    });
    expect(within(popover).getByRole('radio', { name: 'Improved only' })).toBeChecked();
    expect(within(popover).getByRole('radio', { name: '10 rows' })).toBeChecked();
    // One region, one key: the second sentence replaces the first there, and both were said
    expect(said()).toEqual(['Top movers: Show Improved only', 'Top movers: Rows 10 rows']);
    expect(polite()).toBe('Top movers: Rows 10 rows');

    await view.user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(within(toolbarOf('movers')).getByRole('button', { name: 'Options for Top movers' })).toHaveFocus();
  });

  it('has no accessibility violations while open', async () => {
    const view = await customize();
    const popover = await openOptions(view, 'trend-gemini', 'Mention rate trend: Gemini');
    expect(await axe(popover)).toHaveNoViolations();
  });
});
