import type * as DndKit from '@dnd-kit/core';
import type { DragOverlayProps } from '@dnd-kit/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutProvider, useLayoutScreen, type LayoutContextValue } from '../layout-provider';
import { defineCards } from '../registry';
import { NumberStrip, type NumberValue } from './number-strip';
import type { Capabilities, LayoutDocument, NumberItem } from '@/lib/layouts';
import { SCREENS } from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

/** What the overlay was given for `dropAnimation`, render by render. */
const overlay = vi.hoisted(() => ({ dropAnimations: new Array<unknown>() }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const original = await importOriginal<typeof DndKit>();
  const { createElement } = await import('react');
  return {
    ...original,
    DragOverlay: (props: DragOverlayProps): ReactElement => {
      overlay.dropAnimations.push(props.dropAnimation);
      return createElement(original.DragOverlay, props);
    },
  };
});

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const READ = mswPath(`/api/v1/workspaces/${WORKSPACE}/layouts/overview`);
const SAVE = mswPath(`/api/v1/workspaces/${WORKSPACE}/me/layouts/overview`);
const CAPABILITIES: Capabilities = { channels: ['seo', 'ai'], permissions: [], integrations: [] };
const REGISTRY = defineCards({});
const CARDS = SCREENS.overview.builtin.cards ?? [];

const VISIBILITY: NumberItem = { id: 'visibility', metric: 'seo.visibility_volume' };
const TOP10: NumberItem = { id: 'top10', metric: 'seo.top10_count' };
const AIO: NumberItem = { id: 'aio-citation', metric: 'seo.aio_citation_rate' };
const CHATGPT: NumberItem = { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' };
const GEMINI: NumberItem = { id: 'mention-gemini', metric: 'ai.mention_rate', engine: 'gemini_web' };

const documentOf = (numbers: NumberItem[]): LayoutDocument => ({ schema: 1, numbers, cards: [...CARDS] });

function serve(numbers: NumberItem[]): void {
  server.use(
    http.get(READ, () =>
      HttpResponse.json(
        {
          data: {
            screen: 'overview',
            source: 'personal',
            document: documentOf(numbers),
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

const valueOf = (item: NumberItem): NumberValue => ({
  value: `value ${item.id}`,
  context: `context ${item.id}`,
  href: `/design-system/layouts-live#${item.id}`,
});

let latest: LayoutContextValue | null = null;
function Spy(): null {
  const value = useLayoutScreen();
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
const orderOf = (): string[] => (latest?.document.numbers ?? []).map((item) => item.id);

function Buttons(): ReactElement {
  const { actions, canCustomize } = useLayoutScreen();
  return (
    <>
      <button type="button" disabled={!canCustomize} onClick={actions.enter}>
        Customize
      </button>
      <button
        type="button"
        onClick={() => {
          void actions.save();
        }}
      >
        Save now
      </button>
    </>
  );
}

interface MountOptions {
  numbers: NumberItem[];
  status?: 'loading' | 'ready' | 'refetching';
  slot?: boolean;
}

function mount({ numbers, status = 'ready', slot = false }: MountOptions): ProvidedRender {
  serve(numbers);
  latest = null;
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <LayoutProvider screen="overview" workspaceId={WORKSPACE} capabilities={CAPABILITIES} registry={REGISTRY}>
        <Buttons />
        <Spy />
        <NumberStrip
          label="Overview numbers"
          valueOf={valueOf}
          status={status}
          {...(slot
            ? {
                renderAddSlot: () => (
                  <button type="button" data-add-number-slot="">
                    Add number
                  </button>
                ),
              }
            : {})}
        />
      </LayoutProvider>
    </PermissionProvider>,
  );
}

/** The layout has been read: until then the screen shows the built-in layout. */
const layoutRead = (): Promise<void> =>
  waitFor(() => {
    expect(latest?.status).toBe('ready');
  });

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

/** The cell of a number, by the name of its labelled group. */
const cellOf = (name: string): HTMLElement => {
  const group = screen.getByRole('group', { name: `${name} number` });
  const cell = group.closest<HTMLElement>('[data-layout-number]');
  if (cell === null) throw new Error(`no cell for ${name}`);
  return cell;
};
const handleOf = (name: string): HTMLElement => screen.getByRole('button', { name: `Reorder ${name}` });

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

describe('NumberStrip in view mode', () => {
  it('is a metric strip with one group for each run of the same channel', async () => {
    mount({ numbers: [VISIBILITY, TOP10, CHATGPT, GEMINI, AIO] });
    await screen.findByRole('group', { name: 'Overview numbers' });
    await waitFor(() => {
      expect(screen.getAllByRole('term')).toHaveLength(5);
    });
    const cells = screen.getAllByRole('term').map((term) => term.parentElement);
    // a stronger divider starts a group: where SEO turns to AI and AI turns back to SEO
    expect(cells.map((cell) => cell?.classList.contains('border-border'))).toEqual([false, false, true, false, true]);
  });

  it('labels a number as the page names it, with the mark of its engine beside an AI number', async () => {
    mount({ numbers: [TOP10, CHATGPT] });
    await layoutRead();
    const terms = await screen.findAllByRole('term');
    expect(terms[0]).toHaveTextContent('Top 10');
    expect(terms[1]).toHaveTextContent(/^Mention rate\s*ChatGPT$/);
    expect(terms[1]?.querySelector('img')).not.toBeNull();
    // in a narrow cell the metric label shortens first: the engine, mark and name, keeps its width
    const engine = terms[1]?.querySelector('[data-slot="number-engine"]');
    expect(engine).toHaveClass('shrink-0', 'whitespace-nowrap');
    expect(engine?.querySelector('img')).not.toBeNull();
    expect(terms[0]?.querySelector('img')).toBeNull();
  });

  it('makes each number a link and shows what the page says of its value', async () => {
    mount({ numbers: [TOP10, CHATGPT] });
    await layoutRead();
    expect(await screen.findByRole('link', { name: 'Top 10' })).toHaveAttribute(
      'href',
      '/design-system/layouts-live#top10',
    );
    // the link names the engine too, so the three Mention rate links of a page are told apart
    expect(screen.getByRole('link', { name: /^Mention rate\s*ChatGPT$/ })).toHaveAttribute(
      'href',
      '/design-system/layouts-live#mention-chatgpt',
    );
    expect(screen.getByText('value top10')).toBeInTheDocument();
    expect(screen.getByText('context mention-chatgpt')).toBeInTheDocument();
  });

  it('renders nothing for a page with no numbers', async () => {
    mount({ numbers: [] });
    await layoutRead();
    expect(screen.queryByRole('group', { name: 'Overview numbers' })).toBeNull();
  });

  it('keeps the labels while the values load', async () => {
    mount({ numbers: [TOP10, CHATGPT], status: 'loading' });
    await layoutRead();
    expect(await screen.findByText('Top 10')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Overview numbers' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('value top10')).toBeNull();
  });

  it('draws values as loading until the layout is read, so the built-in numbers are not shown as real', async () => {
    mount({ numbers: [TOP10, CHATGPT] });
    // the layout read has not answered yet: the built-in numbers are there, with bars for values
    expect(screen.getByRole('group', { name: 'Overview numbers' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(/^value /)).toBeNull();
    await layoutRead();
    expect(await screen.findByText('value top10')).toBeInTheDocument();
  });

  it('has no violation an automated check can find', async () => {
    const { container } = mount({ numbers: [VISIBILITY, CHATGPT] });
    await waitFor(() => {
      expect(screen.getAllByRole('term')).toHaveLength(2);
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('NumberStrip in customize mode', () => {
  it('names each number in a group with Reorder, Remove and Move, and keeps the values out of links', async () => {
    const view = mount({ numbers: [TOP10, CHATGPT] });
    await customize(view);
    expect(screen.getByRole('group', { name: 'Overview numbers' })).toBeInTheDocument();
    for (const name of ['Top 10', 'Mention rate ChatGPT']) {
      const group = screen.getByRole('group', { name: `${name} number` });
      expect(within(group).getByRole('button', { name: `Reorder ${name}` })).toBeInTheDocument();
      expect(within(group).getByRole('button', { name: `Remove ${name}` })).toBeInTheDocument();
      expect(within(group).getByRole('button', { name: `Move ${name}` })).toBeInTheDocument();
    }
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('value top10')).toBeInTheDocument();
  });

  it('draws the channel divider where SEO and AI numbers meet, and in no other cell', async () => {
    const view = mount({ numbers: [TOP10, VISIBILITY, CHATGPT, GEMINI] });
    await customize(view);
    const divided = (name: string): boolean => cellOf(name).classList.contains('@5xl:border-l-border');
    expect(
      ['Top 10', 'SEO visibility', 'Mention rate ChatGPT', 'Mention rate Gemini'].map((name) => divided(name)),
    ).toEqual([false, false, true, false]);
  });

  it('shows only the Add number slot when there are no numbers', async () => {
    const view = mount({ numbers: [], slot: true });
    await customize(view);
    expect(screen.getByRole('button', { name: 'Add number' })).toBeInTheDocument();
    expect(
      screen.queryAllByRole('group').filter((group) => group.closest('[data-layout-number]') !== null),
    ).toHaveLength(0);
  });

  it('leaves the slot out at six numbers', async () => {
    const six = [
      VISIBILITY,
      TOP10,
      AIO,
      CHATGPT,
      GEMINI,
      { id: 'mention-ai-mode', metric: 'ai.mention_rate', engine: 'google_ai_mode' } as const,
    ];
    const view = mount({ numbers: [...six], slot: true });
    await customize(view);
    expect(screen.queryByRole('button', { name: 'Add number' })).toBeNull();
  });

  it('puts the slot after the last number while there is room', async () => {
    const view = mount({ numbers: [TOP10, CHATGPT], slot: true });
    await customize(view);
    const slot = screen.getByRole('button', { name: 'Add number' });
    const lastCell = cellOf('Mention rate ChatGPT');
    expect(lastCell.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('removes a number and puts focus on the handle of the next one, says so, and stays in customize mode', async () => {
    const view = mount({ numbers: [VISIBILITY, TOP10, CHATGPT] });
    await customize(view);
    await view.user.click(screen.getByRole('button', { name: 'Remove Top 10' }));
    expect(orderOf()).toEqual(['visibility', 'mention-chatgpt']);
    await waitFor(() => {
      expect(handleOf('Mention rate ChatGPT')).toHaveFocus();
    });
    expect(document.getElementById('live-region-polite')).toHaveTextContent('Top 10 removed');
  });

  it('puts focus on the previous number when the last one is removed, and on the Add number slot when none is left', async () => {
    const view = mount({ numbers: [TOP10, CHATGPT], slot: true });
    await customize(view);
    await view.user.click(screen.getByRole('button', { name: 'Remove Mention rate ChatGPT' }));
    await waitFor(() => {
      expect(handleOf('Top 10')).toHaveFocus();
    });
    await view.user.click(screen.getByRole('button', { name: 'Remove Top 10' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add number' })).toHaveFocus();
    });
  });

  it('moves a number from its Move menu, disables the moves it cannot make, and returns focus to the menu button', async () => {
    const view = mount({ numbers: [VISIBILITY, TOP10, CHATGPT] });
    await customize(view);
    await view.user.click(screen.getByRole('button', { name: 'Move SEO visibility' }));
    const menu = await screen.findByRole('menu');
    await waitFor(() => {
      expect(menu).toContainElement(document.activeElement as HTMLElement);
    });
    expect(within(menu).getByRole('menuitem', { name: /Move earlier/ })).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByRole('menuitem', { name: /Move to start/ })).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByRole('menuitem', { name: /Move to end/ })).not.toHaveAttribute('aria-disabled', 'true');
    await view.user.click(within(menu).getByRole('menuitem', { name: /Move to end/ }));
    expect(orderOf()).toEqual(['top10', 'mention-chatgpt', 'visibility']);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Move SEO visibility' })).toHaveFocus();
    });
    expect(document.getElementById('live-region-polite')).toHaveTextContent('SEO visibility, position 3 of 3');
  });

  it('disables every control while a save is under way', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.put(SAVE, async () => {
        await held;
        return HttpResponse.json({ data: {} });
      }),
    );
    const view = mount({ numbers: [TOP10, CHATGPT] });
    await customize(view);
    // an edit, so that there is something to save
    await view.user.click(screen.getByRole('button', { name: 'Remove Mention rate ChatGPT' }));
    await view.user.click(screen.getByRole('button', { name: 'Save now' }));
    await waitFor(() => {
      expect(latest?.saving).toBe(true);
    });
    for (const name of ['Reorder Top 10', 'Remove Top 10', 'Move Top 10']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    act(() => {
      release();
    });
  });

  it('has no violation an automated check can find', async () => {
    const view = mount({ numbers: [TOP10, CHATGPT], slot: true });
    await customize(view);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

// --- the keyboard: jsdom has no layout, so the cells are laid out here --------------------------------------------

const CELL_WIDTH = 200;
const CELL_HEIGHT = 80;
const placed: { dragging: string | null } = { dragging: null };

function stubCellRects(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const id =
      this.getAttribute('data-layout-number') ??
      (this.getAttribute('data-slot') === 'layout-drag-overlay' ? placed.dragging : null);
    const index = (latest?.document.numbers ?? []).findIndex((item) => item.id === id);
    const left = index === -1 ? 0 : index * CELL_WIDTH;
    const size = index === -1 ? { width: 0, height: 0 } : { width: CELL_WIDTH, height: CELL_HEIGHT };
    return { x: left, y: 0, left, top: 0, right: left + size.width, bottom: size.height, ...size, toJSON: () => ({}) };
  });
}

async function pickUp(view: ProvidedRender, name: string, id: string): Promise<void> {
  placed.dragging = id;
  act(() => {
    handleOf(name).focus();
  });
  await view.user.keyboard(' ');
  await waitFor(() => {
    expect(handleOf(name)).toHaveAttribute('aria-pressed', 'true');
  });
}

describe('moving a number with the keyboard', () => {
  it('picks the number up, names each place as the arrow keys go, and drops it where it is', async () => {
    const view = mount({ numbers: [VISIBILITY, TOP10, CHATGPT] });
    await customize(view);
    stubCellRects();
    await pickUp(view, 'Top 10', 'top10');
    expect(document.getElementById('live-region-polite')).toHaveTextContent('Top 10 picked up');
    expect(cellOf('Top 10')).toHaveClass('ring-2', 'ring-primary');

    await view.user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(document.getElementById('live-region-polite')).toHaveTextContent('Top 10, position 3 of 3');
    });
    expect(orderOf()).toEqual(['visibility', 'top10', 'mention-chatgpt']);

    await view.user.keyboard(' ');
    await waitFor(() => {
      expect(orderOf()).toEqual(['visibility', 'mention-chatgpt', 'top10']);
    });
    expect(document.getElementById('live-region-polite')).toHaveTextContent('Top 10 dropped at position 3 of 3');
    await waitFor(() => {
      expect(handleOf('Top 10')).toHaveFocus();
    });
    expect(handleOf('Top 10')).toHaveAttribute('aria-pressed', 'false');
  });

  it('says a number is already first when Left has nowhere to go, and Escape puts it back', async () => {
    const view = mount({ numbers: [VISIBILITY, TOP10, CHATGPT] });
    await customize(view);
    stubCellRects();
    const seen: boolean[] = [];
    const listener = (event: KeyboardEvent): void => {
      if (event.code === 'Escape') seen.push(event.defaultPrevented);
    };
    window.addEventListener('keydown', listener);
    await pickUp(view, 'SEO visibility', 'visibility');
    await view.user.keyboard('{ArrowLeft}');
    await waitFor(() => {
      expect(document.getElementById('live-region-polite')).toHaveTextContent('SEO visibility is already first');
    });
    await view.user.keyboard('{End}');
    await waitFor(() => {
      expect(document.getElementById('live-region-polite')).toHaveTextContent('SEO visibility, position 3 of 3');
    });
    await view.user.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.getElementById('live-region-polite')).toHaveTextContent('SEO visibility put back');
    });
    window.removeEventListener('keydown', listener);
    expect(orderOf()).toEqual(['visibility', 'top10', 'mention-chatgpt']);
    expect(handleOf('SEO visibility')).toHaveAttribute('aria-pressed', 'false');
    expect(latest?.mode).toBe('customize');
    // The strip marks the held number's Escape as handled, so a shortcut that leaves the mode (it skips a prevented
    // key) does not
    expect(seen).toEqual([true]);
  });

  it('drops the number where it is when Tab is pressed', async () => {
    const view = mount({ numbers: [VISIBILITY, TOP10, CHATGPT] });
    await customize(view);
    stubCellRects();
    await pickUp(view, 'SEO visibility', 'visibility');
    await view.user.keyboard('{ArrowRight}');
    await view.user.keyboard('{Tab}');
    await waitFor(() => {
      expect(document.getElementById('live-region-polite')).toHaveTextContent(
        'SEO visibility dropped at position 2 of 3',
      );
    });
    expect(orderOf()).toEqual(['top10', 'visibility', 'mention-chatgpt']);
    expect(handleOf('SEO visibility')).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows a line where a mouse drag would drop the number, and moves it on release', async () => {
    const view = mount({ numbers: [VISIBILITY, TOP10, CHATGPT] });
    await customize(view);
    stubCellRects();
    placed.dragging = 'visibility';
    const handle = handleOf('SEO visibility');
    fireEvent.mouseDown(handle, { button: 0, clientX: 10, clientY: 10 });
    // the right half of the last cell: after it
    const target = { clientX: 2 * CELL_WIDTH + 150, clientY: 40 };
    fireEvent.mouseMove(document, target);
    fireEvent.mouseMove(document, target);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="layout-drop-line"]')).not.toBeNull();
    });
    fireEvent.mouseUp(document, target);
    await waitFor(() => {
      expect(orderOf()).toEqual(['top10', 'mention-chatgpt', 'visibility']);
    });
    expect(document.querySelector('[data-slot="layout-drop-line"]')).toBeNull();
  });
});

describe('the number strip with reduced motion', () => {
  const scrolled = vi.fn();
  const dragOverlay = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-slot="layout-drag-overlay"]');

  function reduceMotion(): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  beforeEach(async () => {
    // The mouse drag of the test before ends with a mouse up and no click: dnd-kit keeps swallowing the next click
    // for 50 ms, which would be this test's click on Customize
    await new Promise((resolve) => setTimeout(resolve, 60));
    overlay.dropAnimations.length = 0;
    scrolled.mockClear();
    // jsdom has no scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    Reflect.deleteProperty(window.HTMLElement.prototype, 'scrollIntoView');
    delete document.documentElement.dataset.motion;
  });

  it('the number strip drop animation is off with reduced motion, and the keyboard drag does not glide', async () => {
    reduceMotion();
    const view = mount({ numbers: [VISIBILITY, TOP10, CHATGPT] });
    await customize(view);
    stubCellRects();
    expect(overlay.dropAnimations.length).toBeGreaterThan(0);
    expect(overlay.dropAnimations.at(-1)).toBeNull();
    await pickUp(view, 'Top 10', 'top10');
    expect(dragOverlay()?.parentElement?.style.transition).toBe('none');
  });

  it('the number strip drop animation is off when the person turned reduced motion on in the app', async () => {
    document.documentElement.dataset.motion = 'reduced';
    const view = mount({ numbers: [VISIBILITY, TOP10, CHATGPT] });
    await customize(view);
    stubCellRects();
    expect(overlay.dropAnimations.at(-1)).toBeNull();
    await pickUp(view, 'Top 10', 'top10');
    expect(dragOverlay()?.parentElement?.style.transition).toBe('none');
  });

  it('settles the dropped number in 150 ms, and lets dnd-kit glide a keyboard drag, when motion is allowed', async () => {
    const view = mount({ numbers: [VISIBILITY, TOP10, CHATGPT] });
    await customize(view);
    stubCellRects();
    expect(overlay.dropAnimations.at(-1)).toEqual({ duration: 150 });
    await pickUp(view, 'Top 10', 'top10');
    expect(dragOverlay()?.parentElement?.style.transition).toBe('transform 250ms ease');
  });

  it('scrolls to the number that takes focus with behavior auto, and smoothly when motion is allowed', async () => {
    reduceMotion();
    const reduced = mount({ numbers: [VISIBILITY, TOP10, CHATGPT] });
    await customize(reduced);
    await reduced.user.click(screen.getByRole('button', { name: 'Remove Top 10' }));
    await waitFor(() => {
      expect(handleOf('Mention rate ChatGPT')).toHaveFocus();
    });
    expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'auto' });
    reduced.unmount();

    vi.unstubAllGlobals();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const allowed = mount({ numbers: [VISIBILITY, TOP10, CHATGPT] });
    await customize(allowed);
    await allowed.user.click(screen.getByRole('button', { name: 'Remove Top 10' }));
    await waitFor(() => {
      expect(handleOf('Mention rate ChatGPT')).toHaveFocus();
    });
    expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'smooth' });
  });
});
