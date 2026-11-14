import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutGrid, SPAN_CLASS, type LayoutGridProps } from './layout-grid';
import type * as LayoutProviderModule from './layout-provider';
import { LayoutProvider, useLayoutScreen, type LayoutContextValue } from './layout-provider';
import { defineCards, type CardProps, type CardRegistry } from './registry';
import {
  SCREENS,
  WIDTHS,
  packRows,
  spanOf,
  type Breakpoint,
  type Capabilities,
  type LayoutDocument,
} from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

/** Lets one test change what the screen's context says (a card type no catalog knows), the rest read it as it is. */
const patch: { current: ((value: LayoutContextValue) => LayoutContextValue) | null } = { current: null };
vi.mock('./layout-provider', async (importOriginal) => {
  const original = await importOriginal<typeof LayoutProviderModule>();
  return {
    ...original,
    useLayoutScreen: (): LayoutContextValue => {
      const value = original.useLayoutScreen();
      return patch.current === null ? value : patch.current(value);
    },
  };
});

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const READ = mswPath(`/api/v1/workspaces/${WORKSPACE}/layouts/overview`);
const BUILTIN = SCREENS.overview.builtin;
const BUILTIN_CARDS = BUILTIN.cards ?? [];
const LABEL = 'Overview cards';

const BOTH: Capabilities = { channels: ['seo', 'ai'], permissions: [], integrations: [] };
const SEO_ONLY: Capabilities = { channels: ['seo'], permissions: [], integrations: [] };

const answer = (document: LayoutDocument | null): object => ({
  screen: 'overview',
  source: document === null ? 'builtin' : 'personal',
  document,
  team_default_exists: false,
  team_document: null,
  updated_at: document === null ? null : '2026-11-10T09:12:44Z',
  updated_by: document === null ? null : { user_id: '0000005a-7c1e-4a52-9b3d-00000000005a', name: 'Mara Voss' },
});

interface Served {
  document: LayoutDocument | null;
  status: 200 | 500;
  /** An answer held until the promise settles. */
  hold: Promise<void> | null;
  reads: number;
}

function serve(document: LayoutDocument | null = null): Served {
  const served: Served = { document, status: 200, hold: null, reads: 0 };
  server.use(
    http.get(READ, async () => {
      served.reads += 1;
      if (served.hold !== null) await served.hold;
      if (served.status === 500) {
        return HttpResponse.json(
          { type: 'about:blank', title: 'Internal', status: 500, code: 'internal' },
          { status: 500 },
        );
      }
      return HttpResponse.json({ data: answer(served.document) }, { headers: { etag: `"e${String(served.reads)}"` } });
    }),
  );
  return served;
}

function TestCard({ item, options, width, mode, live }: CardProps): ReactElement {
  return (
    <div
      data-testid={`body-${item.id}`}
      data-options={JSON.stringify(options)}
      data-width={width ?? 'none'}
      data-mode={mode}
      data-live={String(live)}
    >
      <a href={`#${item.id}`}>{`Link of ${item.id}`}</a>
    </div>
  );
}

/** A registry of its own per test: a lazy card that has loaded once stays loaded. */
function registryOf(types: readonly string[], loads: (type: string) => void = () => undefined): CardRegistry {
  return defineCards(
    Object.fromEntries(
      types.map((type) => [
        type,
        {
          load: () => {
            loads(type);
            return Promise.resolve({ default: TestCard });
          },
        },
      ]),
    ),
  );
}
const BUILTIN_TYPES = BUILTIN_CARDS.map((card) => card.type);

function CustomizeButton(): ReactElement {
  const { actions, canCustomize } = useLayoutScreen();
  return (
    <button type="button" disabled={!canCustomize} onClick={actions.enter}>
      Customize
    </button>
  );
}

/** What the screen's context says now, for the tests that call its actions. */
let latest: LayoutContextValue | null = null;
function Spy(): null {
  const value = useLayoutScreen();
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
const actions = (): LayoutContextValue['actions'] => {
  if (latest === null) throw new Error('the spy has not rendered');
  return latest.actions;
};
const focusRequest = (): LayoutContextValue['focus'] => latest?.focus ?? null;

interface MountOptions {
  capabilities?: Capabilities;
  registry?: CardRegistry;
  grid?: Partial<LayoutGridProps>;
}

function mount({
  capabilities = BOTH,
  registry = registryOf(BUILTIN_TYPES),
  grid = {},
}: MountOptions = {}): ProvidedRender {
  latest = null;
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <LayoutProvider screen="overview" workspaceId={WORKSPACE} capabilities={capabilities} registry={registry}>
        <CustomizeButton />
        <Spy />
        <LayoutGrid label={LABEL} {...grid} />
      </LayoutProvider>
    </PermissionProvider>,
  );
}

const frames = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-layout-card]')];
const frameOf = (id: string): HTMLElement => {
  const frame = document.querySelector<HTMLElement>(`[data-layout-card="${id}"]`);
  if (frame === null) throw new Error(`no frame for ${id}`);
  return frame;
};
const refetchBar = (): Element | null => document.querySelector('[data-slot="layout-refetch-bar"]');

async function cardsShown(count = BUILTIN_CARDS.length): Promise<void> {
  await waitFor(() => {
    expect(document.querySelectorAll('[data-testid^="body-"]')).toHaveLength(count);
  });
}

/** The columns a frame takes at `breakpoint`, read from its classes the way the stylesheet cascades them. */
function spanAt(frame: Element, breakpoint: Breakpoint): number {
  const classes = [...frame.classList];
  const spanOfPrefix = (prefix: string): number | null => {
    const found = classes.find((name) => name.startsWith(`${prefix}col-span-`));
    return found === undefined ? null : Number(found.slice(found.lastIndexOf('-') + 1));
  };
  const base = spanOfPrefix('');
  if (base === null) throw new Error(`no col-span class in ${frame.className}`);
  if (breakpoint === 'narrow') return base;
  const medium = spanOfPrefix('md:') ?? base;
  return breakpoint === 'medium' ? medium : (spanOfPrefix('xl:') ?? medium);
}

beforeEach(() => {
  patch.current = null;
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

describe('LayoutGrid in view mode', () => {
  it('shows the cards of the built-in layout in order, in a region named by the label, each with its span', async () => {
    serve();
    mount();
    await cardsShown();
    const region = screen.getByRole('region', { name: LABEL });
    expect(region.querySelector('.grid-cols-12')).not.toBeNull();
    expect(frames().map((frame) => frame.dataset.layoutCard)).toEqual(BUILTIN_CARDS.map((card) => card.id));
    expect(SPAN_CLASS).toEqual({
      third: 'col-span-12 md:col-span-6 xl:col-span-4',
      half: 'col-span-12 md:col-span-6',
      two_thirds: 'col-span-12 xl:col-span-8',
      full: 'col-span-12',
    });
    for (const card of BUILTIN_CARDS) {
      for (const name of SPAN_CLASS[card.width ?? 'full'].split(' ')) expect(frameOf(card.id)).toHaveClass(name);
    }
  });

  it('gives the CSS grid the same rows as packRows, at every breakpoint, for every width', async () => {
    serve();
    mount();
    await cardsShown();
    for (const breakpoint of ['wide', 'medium', 'narrow'] as const) {
      const spans = frames().map((frame) => spanAt(frame, breakpoint));
      const rows = packRows(BUILTIN_CARDS, breakpoint);
      let at = 0;
      const actual = rows.map((row) => row.map(() => spans[at++]));
      expect(actual).toEqual(rows.map((row) => row.map((placed) => placed.span)));
    }
    for (const width of WIDTHS) {
      for (const breakpoint of ['wide', 'medium', 'narrow'] as const) {
        const probe = document.createElement('div');
        probe.className = SPAN_CLASS[width];
        expect(spanAt(probe, breakpoint)).toBe(spanOf(width, breakpoint));
      }
    }
  });

  it('is one column with no spans for columns="one"', async () => {
    serve();
    mount({ grid: { columns: 'one' } });
    await cardsShown();
    const region = screen.getByRole('region', { name: LABEL });
    expect(region.querySelector('.grid-cols-12')).toBeNull();
    expect(region.querySelector('.flex-col')).not.toBeNull();
    expect(frames().every((frame) => !/col-span/.test(frame.className))).toBe(true);
  });

  it('hands every card its item, its options with every key set, its width, the mode and live', async () => {
    serve();
    mount();
    await cardsShown();
    const body = screen.getByTestId('body-key-changes');
    expect(body).toHaveAttribute('data-options', '{"rows":"8"}');
    expect(body).toHaveAttribute('data-width', 'half');
    expect(body).toHaveAttribute('data-mode', 'view');
    expect(body).toHaveAttribute('data-live', 'true');
    expect(screen.getByTestId('body-trend')).toHaveAttribute('data-options', '{}');
    expect(screen.getByTestId('body-trend')).toHaveAttribute('data-width', 'two_thirds');
  });

  it('does not make the card content inert', async () => {
    serve();
    mount();
    await cardsShown();
    expect(screen.getByRole('link', { name: 'Link of trend' }).closest('[inert]')).toBeNull();
  });

  it('skips the cards the project cannot show', async () => {
    serve();
    mount({ capabilities: SEO_ONLY });
    await waitFor(() => {
      expect(frames().length).toBeGreaterThan(0);
    });
    expect(frames().length).toBeLessThan(BUILTIN_CARDS.length);
    expect(document.querySelector('[data-layout-card="ai-by-engine"]')).toBeNull();
  });

  it('says a card the registry does not know is not available yet, with no error', async () => {
    serve();
    mount({ registry: registryOf(['trend.visibility_mentions']) });
    await waitFor(() => {
      expect(frames()).toHaveLength(BUILTIN_CARDS.length);
    });
    await screen.findByTestId('body-trend');
    expect(screen.getAllByText('This card is not available yet.')).toHaveLength(BUILTIN_CARDS.length - 1);
    expect(within(screen.getByRole('region', { name: LABEL })).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('treats a type named like an Object property as not registered (hasOwn, not an index)', async () => {
    serve();
    patch.current = (value) => ({
      ...value,
      shownCards: [{ id: 'odd', type: 'constructor', width: 'half' }],
    });
    mount();
    await screen.findByText('This card is not available yet.');
    expect(frames()).toHaveLength(1);
  });

  it('has no accessibility violations', async () => {
    serve();
    const view = mount();
    await cardsShown();
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe('lazy mount', () => {
  type Report = (isIntersecting: boolean) => void;
  const observers: { node: Element; report: Report }[] = [];

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private readonly callback: IntersectionObserverCallback) {}
        observe(node: Element): void {
          observers.push({
            node,
            report: (isIntersecting) => {
              act(() => {
                this.callback(
                  [{ isIntersecting } as IntersectionObserverEntry],
                  this as unknown as IntersectionObserver,
                );
              });
            },
          });
        }
        disconnect(): void {}
      },
    );
  });

  it('loads a card only once it is within a viewport of the screen', async () => {
    serve();
    const loaded: string[] = [];
    mount({ registry: registryOf(BUILTIN_TYPES, (type) => loaded.push(type)) });
    await waitFor(() => {
      expect(observers).toHaveLength(BUILTIN_CARDS.length);
    });
    expect(loaded).toEqual([]);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);

    const trend = observers.find((observer) => frameOf('trend').contains(observer.node));
    if (trend === undefined) throw new Error('the trend card is not observed');
    trend.report(false);
    expect(loaded).toEqual([]);
    trend.report(true);
    await screen.findByTestId('body-trend');
    expect(loaded).toEqual(['trend.visibility_mentions']);
    expect(screen.queryByTestId('body-matrix')).not.toBeInTheDocument();
  });
});

describe('LayoutGrid states', () => {
  it('shows the cards of the built-in layout as skeletons in a status while it loads, with no spinner', async () => {
    const served = serve();
    const held = gate();
    served.hold = held.promise;
    mount();
    const status = await screen.findByRole('status', { name: 'Loading Overview cards' });
    expect(status.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(BUILTIN_CARDS.length);
    expect(document.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(document.querySelector('[data-testid^="body-"]')).toBeNull();
    held.open();
    await cardsShown();
    expect(screen.queryByRole('status', { name: 'Loading Overview cards' })).not.toBeInTheDocument();
  });

  it('says the layout could not be read, shows the default and reads again on Try again', async () => {
    const served = serve();
    served.status = 500;
    const view = mount();
    expect(await screen.findByText('Your layout could not be loaded. Showing the default.')).toBeInTheDocument();
    // Said once, with one way to read again
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    await cardsShown();
    expect(await axe(view.container)).toHaveNoViolations();

    served.status = 200;
    await view.user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.queryByText('Your layout could not be loaded. Showing the default.')).not.toBeInTheDocument();
    });
    expect(served.reads).toBe(2);
  });

  it('keeps the cards and shows the 2 px bar while a read is under way', async () => {
    const served = serve();
    const view = mount();
    await cardsShown();
    expect(refetchBar()).toBeNull();

    const held = gate();
    served.hold = held.promise;
    void view.queryClient.invalidateQueries();
    await waitFor(() => {
      expect(refetchBar()).not.toBeNull();
    });
    expect(refetchBar()).toHaveClass('absolute', 'inset-x-0', 'top-0', 'h-0.5', 'bg-primary');
    expect(screen.queryByRole('status', { name: 'Loading Overview cards' })).not.toBeInTheDocument();
    expect(frames()).toHaveLength(BUILTIN_CARDS.length);

    held.open();
    await waitFor(() => {
      expect(refetchBar()).toBeNull();
    });
    expect(frames()).toHaveLength(BUILTIN_CARDS.length);
  });

  it('says there are no cards, and offers the action it is given', async () => {
    serve({ schema: 1, numbers: [], cards: [] });
    mount({ grid: { emptyAction: <button type="button">Add cards</button> } });
    const empty = await screen.findByText('No cards are shown on this page.');
    expect(empty).toBeInTheDocument();
    expect(screen.getByText('This page has no cards. Add one from the catalog.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add cards' })).toBeInTheDocument();
    expect(frames()).toHaveLength(0);
  });

  it('counts the cards of the layout that are not available when none can be shown', async () => {
    serve({ schema: 1, numbers: [], cards: [{ id: 'by-engine', type: 'ai.by_engine', width: 'half' }] });
    mount({ capabilities: SEO_ONLY });
    expect(await screen.findByText('No cards are shown on this page.')).toBeInTheDocument();
    expect(screen.getByText('1 card of this layout is not available in this project.')).toBeInTheDocument();
    expect(frames()).toHaveLength(0);
  });
});

/** Waits for the layout to be read, then enters customize mode the way a person does. */
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

describe('LayoutGrid in customize mode', () => {
  // jsdom 30 and user-event 14 do not know `inert` (jsdom's focusing.js says so in a TODO), so `user.tab()` would
  // still land in a card body here; the browser run of the e2e flow walks the tab order. This test holds the
  // markup that makes the browser skip it: every link of a card body has an inert ancestor, no frame control has.
  it('puts every card body out of reach with inert and leaves the frame controls reachable', async () => {
    serve();
    const view = mount();
    await customize(view);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(BUILTIN_CARDS.length);
    expect(links.every((link) => link.closest('[inert]') !== null)).toBe(true);
    for (const control of within(frameOf('trend')).getAllByRole('button')) {
      expect(control.closest('[inert]')).toBeNull();
    }
    expect(screen.getByTestId('body-trend')).toHaveAttribute('data-mode', 'customize');
    expect(screen.getByTestId('body-trend')).toHaveAttribute('data-live', 'false');
    expect(frameOf('trend')).toHaveClass('outline-dashed', 'bg-surface-subtle', 'rounded-lg', 'p-1');
  });

  it('shows an unavailable card with its reason, or with what renderUnavailable makes of it', async () => {
    serve();
    const view = mount({ capabilities: SEO_ONLY });
    await customize(view);
    const reason = within(frameOf('ai-by-engine')).getByText('AI tracking is off in this project');
    // Outside the inert body, so a screen reader still reads it
    expect(reason.closest('[inert]')).toBeNull();
    view.unmount();

    serve();
    const custom = mount({
      capabilities: SEO_ONLY,
      grid: {
        renderUnavailable: (item, reason) => (
          <p>
            {`${item.id}: ${reason}`} <a href="#connect">Connect</a>
          </p>
        ),
      },
    });
    await customize(custom);
    const shown = within(frameOf('ai-by-engine'));
    expect(shown.getByText(/ai-by-engine: AI tracking is off in this project/)).toBeInTheDocument();
    expect(shown.getByRole('link', { name: 'Connect' }).closest('[inert]')).toBeNull();
  });

  it('lets a card body fill the height of its frame, so a row shares its tallest card', async () => {
    serve();
    const view = mount();
    await cardsShown();
    const fills = (): void => {
      const wrapper = screen.getByTestId('body-trend').parentElement;
      // A column that stretches the card's own surface (its border): a block would leave the surface at its content
      expect(wrapper).toHaveClass('h-full', 'flex', 'flex-col', '*:flex-1');
      expect(wrapper?.parentElement).toHaveClass('flex', 'flex-col', 'flex-1');
    };
    fills();
    await customize(view);
    fills();
    expect(screen.getByTestId('body-trend').parentElement?.parentElement).toHaveAttribute('inert');
  });

  it('measures the customize grid, so what is placed inside it is placed against the grid', async () => {
    serve();
    const view = mount();
    await customize(view);
    expect(frameOf('trend').parentElement).toHaveClass('relative', 'grid-cols-12');
  });

  it('wraps each card body in the CardBoundary it is given', async () => {
    serve();
    const view = mount({
      grid: {
        CardBoundary: ({ item, children }) => <div data-testid={`boundary-${item.id}`}>{children}</div>,
      },
    });
    await cardsShown();
    expect(within(screen.getByTestId('boundary-trend')).getByTestId('body-trend')).toBeInTheDocument();
    await customize(view);
    expect(within(screen.getByTestId('boundary-trend')).getByTestId('body-trend')).toBeInTheDocument();
  });

  it('offers the Add card slot only when it can add, and says an empty page has no cards', async () => {
    serve({ schema: 1, numbers: [], cards: [] });
    const view = mount({ grid: { onAddCard: () => undefined } });
    await customize(view);
    expect(screen.getByText('This page has no cards. Add one from the catalog.')).toBeInTheDocument();
    expect(document.querySelector('[data-add-card-slot]')).not.toBeNull();
    view.unmount();

    serve({ schema: 1, numbers: [], cards: [] });
    const without = mount();
    await customize(without);
    expect(document.querySelector('[data-add-card-slot]')).toBeNull();
  });

  describe('focus requests', () => {
    const scrolled = vi.fn();
    beforeEach(() => {
      scrolled.mockClear();
      // jsdom has no scrollIntoView
      window.HTMLElement.prototype.scrollIntoView = scrolled;
    });
    afterEach(() => {
      Reflect.deleteProperty(window.HTMLElement.prototype, 'scrollIntoView');
    });

    it('still moves focus where there is no scrollIntoView (jsdom, old browsers)', async () => {
      serve();
      Reflect.deleteProperty(window.HTMLElement.prototype, 'scrollIntoView');
      const view = mount({ grid: { onAddCard: () => undefined } });
      await customize(view);
      act(() => {
        actions().hideCard('matrix');
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(frameOf('unclassified').querySelector('[data-part="handle"]'));
      });
      await waitFor(() => {
        expect(focusRequest()).toBeNull();
      });
    });

    it('moves focus to the part a request names, then clears the request', async () => {
      serve();
      const view = mount({ grid: { onAddCard: () => undefined } });
      await customize(view);
      act(() => {
        actions().hideCard('matrix');
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(frameOf('unclassified').querySelector('[data-part="handle"]'));
      });
      await waitFor(() => {
        expect(focusRequest()).toBeNull();
      });
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    });

    it('scrolls without animation under reduced motion', async () => {
      serve();
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      const view = mount({ grid: { onAddCard: () => undefined } });
      await customize(view);
      act(() => {
        actions().hideCard('matrix');
      });
      await waitFor(() => {
        expect(scrolled).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
      });
    });

    it('leaves a request for the numbers zone alone, for the number strip to answer', async () => {
      serve();
      const view = mount({ grid: { onAddCard: () => undefined } });
      await customize(view);
      const before = document.activeElement;
      act(() => {
        actions().removeNumber('top10');
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(focusRequest()).toEqual({ id: 'aio-citation', part: 'handle', zone: 'numbers' });
      expect(document.activeElement).toBe(before);
      expect(scrolled).not.toHaveBeenCalled();
    });

    it('sends focus to the Add card slot when the last card goes', async () => {
      serve({ schema: 1, numbers: [], cards: [{ id: 'solo', type: 'seo.rank_distribution', width: 'third' }] });
      const view = mount({ grid: { onAddCard: () => undefined } });
      await customize(view);
      act(() => {
        actions().hideCard('solo');
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(document.querySelector('[data-add-card-slot]'));
      });
    });
  });

  it('has no accessibility violations', async () => {
    serve();
    const view = mount({ grid: { onAddCard: () => undefined } });
    await customize(view);
    expect(await axe(view.container)).toHaveNoViolations();
  });
});
