import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkCanvas, type CanvasFocus, type LinkCanvasProps } from './link-canvas';
import { tierEdge } from '@/components/app/tier/tier-colors';
import { SingleKeysContext } from '@/lib/a11y/use-shortcut';
import { centerOn, firstView, type View } from '@/lib/internal-links/canvas-view';
import {
  buildJourney,
  cardKey,
  type JourneyNeighbor,
  type JourneyState,
  type ListLookup,
} from '@/lib/internal-links/journey-layout';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// A card renders its edge colour, so the calls count how often cards are rendered
vi.mock('@/components/app/tier/tier-colors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/app/tier/tier-colors')>();
  return { ...actual, tierEdge: vi.fn(actual.tierEdge) };
});

// jsdom has no layout: the world and the cards get the sizes a test gives them (offset sizes, which a zoom never changes)
const geometry = { world: [900, 300], card: [100, 40], left: 0 };
function stubGeometry(): void {
  const isWorld = (element: HTMLElement): boolean => element.getAttribute('role') === 'presentation';
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return isWorld(this) ? (geometry.world[0] ?? 0) : (geometry.card[0] ?? 0);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isWorld(this) ? (geometry.world[1] ?? 0) : (geometry.card[1] ?? 0);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return isWorld(this) ? 0 : geometry.left;
  });
}

function node(id: string, path: string, code: string | null, over: Partial<JourneyNeighbor> = {}): JourneyNeighbor {
  return {
    url_id: id,
    path,
    title: `${path} title`,
    status_code: 200,
    redirect_url_id: null,
    tier: code === null ? null : { code, name: code === 'T1' ? 'Money pages' : 'Content pages' },
    linking_pages: 3,
    linking_pages_all: 5,
    click_depth: 1,
    anchor: `Go to ${path}`,
    placement: 'content',
    scope: 'editorial',
    rel: [],
    is_followed: true,
    has_children: true,
    reciprocal: false,
    ...over,
  };
}

const LISTS: Record<string, readonly JourneyNeighbor[]> = {
  '1|out|editorial': [node('3', '/blog', 'T3'), node('2', '/pricing', 'T1', { reciprocal: true })],
  '2|out|editorial': [node('4', '/blog/post', 'T3'), node('1', '/', 'T3')],
  '3|out|editorial': [node('4', '/blog/post', 'T3')],
  '4|out|editorial': [node('1', '/', 'T3'), node('2', '/pricing', 'T1')],
  '1|in|editorial': [node('5', '/old', null)],
};
const lookup: ListLookup<JourneyNeighbor> = ({ urlId, direction, scope }) => {
  const items = LISTS[`${urlId}|${direction}|${scope}`] ?? [];
  return { status: 'ready', items, total: items.length, otherScopes: [] };
};
const FOCUS: CanvasFocus = {
  urlId: '1',
  path: '/',
  title: 'Home',
  tier: { code: 'T3', name: 'Content pages' },
  linkingPages: 4,
  linkingPagesAll: 9,
  linksOut: 7,
  statusCode: 200,
  clickDepth: 0,
};
const base: JourneyState = { focus: '1', scope: 'editorial', open: new Set(), groups: new Set(), more: new Map() };

function canvas(over: Partial<LinkCanvasProps<JourneyNeighbor>> = {}, state: Partial<JourneyState> = {}) {
  const props: LinkCanvasProps<JourneyNeighbor> = {
    layout: buildJourney({ ...base, ...state }, lookup),
    focus: FOCUS,
    view: { x: 0, y: 0, scale: 1 },
    onViewChange: vi.fn(),
    pinned: new Set(),
    onTogglePin: vi.fn(),
    onToggleCard: vi.fn(),
    onToggleGroup: vi.fn(),
    onMore: vi.fn(),
    onRefocus: vi.fn(),
    onDetails: vi.fn(),
    onRetry: vi.fn(),
    onFull: vi.fn(),
    onShowLinks: vi.fn(),
    ...over,
  };
  return { props, ...renderWithProviders(<LinkCanvas {...props} />) };
}

afterEach(() => {
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
  geometry.world = [900, 300];
  geometry.card = [100, 40];
  geometry.left = 0;
});

describe('LinkCanvas (spec 7.5)', () => {
  it('names the canvas region after its text alternative', () => {
    canvas();
    expect(
      screen.getByRole('group', { name: 'Link journey canvas. The tree list shows the same journey as a table.' }),
    ).toBeInTheDocument();
  });

  it('names each card like a sentence, and only cards that can open carry aria-expanded', () => {
    canvas();
    expect(
      screen.getByRole('button', { name: '/, T3 Content pages, 4 linking pages, focus page' }),
    ).not.toHaveAttribute('aria-expanded');
    const pricing = screen.getByRole('button', {
      name: '/pricing, T1 Money pages, 3 linking pages, linked as “Go to /pricing”, content',
    });
    expect(pricing).toHaveAttribute('aria-expanded', 'false');
    // A two-way arrow, with the words as its title
    expect(within(pricing).getByTitle('Links both ways')).toBeInTheDocument();
  });

  it('labels the columns from the focus', () => {
    canvas();
    expect(screen.getByRole('heading', { name: 'Focus page' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Step 1 out' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Step 1 in' })).toBeInTheDocument();
  });

  it('opens a card with Enter and moves with the arrows in reading order', async () => {
    const { props, user } = canvas();
    const pricing = screen.getByRole('button', { name: /^\/pricing, T1/ });
    pricing.focus();
    await user.keyboard('{Enter}');
    expect(props.onToggleCard).toHaveBeenCalledWith(cardKey('out', ['2']));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /^\/blog, T3/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: /focus page$/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: /^\/old, Untiered/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /focus page$/ })).toHaveFocus();
  });

  it('re-centers with F, and F does nothing when single-key shortcuts are off', async () => {
    const { props, user } = canvas();
    screen.getByRole('button', { name: /^\/pricing, T1/ }).focus();
    await user.keyboard('f');
    expect(props.onRefocus).toHaveBeenCalledWith('2');

    const onRefocus = vi.fn();
    const off = renderWithProviders(
      <SingleKeysContext value={false}>
        <LinkCanvas {...props} onRefocus={onRefocus} />
      </SingleKeysContext>,
    );
    within(off.container)
      .getByRole('button', { name: /^\/pricing, T1/ })
      .focus();
    await off.user.keyboard('f');
    expect(onRefocus).not.toHaveBeenCalled();
  });

  it('shows back links on an opened card as a marker that pins its return arrows', async () => {
    const pricing = cardKey('out', ['2']);
    const post = cardKey('out', ['2', '4']);
    const { props, user } = canvas({}, { open: new Set([pricing, post]) });
    const marker = screen.getByRole('button', { name: 'Links back to 2 earlier pages' });
    expect(marker).toHaveAttribute('aria-pressed', 'false');
    await user.click(marker);
    expect(props.onTogglePin).toHaveBeenCalledWith(post);
  });

  it('makes a page seen elsewhere a stub that finds the original', async () => {
    const { user } = canvas({}, { open: new Set([cardKey('out', ['2']), cardKey('out', ['3'])]) });
    const stub = screen.getByRole('button', {
      name: '/blog/post, already on the canvas at step 2 out. Select to find it.',
    });
    expect(stub).not.toHaveAttribute('aria-expanded');
    await user.click(stub);
    expect(
      screen.getByRole('button', { name: /^\/blog\/post, T3 Content pages, 3 linking pages, linked/ }),
    ).toHaveFocus();
  });

  it('refuses to open past 300 cards and says why through onFull', async () => {
    const layout = { ...buildJourney(base, lookup), cardCount: 300 };
    const { props, user } = canvas({ layout });
    await user.click(screen.getByRole('button', { name: /^\/pricing, T1/ }));
    expect(props.onFull).toHaveBeenCalledTimes(1);
    expect(props.onToggleCard).not.toHaveBeenCalled();
  });

  it('gives each page card a Visit link when the site host is known, and none without it', () => {
    const { unmount } = canvas({ host: 'example.com' });
    const links = screen.getAllByRole('link', { name: /^Visit .* in a new tab$/ });
    expect(links.length).toBeGreaterThan(1);
    expect(links[0]).toHaveAttribute('href', expect.stringMatching(/^https:\/\/example\.com\//));
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    unmount();
    canvas();
    expect(screen.queryByRole('link', { name: /^Visit / })).not.toBeInTheDocument();
  });

  it('opens the inspector and re-centers from the card tools', async () => {
    const { props, user } = canvas();
    await user.click(screen.getByRole('button', { name: 'Details of /pricing' }));
    expect(props.onDetails).toHaveBeenCalledWith('2');
    await user.click(screen.getByRole('button', { name: 'Make /pricing the focus' }));
    expect(props.onRefocus).toHaveBeenCalledWith('2');
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = canvas({}, { open: new Set([cardKey('out', ['2']), cardKey('out', ['2', '4'])]) });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('LinkCanvas, behaviour found in review', () => {
  const more = (count: number): ListLookup<JourneyNeighbor> => {
    const items = Array.from({ length: count }, (_, index) => node(String(100 + index), `/p${String(index)}`, 'T3'));
    return ({ urlId, direction }) =>
      urlId === '1' && direction === 'out'
        ? { status: 'ready', items, total: items.length, otherScopes: [] }
        : { status: 'ready', items: [], total: 0, otherScopes: [] };
  };

  it('keeps one card in the Tab order, the one that had focus last, with its tools', async () => {
    const { user } = canvas();
    const focusCard = screen.getByRole('button', { name: /focus page$/ });
    const pricing = screen.getByRole('button', { name: /^\/pricing, T1/ });
    expect(focusCard).toHaveAttribute('tabindex', '0');
    expect(pricing).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'Details of /pricing' })).toHaveAttribute('tabindex', '-1');
    await user.click(pricing);
    expect(pricing).toHaveAttribute('tabindex', '0');
    expect(focusCard).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'Details of /pricing' })).toHaveAttribute('tabindex', '0');
  });

  it('opens with Space, and leaves Alt and Command with an arrow to the browser', async () => {
    const { props, user } = canvas();
    const pricing = screen.getByRole('button', { name: /^\/pricing, T1/ });
    pricing.focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(pricing).toHaveFocus();
    await user.keyboard('{Meta>}{ArrowLeft}{/Meta}');
    expect(pricing).toHaveFocus();
    await user.keyboard(' ');
    expect(props.onToggleCard).toHaveBeenCalledTimes(1);
  });

  it('gives a screen reader the status and Both ways through the description of the card', () => {
    const lists: Record<string, readonly JourneyNeighbor[]> = {
      ...LISTS,
      '1|out|editorial': [node('2', '/pricing', 'T1', { reciprocal: true, status_code: 301 })],
    };
    const layout = buildJourney(base, ({ urlId, direction, scope }) => {
      const items = lists[`${urlId}|${direction}|${scope}`] ?? [];
      return { status: 'ready', items, total: items.length, otherScopes: [] };
    });
    canvas({ layout });
    const card = screen.getByRole('button', { name: /^\/pricing, T1/ });
    expect(card).toHaveAccessibleDescription(/Status 301\..*Links both ways\./);
  });

  it('says a failed list in words, speaks it, and retries from the button', async () => {
    const failing: ListLookup<JourneyNeighbor> = ({ urlId, direction }) =>
      urlId === '1' && direction === 'out'
        ? { status: 'error', items: [], total: 0, otherScopes: [] }
        : { status: 'ready', items: [], total: 0, otherScopes: [] };
    const { props, user } = canvas({ layout: buildJourney(base, failing) });
    const group = screen.getByRole('group', { name: /^Link journey canvas/ });
    expect(within(group).getByText('These links could not be loaded.')).toBeInTheDocument();
    // Spoken once, by the app's assertive live region (components make no live region of their own, 20 section 10.1)
    expect(within(group).queryByRole('alert')).toBeNull();
    await waitFor(() => {
      expect(document.getElementById('live-region-assertive')).toHaveTextContent('These links could not be loaded.');
    });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledWith({ urlId: '1', direction: 'out', scope: 'editorial', pages: 1 });
  });

  it('labels a loading list for a screen reader and marks it busy', () => {
    const loading: ListLookup<JourneyNeighbor> = ({ urlId, direction }) =>
      urlId === '1' && direction === 'out'
        ? { status: 'loading', items: [], total: 0, otherScopes: [] }
        : { status: 'ready', items: [], total: 0, otherScopes: [] };
    canvas({ layout: buildJourney(base, loading) });
    expect(screen.getByText('Loading links').closest('[aria-busy="true"]')).not.toBeNull();
  });

  it('returns focus to the card above when "+N more" goes with the last pages', async () => {
    const { props, user, rerender } = canvas({ layout: buildJourney(base, more(20)) });
    await user.click(screen.getByRole('button', { name: 'Show 12 more pages' }));
    expect(props.onMore).toHaveBeenCalledTimes(1);
    rerender(<LinkCanvas {...props} layout={buildJourney({ ...base, more: new Map([['m:o|f', 2]]) }, more(20))} />);
    expect(screen.queryByRole('button', { name: /more pages/ })).toBeNull();
    expect(screen.getByRole('button', { name: /focus page$/ })).toHaveFocus();
  });

  it('does not pull focus back to an old card when only the view changes', async () => {
    const { props, user, rerender } = canvas();
    await user.click(screen.getByRole('button', { name: /^\/blog, T3/ }));
    screen.getByRole('button', { name: /^\/pricing, T1/ }).focus();
    rerender(<LinkCanvas {...props} view={{ x: -20, y: 10, scale: 0.6 }} />);
    expect(screen.getByRole('button', { name: /^\/pricing, T1/ })).toHaveFocus();
  });

  it('shows the world through a transform and has no scrolling region', () => {
    canvas({ view: { x: 40, y: 20, scale: 0.5 } });
    const region = screen.getByRole('group', { name: /^Link journey canvas/ });
    expect(region.className).toContain('overflow-hidden');
    expect((region.firstElementChild as HTMLElement).style.transform).toBe('translate(40px, 20px) scale(0.5)');
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('has the view toolbar, and the map is off until its button is pressed', async () => {
    const { user } = canvas();
    expect(screen.getByRole('group', { name: 'Canvas view' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Map of the journey' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show the map' }));
    expect(screen.getByRole('img', { name: 'Map of the journey' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide the map' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Hide the map' }));
    expect(screen.queryByRole('img', { name: 'Map of the journey' })).toBeNull();
  });

  it('fits everything at no more than 100 percent, centres on the focus page, and returns to 100 percent', async () => {
    const onViewChange = vi.fn();
    const { user } = canvas({ onViewChange, view: { x: 0, y: 0, scale: 0.5 } });
    onViewChange.mockClear();
    await user.click(screen.getByRole('button', { name: 'Fit everything' }));
    expect((onViewChange.mock.lastCall?.[0] as View).scale).toBeLessThanOrEqual(1);
    await user.click(screen.getByRole('button', { name: 'Centre on focus' }));
    expect(onViewChange).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: '50%, return to 100%' }));
    expect((onViewChange.mock.lastCall?.[0] as View).scale).toBe(1);
  });

  it('answers 0 for fit and Home for the focus page from the empty canvas', () => {
    const onViewChange = vi.fn();
    canvas({ onViewChange });
    onViewChange.mockClear();
    const region = screen.getByRole('group', { name: /^Link journey canvas/ });
    fireEvent.keyDown(region, { key: '0' });
    fireEvent.keyDown(region, { key: 'Home' });
    expect(onViewChange).toHaveBeenCalledTimes(2);
  });

  it('reveals a card that the keyboard takes outside the view, and leaves a visible one alone', async () => {
    stubGeometry();
    const onViewChange = vi.fn();
    const { user } = canvas({ onViewChange, view: { x: -10000, y: 0, scale: 1 } });
    onViewChange.mockClear();
    screen.getByRole('button', { name: /, focus page$/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /^\/pricing, T1/ })).toHaveFocus();
    // The card is at the left of a world that sits 10000 px to the left: the least pan brings it 24 px inside
    expect((onViewChange.mock.lastCall?.[0] as View).x).toBe(24 - 0);
  });

  it('leaves the view alone for a card that is in view', async () => {
    stubGeometry();
    const onViewChange = vi.fn();
    const { user } = canvas({ onViewChange, view: { x: 100, y: 100, scale: 1 } });
    onViewChange.mockClear();
    screen.getByRole('button', { name: /focus page$/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it('does not move the view for a card the mouse focused', () => {
    stubGeometry();
    const onViewChange = vi.fn();
    canvas({ onViewChange, view: { x: -10000, y: 0, scale: 1 } });
    onViewChange.mockClear();
    const card = screen.getByRole('button', { name: /^\/pricing, T1/ });
    fireEvent.pointerDown(card, { pointerId: 1 });
    card.focus();
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it('measures the card that takes focus when it does, not from the last drawing', async () => {
    stubGeometry();
    const onViewChange = vi.fn();
    const { user } = canvas({ onViewChange, view: { x: 0, y: 0, scale: 1 } });
    onViewChange.mockClear();
    // The page moved since the last drawing (a card opened above it): the card is now far to the right
    geometry.left = 9000;
    screen.getByRole('button', { name: /focus page$/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onViewChange).toHaveBeenCalled();
  });

  it('does not measure the cards again when only the zoom changes', () => {
    stubGeometry();
    const { props, rerender } = canvas();
    // Drawing reads the offset geometry, which a zoom does not change; the screen rectangles would change with it
    const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const offsets = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get');
    rects.mockClear();
    offsets.mockClear();
    rerender(<LinkCanvas {...props} view={{ x: 10, y: 10, scale: 0.5 }} />);
    rerender(<LinkCanvas {...props} view={{ x: 20, y: 20, scale: 1.5 }} />);
    expect(rects).not.toHaveBeenCalled();
    expect(offsets).not.toHaveBeenCalled();
  });

  it('does not render the cards again when the view pans, even with new handlers from the host', () => {
    const { props, rerender } = canvas();
    const rendered = vi.mocked(tierEdge).mock.calls.length;
    expect(rendered).toBeGreaterThan(0);
    for (let step = 1; step <= 5; step += 1) {
      rerender(
        <LinkCanvas
          {...props}
          view={{ x: step * 10, y: step, scale: 1 }}
          onToggleCard={vi.fn()}
          onToggleGroup={vi.fn()}
          onMore={vi.fn()}
          onRefocus={vi.fn()}
          onDetails={vi.fn()}
          onRetry={vi.fn()}
          onFull={vi.fn()}
          onTogglePin={vi.fn()}
        />,
      );
    }
    expect(vi.mocked(tierEdge).mock.calls.length).toBe(rendered);
  });

  it('still calls the latest handlers of the host from a card that was not rendered again', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { props, rerender, user } = canvas({ onToggleCard: first });
    rerender(<LinkCanvas {...props} onToggleCard={second} view={{ x: 5, y: 5, scale: 1 }} />);
    await user.click(screen.getByRole('button', { name: /^\/pricing, T1/ }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(cardKey('out', ['2']));
  });

  it('turns the zoom buttons off at the limits', () => {
    const { props, rerender } = canvas({ view: { x: 0, y: 0, scale: 2 } });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveAttribute('aria-disabled', 'true');
    rerender(<LinkCanvas {...props} view={{ x: 0, y: 0, scale: 0.25 }} />);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Zoom in' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('centres the view on the point of the map that was pressed', async () => {
    stubGeometry();
    const onViewChange = vi.fn();
    const { user } = canvas({ onViewChange });
    await user.click(screen.getByRole('button', { name: 'Show the map' }));
    onViewChange.mockClear();
    const map = screen.getByRole('img', { name: 'Map of the journey' });
    // The world is 900 by 300: the map scale is 176 over 900, and 90 px across is about 460 world px
    fireEvent.pointerDown(map, { pointerId: 1, clientX: 90, clientY: 30 });
    const view = onViewChange.mock.lastCall?.[0] as View;
    const scale = Math.min(176 / 900, 112 / 300);
    expect(view.scale).toBe(1);
    expect(view.x).toBeCloseTo(500 - 90 / scale, 6);
    expect(view.y).toBeCloseTo(348 - 30 / scale, 6);
  });

  it('sets the first view once per focus page, when the journey has a size', () => {
    stubGeometry();
    const onViewChange = vi.fn();
    const { props, rerender } = canvas({ onViewChange });
    expect(onViewChange).toHaveBeenCalledTimes(1);
    rerender(<LinkCanvas {...props} onViewChange={onViewChange} pinned={new Set(['x'])} />);
    expect(onViewChange).toHaveBeenCalledTimes(1);
  });

  it('leaves the view alone when the host holds one for this focus page (a return, Back, the canvas shown again)', () => {
    stubGeometry();
    const onViewChange = vi.fn();
    const { props, rerender } = canvas({ onViewChange, holdsView: true });
    expect(onViewChange).not.toHaveBeenCalled();
    // A new focus page the host holds no view for gets its first view
    geometry.world = [2000, 300];
    rerender(
      <LinkCanvas
        {...props}
        onViewChange={onViewChange}
        holdsView={false}
        layout={buildJourney({ ...base, focus: '2' }, lookup)}
        focus={{ ...FOCUS, urlId: '2', path: '/pricing' }}
      />,
    );
    expect(onViewChange).toHaveBeenCalledTimes(1);
  });

  it('sets the first view of a new focus page from its own journey, not from the one before', () => {
    stubGeometry();
    const onViewChange = vi.fn();
    const { props, rerender } = canvas({ onViewChange });
    expect(onViewChange).toHaveBeenCalledTimes(1);
    // The neighbour's lists are already read: its journey is ready at once, and a lot wider
    geometry.world = [2000, 300];
    const neighbour = buildJourney({ ...base, focus: '2' }, lookup);
    rerender(
      <LinkCanvas
        {...props}
        onViewChange={onViewChange}
        layout={neighbour}
        focus={{ ...FOCUS, urlId: '2', path: '/pricing' }}
      />,
    );
    expect(onViewChange).toHaveBeenCalledTimes(2);
    const focusBox = { left: 0, top: 0, width: 100, height: 40 };
    const expected = firstView(
      { left: 0, top: 0, width: 2000, height: 300 },
      focusBox,
      { width: 1000, height: 696 },
      56,
    );
    expect(onViewChange.mock.lastCall?.[0]).toEqual(expected);
  });

  it('never draws an equity share', () => {
    const { container } = canvas();
    expect(container.textContent?.toLowerCase()).not.toContain('equity');
  });

  it('writes a back link without an anchor as a plain row, never as an empty quote', () => {
    const pricing = cardKey('out', ['2']);
    const deep = cardKey('out', ['2', '4']);
    const plain = (id: string, path: string) => node(id, path, 'T3', { anchor: null, scope: null });
    const lists: Record<string, readonly JourneyNeighbor[]> = {
      ...LISTS,
      '4|out|editorial': [plain('1', '/'), plain('2', '/pricing')],
    };
    const layout = buildJourney({ ...base, open: new Set([pricing, deep]) }, ({ urlId, direction, scope }) => {
      const items = lists[`${urlId}|${direction}|${scope}`] ?? [];
      return { status: 'ready', items, total: items.length, otherScopes: [] };
    });
    canvas({ layout });
    const marker = screen.getByRole('button', { name: 'Links back to 2 earlier pages' });
    expect(marker).toHaveAccessibleDescription(/T3 \/\. T3 \/pricing\./);
    expect(marker).not.toHaveAccessibleDescription(/“”/);
    expect(marker).not.toHaveAccessibleDescription(/And \d+ more/);
  });
});

const pricingCard = (): HTMLElement => screen.getByRole('button', { name: /^\/pricing, T1/ });
const blogCard = (): HTMLElement => screen.getByRole('button', { name: /^\/blog, T3/ });
const shiftClick = async (user: ReturnType<typeof canvas>['user'], element: HTMLElement): Promise<void> => {
  await user.keyboard('{Shift>}');
  await user.click(element);
  await user.keyboard('{/Shift}');
};

describe('LinkCanvas, the focus card and the card layout (spec 7.5)', () => {
  it('makes the focus card wider, with a 2 px primary border, a halo and a third line', () => {
    canvas();
    const card = screen.getByRole('button', { name: /focus page$/ });
    expect(card.className).toContain('border-2');
    expect(card.className).toContain('border-primary');
    expect(card.closest('.group')?.className).toContain('w-72');
    expect(screen.getByText('7 out')).toBeInTheDocument();
    expect(screen.getByText('This is the home page')).toBeInTheDocument();
  });

  it('says how many clicks from home, and when the focus is not reachable', () => {
    canvas({ focus: { ...FOCUS, clickDepth: 3 } });
    expect(screen.getByText('3 clicks from home')).toBeInTheDocument();
  });

  it('says a focus page that cannot be reached from home', () => {
    canvas({ focus: { ...FOCUS, clickDepth: null } });
    expect(screen.getByText('Not reachable from home')).toBeInTheDocument();
  });

  it('heads the focus column with a primary Focus page badge', () => {
    canvas();
    expect(screen.getByRole('heading', { name: 'Focus page' }).className).toContain('bg-primary-subtle');
  });

  it('draws other cards 240 px wide with the path, then the anchor and the facts', () => {
    canvas();
    const pricing = pricingCard();
    expect(pricing.closest('.group')?.className).toContain('w-60');
    expect(within(pricing).getByText('/pricing')).toBeInTheDocument();
    expect(within(pricing).getByText('Go to /pricing')).toBeInTheDocument();
    expect(within(pricing).getByText('3 in')).toBeInTheDocument();
    expect(within(pricing).getByText('T1')).toBeInTheDocument();
    expect(within(pricing).queryByText('3 linking pages')).toBeNull();
  });

  it('shows a stub as two lines: the path, then the anchor and where the page also is', () => {
    canvas({}, { open: new Set([cardKey('out', ['2']), cardKey('out', ['3'])]) });
    const stub = screen.getByRole('button', { name: /^\/blog\/post, already on the canvas/ });
    expect(within(stub).getByText('Also at step 2 out')).toBeInTheDocument();
  });

  it('has no legend row under the canvas', () => {
    canvas();
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
  });
});

describe('LinkCanvas, the info panel', () => {
  it('does not open on hover or focus', async () => {
    const { user } = canvas();
    await user.hover(pricingCard());
    pricingCard().focus();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from the Info button with the facts of the page and the link, and closes on Escape or the button again', async () => {
    const { user } = canvas();
    await user.click(screen.getByRole('button', { name: 'Info about /pricing' }));
    const panel = screen.getByRole('dialog', { name: 'Info about /pricing' });
    expect(within(panel).getByText('T1 Money pages')).toBeInTheDocument();
    expect(within(panel).getByText('Link placement')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Info about /pricing' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Info about /pricing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when the view pans', async () => {
    const { user, props, rerender } = canvas();
    await user.click(screen.getByRole('button', { name: 'Info about /pricing' }));
    rerender(<LinkCanvas {...props} view={{ x: -30, y: 0, scale: 1 }} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is on the focus card too, without link rows', async () => {
    const { user } = canvas();
    await user.click(screen.getByRole('button', { name: 'Info about /' }));
    expect(within(screen.getByRole('dialog')).queryByText('Link placement')).toBeNull();
  });
});

describe('LinkCanvas, line tips', () => {
  it('names the anchor, the type and the attribute of a line on hover', () => {
    const { container } = canvas();
    const line = container.querySelector('path[data-line]');
    expect(line).not.toBeNull();
    fireEvent.pointerMove(line as Element, { clientX: 40, clientY: 50 });
    const tip = screen.getByRole('tooltip');
    expect(within(tip).getByText('Anchor text')).toBeInTheDocument();
    expect(within(tip).getByText('Link type')).toBeInTheDocument();
    expect(within(tip).getByText('Attribute')).toBeInTheDocument();
    fireEvent.pointerLeave(line as Element);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('LinkCanvas, back to the focus page', () => {
  it('shows only when the focus card is off screen, and centres on it', async () => {
    stubGeometry();
    const { props, user, rerender } = canvas();
    expect(screen.queryByRole('button', { name: 'Back to the focus page' })).toBeNull();
    rerender(<LinkCanvas {...props} view={{ x: -5000, y: 0, scale: 1 }} />);
    await user.click(screen.getByRole('button', { name: 'Back to the focus page' }));
    expect(props.onViewChange).toHaveBeenCalled();
  });
});

describe('LinkCanvas, selecting cards', () => {
  it('selects with Shift click, says how many, and takes a card away the second time', async () => {
    const { user } = canvas();
    await shiftClick(user, pricingCard());
    await shiftClick(user, blogCard());
    expect(screen.getByText('2 cards selected')).toBeInTheDocument();
    await shiftClick(user, blogCard());
    expect(screen.getByText('1 card selected')).toBeInTheDocument();
    await shiftClick(user, pricingCard());
    expect(screen.queryByRole('region', { name: 'Selected cards' })).toBeNull();
  });

  it('does not open a card that Shift click selected', async () => {
    const { props, user } = canvas();
    await shiftClick(user, pricingCard());
    expect(props.onToggleCard).not.toHaveBeenCalled();
  });

  it('hands the cards that can open to Show their links', async () => {
    const { props, user } = canvas();
    await shiftClick(user, pricingCard());
    await shiftClick(user, blogCard());
    await user.click(screen.getByRole('button', { name: 'Show their links' }));
    const keys = vi.mocked(props.onShowLinks).mock.lastCall?.[0] ?? [];
    expect([...keys].sort()).toEqual([cardKey('out', ['2']), cardKey('out', ['3'])].sort());
  });

  it('sets the tier of the selected pages when the person can write, and offers nothing when not', async () => {
    const onSetTier = vi.fn();
    const { user } = canvas({ onSetTier });
    await shiftClick(user, pricingCard());
    await shiftClick(user, blogCard());
    await user.click(screen.getByRole('button', { name: 'Set tier' }));
    expect(onSetTier.mock.lastCall?.[0]).toEqual(['2', '3']);
  });

  it('has no Set tier without the handler', async () => {
    const { user } = canvas();
    await shiftClick(user, pricingCard());
    expect(screen.queryByRole('button', { name: 'Set tier' })).toBeNull();
  });

  it('clears with the Clear button', async () => {
    const { user } = canvas();
    await shiftClick(user, pricingCard());
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('region', { name: 'Selected cards' })).toBeNull();
  });

  it('clears with Escape first, and only the next Escape returns to the focus card', async () => {
    const { user } = canvas();
    await shiftClick(user, pricingCard());
    pricingCard().focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Selected cards' })).toBeNull();
    expect(pricingCard()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /focus page$/ })).toHaveFocus();
  });

  it('selects the cards a Shift drag over the background touches, without panning', () => {
    stubGeometry();
    const { props } = canvas();
    const region = screen.getByRole('group', { name: /^Link journey canvas/ });
    // The first view of the focus page is the canvas's own change, before the person does anything
    vi.mocked(props.onViewChange).mockClear();
    fireEvent.pointerDown(region, { pointerId: 1, clientX: 0, clientY: 0, button: 0, shiftKey: true });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 200, clientY: 100 });
    expect(screen.getByText('4 cards selected')).toBeInTheDocument();
    expect(props.onViewChange).not.toHaveBeenCalled();
  });

  it('keeps a selection only for the focus page it was made on', async () => {
    const { user, props, rerender } = canvas();
    await shiftClick(user, pricingCard());
    rerender(<LinkCanvas {...props} focus={{ ...FOCUS, urlId: '9' }} />);
    expect(screen.queryByRole('region', { name: 'Selected cards' })).toBeNull();
  });
});

describe('LinkCanvas, moving cards', () => {
  const drag = (element: HTMLElement, dx: number, dy: number, over: Record<string, unknown> = {}): void => {
    fireEvent.pointerDown(element, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
      pointerType: 'mouse',
      ...over,
    });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
  };
  const wrapperOf = (element: HTMLElement): HTMLElement => element.closest('.group') as HTMLElement;

  it('moves a card with the pointer, by the distance in world pixels', () => {
    canvas({ view: { x: 0, y: 0, scale: 0.5 } });
    drag(pricingCard(), 30, 10);
    expect(wrapperOf(pricingCard()).style.transform).toBe('translate(60px, 20px)');
  });

  it('does not open the card it moved', () => {
    const { props } = canvas();
    drag(pricingCard(), 30, 10);
    fireEvent.click(pricingCard());
    expect(props.onToggleCard).not.toHaveBeenCalled();
  });

  it('still opens a card that was only pressed and released', async () => {
    const { props, user } = canvas();
    await user.click(pricingCard());
    expect(props.onToggleCard).toHaveBeenCalledWith(cardKey('out', ['2']));
    expect(wrapperOf(pricingCard()).style.transform).toBe('');
  });

  it('does not move on a touch screen, so a tap always opens', () => {
    canvas();
    drag(pricingCard(), 30, 10, { pointerType: 'touch' });
    expect(wrapperOf(pricingCard()).style.transform).toBe('');
  });

  it('moves the whole selection when a selected card is dragged', async () => {
    const { user } = canvas();
    await shiftClick(user, pricingCard());
    await shiftClick(user, blogCard());
    drag(pricingCard(), 20, 0);
    expect(wrapperOf(blogCard()).style.transform).toBe('translate(20px, 0px)');
  });

  it('keeps the positions for each focus page, and Reset card positions puts the cards back', async () => {
    const { user, props, rerender } = canvas();
    const reset = screen.getByRole('button', { name: 'Reset card positions' });
    expect(reset).toHaveAttribute('aria-disabled', 'true');
    drag(pricingCard(), 30, 10);
    rerender(<LinkCanvas {...props} focus={{ ...FOCUS, urlId: '9' }} />);
    expect(wrapperOf(pricingCard()).style.transform).toBe('');
    rerender(<LinkCanvas {...props} />);
    expect(wrapperOf(pricingCard()).style.transform).toBe('translate(30px, 10px)');
    await user.click(screen.getByRole('button', { name: 'Reset card positions' }));
    expect(wrapperOf(pricingCard()).style.transform).toBe('');
  });

  it('does not render the other cards again while one is moved', () => {
    canvas();
    const rendered = vi.mocked(tierEdge).mock.calls.length;
    drag(pricingCard(), 30, 10);
    expect(vi.mocked(tierEdge).mock.calls.length - rendered).toBeLessThanOrEqual(2);
  });

  it('draws the lines to where the card was moved', () => {
    stubGeometry();
    const { container } = canvas();
    const line = (): string | null | undefined =>
      container.querySelector(`path[data-line="${cardKey('out', ['2'])}"]`)?.getAttribute('d');
    const before = line();
    expect(before).toBeTruthy();
    drag(pricingCard(), 30, 10);
    expect(line()).toBeTruthy();
    expect(line()).not.toBe(before);
  });
});

describe('LinkCanvas, the legend and controls panel', () => {
  it('opens and closes from the question mark button', async () => {
    const { user } = canvas();
    const help = screen.getByRole('button', { name: 'Legend and controls' });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    await user.click(help);
    expect(screen.getByRole('region', { name: 'Legend and controls' })).toBeInTheDocument();
    expect(help).toHaveAttribute('aria-expanded', 'true');
    await user.click(help);
    expect(screen.queryByRole('region', { name: 'Legend and controls' })).toBeNull();
  });

  it('points the question mark button at the panel while it is open, and at nothing while it is closed', async () => {
    const { user } = canvas();
    const help = screen.getByRole('button', { name: 'Legend and controls' });
    expect(help).not.toHaveAttribute('aria-controls');
    await user.click(help);
    const region = screen.getByRole('region', { name: 'Legend and controls' });
    expect(region.id).not.toBe('');
    expect(help).toHaveAttribute('aria-controls', region.id);
  });

  it('names the keys that are not obvious: Ctrl, Space, Shift and Enter, and Escape', async () => {
    const { user } = canvas();
    await user.click(screen.getByRole('button', { name: 'Legend and controls' }));
    const region = screen.getByRole('region', { name: 'Legend and controls' });
    expect(within(region).getByText('Shift, Cmd or Ctrl and click, or Shift and Enter')).toBeInTheDocument();
    expect(within(region).getByText('Space and drag')).toBeInTheDocument();
    expect(within(region).getByText(/close the details/i)).toBeInTheDocument();
  });
});

describe('LinkCanvas, review fixes for moving, selecting and the info panel', () => {
  const press = (element: HTMLElement, over: Record<string, unknown> = {}): void => {
    fireEvent.pointerDown(element, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
      pointerType: 'mouse',
      ...over,
    });
  };
  const moveTo = (dx: number, dy: number): void => {
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
  };
  const release = (dx: number, dy: number): void => {
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
  };
  const wrapperOf = (element: HTMLElement): HTMLElement => element.closest('.group') as HTMLElement;
  const focusCardButton = (): HTMLElement => screen.getByRole('button', { name: /, focus page$/ });

  it('centres on the moved focus card, not on where the layout put it', async () => {
    stubGeometry();
    const { props, user, rerender } = canvas();
    press(focusCardButton());
    moveTo(30, 10);
    release(30, 10);
    expect(wrapperOf(focusCardButton()).style.transform).toBe('translate(30px, 10px)');
    const away: View = { x: -5000, y: 0, scale: 1 };
    rerender(<LinkCanvas {...props} view={away} />);
    vi.mocked(props.onViewChange).mockClear();
    await user.click(screen.getByRole('button', { name: 'Back to the focus page' }));
    expect(vi.mocked(props.onViewChange).mock.lastCall?.[0]).toEqual(
      centerOn(away, { left: 30, top: 10, width: 100, height: 40 }, { width: 1000, height: 696 }),
    );
  });

  it('closes the info panel from its close button and gives focus back to the Info button', async () => {
    const { user } = canvas();
    await user.click(screen.getByRole('button', { name: 'Info about /pricing' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Info about /pricing' })).toHaveFocus();
  });

  it('gives the first Escape to the info panel, then the selection, then the focus card', async () => {
    const { user } = canvas();
    await shiftClick(user, pricingCard());
    await user.click(screen.getByRole('button', { name: 'Info about /pricing' }));
    pricingCard().focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: 'Selected cards' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Info about /pricing' })).toHaveFocus();
    pricingCard().focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Selected cards' })).toBeNull();
    expect(pricingCard()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(focusCardButton()).toHaveFocus();
  });

  it('closes the panel with Escape from the empty canvas without clearing the selection', async () => {
    const { user } = canvas();
    await shiftClick(user, pricingCard());
    await user.click(screen.getByRole('button', { name: 'Info about /pricing' }));
    screen.getByRole('group', { name: /^Link journey canvas/ }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: 'Selected cards' })).toBeInTheDocument();
  });

  it('keeps the card where it was moved when the system cancels the pointer, and opens nothing', () => {
    const { props } = canvas();
    press(pricingCard());
    moveTo(30, 10);
    fireEvent.pointerCancel(document, { pointerId: 1, clientX: 130, clientY: 110 });
    fireEvent.click(pricingCard());
    expect(wrapperOf(pricingCard()).style.transform).toBe('translate(30px, 10px)');
    expect(props.onToggleCard).not.toHaveBeenCalled();
  });

  it('holds a move inside the content, so no line or card is clipped or left out of the fit and the map', () => {
    stubGeometry();
    canvas();
    press(pricingCard());
    moveTo(5000, 5000);
    release(5000, 5000);
    // The world is 900 by 300 and the card 100 by 40
    expect(wrapperOf(pricingCard()).style.transform).toBe('translate(800px, 260px)');
    press(pricingCard());
    moveTo(-9000, -9000);
    release(-9000, -9000);
    expect(wrapperOf(pricingCard()).style.transform).toBe('translate(0px, 0px)');
  });

  describe('with animation frames run by hand', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 1;
    const runFrames = (): void => {
      const batch = [...frames.values()];
      frames.clear();
      act(() => {
        for (const callback of batch) callback(0);
      });
    };
    beforeEach(() => {
      frames.clear();
      next = 1;
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(next, callback);
        return next++;
      });
      vi.stubGlobal('cancelAnimationFrame', (id: number) => void frames.delete(id));
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('applies many moves in one frame as one change, and re-renders only the moved card', () => {
      canvas();
      const rendered = vi.mocked(tierEdge).mock.calls.length;
      press(pricingCard());
      for (let step = 1; step <= 20; step += 1) moveTo(step, step);
      // Nothing is drawn until the frame comes
      expect(wrapperOf(pricingCard()).style.transform).toBe('');
      expect(vi.mocked(tierEdge).mock.calls.length).toBe(rendered);
      runFrames();
      expect(wrapperOf(pricingCard()).style.transform).toBe('translate(20px, 20px)');
      expect(vi.mocked(tierEdge).mock.calls.length - rendered).toBeLessThanOrEqual(2);
      release(20, 20);
    });

    it('cancels a move with Escape: the card goes back and the release is no click', () => {
      const { props } = canvas();
      press(pricingCard());
      moveTo(30, 10);
      runFrames();
      expect(wrapperOf(pricingCard()).style.transform).toBe('translate(30px, 10px)');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(wrapperOf(pricingCard()).style.transform).toBe('');
      moveTo(80, 80);
      runFrames();
      release(80, 80);
      fireEvent.click(pricingCard());
      expect(wrapperOf(pricingCard()).style.transform).toBe('');
      expect(props.onToggleCard).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Reset card positions' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('applies the last move when the pointer is lifted before a frame comes', () => {
      canvas();
      press(pricingCard());
      moveTo(12, 6);
      release(12, 6);
      expect(wrapperOf(pricingCard()).style.transform).toBe('translate(12px, 6px)');
      expect(frames.size).toBe(0);
    });

    it('measures the whole move at the zoom it started at, so zooming during it does not rescale it', () => {
      const { props, rerender } = canvas({ view: { x: 0, y: 0, scale: 0.5 } });
      press(pricingCard());
      moveTo(30, 10);
      rerender(<LinkCanvas {...props} view={{ x: 0, y: 0, scale: 2 }} />);
      moveTo(40, 10);
      runFrames();
      release(40, 10);
      expect(wrapperOf(pricingCard()).style.transform).toBe('translate(80px, 20px)');
    });

    it('does not run a frame after the canvas is gone', () => {
      const { unmount } = canvas();
      press(pricingCard());
      moveTo(5, 5);
      unmount();
      expect(frames.size).toBe(0);
    });
  });

  it('gives the map the moved positions of the cards', async () => {
    stubGeometry();
    const { user } = canvas();
    await user.click(screen.getByRole('button', { name: 'Show the map' }));
    const map = screen.getByRole('img', { name: 'Map of the journey' });
    const places = (): string[] =>
      [...map.querySelectorAll('rect[data-card]')].map((rect) => rect.getAttribute('x') ?? '');
    const before = places();
    press(pricingCard());
    moveTo(100, 0);
    release(100, 0);
    expect(places()).not.toEqual(before);
  });

  it('gives focus back to the active card when Clear or Escape in the bar takes the bar away', async () => {
    const { user } = canvas();
    await shiftClick(user, pricingCard());
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(pricingCard()).toHaveFocus();
    await shiftClick(user, pricingCard());
    screen.getByRole('button', { name: 'Show their links' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Selected cards' })).toBeNull();
    expect(pricingCard()).toHaveFocus();
  });

  it('selects the focused card with Shift and Enter', async () => {
    const { props, user } = canvas();
    pricingCard().focus();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(screen.getByText('1 card selected')).toBeInTheDocument();
    expect(props.onToggleCard).not.toHaveBeenCalled();
  });

  it('forgets a selection and a move of a card that left the canvas, so it comes back as new', async () => {
    const open = new Set([cardKey('out', ['2'])]);
    const { props, user, rerender } = canvas({}, { open });
    const deep = (): HTMLElement =>
      screen.getByRole('button', { name: /^\/blog\/post, T3 Content pages, 3 linking pages, linked/ });
    await shiftClick(user, deep());
    press(deep());
    moveTo(30, 10);
    release(30, 10);
    expect(screen.getByText('1 card selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset card positions' })).not.toHaveAttribute('aria-disabled', 'true');
    rerender(<LinkCanvas {...props} layout={buildJourney({ ...base, open: new Set() }, lookup)} />);
    expect(screen.queryByRole('region', { name: 'Selected cards' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset card positions' })).toHaveAttribute('aria-disabled', 'true');
    rerender(<LinkCanvas {...props} layout={buildJourney({ ...base, open }, lookup)} />);
    expect(screen.queryByRole('region', { name: 'Selected cards' })).toBeNull();
    expect(wrapperOf(deep()).style.transform).toBe('');
  });

  it('keeps the back button and the selection bar apart on a narrow canvas', async () => {
    stubGeometry();
    const { props, user, rerender } = canvas();
    await shiftClick(user, pricingCard());
    rerender(<LinkCanvas {...props} view={{ x: -5000, y: 0, scale: 1 }} />);
    const back = screen.getByRole('button', { name: 'Back to the focus page' });
    const bar = screen.getByRole('region', { name: 'Selected cards' });
    // One wrapping row for both, so they stack instead of overlapping
    expect(back.parentElement).toBe(bar.parentElement?.parentElement);
    expect(back.parentElement?.className).toContain('flex-wrap');
  });
});
