import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutProvider, useLayoutScreen, type LayoutContextValue } from '../layout-provider';
import { defineCards } from '../registry';
import { NumberStrip, type NumberValue } from './number-strip';
import { ENGINES, NUMBER_TYPES, SCREENS, type Capabilities, type LayoutDocument, type NumberItem } from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const READ = mswPath(`/api/v1/workspaces/${WORKSPACE}/layouts/overview`);
const CAPABILITIES: Capabilities = { channels: ['seo', 'ai'], permissions: [], integrations: [] };
const CARDS = SCREENS.overview.builtin.cards ?? [];

const VISIBILITY: NumberItem = { id: 'visibility', metric: 'seo.visibility_volume' };
const TOP10: NumberItem = { id: 'top10', metric: 'seo.top10_count' };
const AIO: NumberItem = { id: 'aio-citation', metric: 'seo.aio_citation_rate' };
const CHATGPT: NumberItem = { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' };
const GEMINI: NumberItem = { id: 'mention-gemini', metric: 'ai.mention_rate', engine: 'gemini_web' };
const AI_MODE: NumberItem = { id: 'mention-ai-mode', metric: 'ai.mention_rate', engine: 'google_ai_mode' };

function serve(numbers: NumberItem[]): void {
  const document: LayoutDocument = { schema: 1, numbers, cards: [...CARDS] };
  server.use(
    http.get(READ, () =>
      HttpResponse.json(
        {
          data: {
            screen: 'overview',
            source: 'personal',
            document,
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
}

const valueOf = (item: NumberItem): NumberValue => ({ value: `value ${item.id}`, context: `context ${item.id}` });

let latest: LayoutContextValue | null = null;
function Spy(): null {
  const value = useLayoutScreen();
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
const orderOf = (): string[] => (latest?.document.numbers ?? []).map((item) => item.id);

function Customize(): ReactElement {
  const { actions, canCustomize } = useLayoutScreen();
  return (
    <button type="button" disabled={!canCustomize} onClick={actions.enter}>
      Customize
    </button>
  );
}

// No `renderAddSlot`: the strip draws the slot of this part itself
function mount(numbers: NumberItem[]): ProvidedRender {
  serve(numbers);
  latest = null;
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <LayoutProvider screen="overview" workspaceId={WORKSPACE} capabilities={CAPABILITIES} registry={defineCards({})}>
        <Customize />
        <Spy />
        <NumberStrip label="Overview numbers" valueOf={valueOf} status="ready" />
      </LayoutProvider>
    </PermissionProvider>,
  );
}

async function customize(view: ProvidedRender): Promise<void> {
  const button = screen.getByRole('button', { name: 'Customize' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  await view.user.click(button);
  await waitFor(() => {
    expect(latest?.mode).toBe('customize');
  });
}

function focusOn(element: HTMLElement): void {
  act(() => {
    element.focus();
  });
}

const slot = (): HTMLElement => screen.getByRole('button', { name: 'Add number' });
const handleOf = (name: string): HTMLElement => screen.getByRole('button', { name: `Reorder ${name}` });

/** Opens the catalog and waits for focus to move inside it, so a key pressed next goes to the popover. */
async function openCatalog(view: ProvidedRender): Promise<HTMLElement> {
  await view.user.click(slot());
  const dialog = await screen.findByRole('dialog', { name: 'Add a headline number' });
  await waitFor(() => {
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
  return dialog;
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the Add number slot', () => {
  it('shows under six numbers, after the last one, and is gone at six', async () => {
    const five = mount([VISIBILITY, TOP10, AIO, CHATGPT, GEMINI]);
    await customize(five);
    expect(slot()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(slot()).toHaveAttribute('data-add-number-slot');
    five.unmount();

    const six = mount([VISIBILITY, TOP10, AIO, CHATGPT, GEMINI, AI_MODE]);
    await customize(six);
    expect(screen.queryByRole('button', { name: 'Add number' })).toBeNull();
  });

  it('is the only thing in the strip when there are no numbers, and is not there in view mode', async () => {
    const view = mount([]);
    await waitFor(() => {
      expect(latest?.status).toBe('ready');
    });
    expect(screen.queryByRole('button', { name: 'Add number' })).toBeNull();
    await customize(view);
    expect(slot()).toBeInTheDocument();
  });
});

describe('the number catalog', () => {
  it('lists the screen’s SEO numbers, then the AI metrics with one chip for each engine', async () => {
    const view = mount([VISIBILITY]);
    await customize(view);
    const dialog = await openCatalog(view);

    const seo = within(dialog).getByRole('group', { name: 'SEO' });
    const seoLabels = NUMBER_TYPES.filter((type) => type.screens.includes('overview') && !type.perEngine).map(
      (type) => type.label,
    );
    expect(
      within(seo)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(seoLabels);

    const ai = within(dialog).getByRole('group', { name: 'AI, one engine each' });
    const aiTypes = NUMBER_TYPES.filter((type) => type.screens.includes('overview') && type.perEngine);
    for (const type of aiTypes) {
      const row = within(ai).getByRole('group', { name: type.label });
      expect(
        within(row)
          .getAllByRole('button')
          .map((chip) => chip.getAttribute('aria-label')),
      ).toEqual(ENGINES.map((engine) => `${type.label} ${engine.label}`));
      // the mark of the engine and its name are both on the chip
      for (const chip of within(row).getAllByRole('button')) expect(chip.querySelector('img')).not.toBeNull();
    }
    // SEO comes first, the AI rows after it
    expect(seo.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('never offers an AI number that is not for one engine, and never google_ai_overview', async () => {
    const view = mount([]);
    await customize(view);
    const dialog = await openCatalog(view);
    const engineChips = within(dialog).getAllByRole('button', {
      name: /^(Mention|Citation|Recommendation) |^Share of voice /,
    });
    expect(engineChips).toHaveLength(4 * ENGINES.length);
    expect(within(dialog).queryByRole('button', { name: /AI Overview/i })).toBeNull();
    expect(
      within(dialog).queryByRole('button', {
        name: /^(Mention rate|Citation rate|Recommendation rate|Share of voice)$/,
      }),
    ).toBeNull();
    expect(dialog.innerHTML).not.toContain('google_ai_overview');
    expect(ENGINES.map((engine) => engine.code)).not.toContain('google_ai_overview');
  });

  it('disables a number that is already shown and describes it as Already shown', async () => {
    const view = mount([TOP10, CHATGPT]);
    await customize(view);
    const dialog = await openCatalog(view);
    for (const name of ['Top 10', 'Mention rate ChatGPT']) {
      const chip = within(dialog).getByRole('button', { name });
      expect(chip).toBeDisabled();
      expect(chip).toHaveAccessibleDescription('Already shown');
    }
    // the same metric for another engine is a different number
    expect(within(dialog).getByRole('button', { name: 'Mention rate Gemini' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Top 3' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Top 3' })).not.toHaveAccessibleDescription('Already shown');
  });

  it('says how many places are left', async () => {
    const view = mount([VISIBILITY, TOP10, AIO, CHATGPT, GEMINI]);
    await customize(view);
    const dialog = await openCatalog(view);
    expect(within(dialog).getByText('1 of 6 places left.')).toBeInTheDocument();
  });

  it('adds an SEO number at the end, closes without giving focus back to the slot, and focuses the new number', async () => {
    const view = mount([VISIBILITY, TOP10]);
    await customize(view);
    const dialog = await openCatalog(view);
    await view.user.click(within(dialog).getByRole('button', { name: 'Top 3' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(orderOf()).toHaveLength(3);
    expect(latest?.document.numbers?.at(-1)).toMatchObject({ metric: 'seo.top3_count' });
    await waitFor(() => {
      expect(handleOf('Top 3')).toHaveFocus();
    });
    expect(document.getElementById('live-region-polite')).toHaveTextContent('Top 3 added');
    // the slot has not taken focus back after the popover finished closing
    expect(slot()).not.toHaveFocus();
  });

  it('adds an AI number for the engine chosen, and not for any other', async () => {
    const view = mount([TOP10]);
    await customize(view);
    const dialog = await openCatalog(view);
    await view.user.click(within(dialog).getByRole('button', { name: 'Citation rate Gemini' }));
    await waitFor(() => {
      expect(latest?.document.numbers?.at(-1)).toMatchObject({ metric: 'ai.citation_rate', engine: 'gemini_web' });
    });
    expect(latest?.document.numbers).toHaveLength(2);
    await waitFor(() => {
      expect(handleOf('Citation rate Gemini')).toHaveFocus();
    });
  });

  it('works from the keyboard and returns focus to the slot when it is closed with Escape', async () => {
    const view = mount([TOP10]);
    await customize(view);
    focusOn(slot());
    await view.user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Add a headline number' });
    await waitFor(() => {
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    });
    await view.user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(slot()).toHaveFocus();
    });
    expect(orderOf()).toEqual(['top10']);

    // and a chip is chosen with Enter
    await view.user.keyboard('{Enter}');
    const again = await screen.findByRole('dialog', { name: 'Add a headline number' });
    await waitFor(() => {
      expect(again).toContainElement(document.activeElement as HTMLElement);
    });
    const target = within(again).getByRole('button', { name: 'Top 3' });
    focusOn(target);
    await view.user.keyboard('{Enter}');
    await waitFor(() => {
      expect(handleOf('Top 3')).toHaveFocus();
    });
  });

  it('has no violation an automated check can find while it is open', async () => {
    const view = mount([TOP10, CHATGPT]);
    await customize(view);
    await openCatalog(view);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
