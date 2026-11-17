import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkCanvas, type CanvasFocus, type LaneTier, type LinkCanvasProps } from './link-canvas';
import { tierPosition } from '@/lib/internal-links/tiers';
import {
  buildJourney,
  type JourneyNeighbor,
  type JourneyState,
  type ListLookup,
} from '@/lib/internal-links/journey-layout';
import { renderWithProviders } from '@/test/render';

// jsdom has no layout: the world, the lanes and the cards get the sizes and tops a test gives them
const geometry = { world: [900, 300], card: [100, 40], tops: new Map<string, number>() };
function stubGeometry(): void {
  const isWorld = (element: HTMLElement): boolean => element.getAttribute('role') === 'presentation';
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return isWorld(this) ? (geometry.world[0] ?? 0) : (geometry.card[0] ?? 0);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isWorld(this) ? (geometry.world[1] ?? 0) : (geometry.card[1] ?? 0);
  });
  // Every card stands inside the view with room to spare, so a growth pans only for the card that moved
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return isWorld(this) ? 0 : 100;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return geometry.tops.get(this.dataset.key ?? '') ?? 0;
  });
}

function node(id: string, path: string, code: string | null, over: Partial<JourneyNeighbor> = {}): JourneyNeighbor {
  return {
    url_id: id,
    path,
    title: `${path} title`,
    status_code: 200,
    redirect_url_id: null,
    tier: code === null ? null : { code, name: `${code} name` },
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
  '1|out|editorial': [node('3', '/blog', 'T3'), node('2', '/pricing', 'T1')],
  '2|out|editorial': [node('4', '/blog/post', 'T3'), node('1', '/', 'T3')],
  '3|out|editorial': [node('4', '/blog/post', 'T3')],
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
  tier: { code: 'T3', name: 'T3 name' },
  linkingPages: 4,
  linkingPagesAll: 9,
  linksOut: 7,
  statusCode: 200,
  clickDepth: 0,
};
const TIERS: LaneTier[] = [
  { position: 1, code: 'T1', name: 'Money pages' },
  { position: 2, code: 'T2', name: 'Support pages' },
  { position: 3, code: 'T3', name: 'Content pages' },
  { position: 4, code: 'T4', name: 'Blog' },
];
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

const card = (path: string): HTMLElement => screen.getByRole('button', { name: new RegExp(`^${path},`) });
const lane = (container: HTMLElement, position: number): HTMLElement => {
  const found = container.querySelector<HTMLElement>(`[data-lane="${String(position)}"]`);
  if (found === null) throw new Error(`No lane ${String(position)}`);
  return found;
};

beforeEach(() => {
  geometry.world = [900, 300];
  geometry.card = [100, 40];
  geometry.tops.clear();
  stubGeometry();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // `animate` is not in jsdom: tests that stub it remove it again
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

describe('LinkCanvas, the By tier layout (spec 7.5 "Two layouts")', () => {
  const tierProps = { layoutMode: 'tier', tiers: TIERS } as const;

  it('has a lane for each tier, T4 on the left and T1 on the right, with the page counts', () => {
    const { container } = canvas(tierProps);
    const heads = within(container).getAllByRole('heading', { level: 3 });
    // /old links in and has no tier, so the Untiered lane is the lowest, on the far left
    expect(heads.map((head) => head.textContent)).toEqual([
      'Untiered',
      'T4 Blog',
      'T3 Content pages',
      'T2 Support pages',
      'T1 Money pages',
    ]);
    // The focus page and /blog are in T3, /pricing in T1
    expect(within(lane(container, 3)).getByText('2 pages')).toBeInTheDocument();
    expect(within(lane(container, 1)).getByText('1 page')).toBeInTheDocument();
    expect(within(lane(container, 3)).getByRole('button', { name: /^\/blog,/ })).toBeInTheDocument();
    expect(within(lane(container, 1)).getByRole('button', { name: /^\/pricing,/ })).toBeInTheDocument();
  });

  it('puts the focus page in its own lane, tinted', () => {
    const { container } = canvas(tierProps);
    expect(within(lane(container, 3)).getByRole('button', { name: /focus page$/ })).toBeInTheDocument();
    expect(lane(container, 3).className).toContain('bg-primary-subtle');
    expect(lane(container, 1).className).not.toContain('bg-primary-subtle');
  });

  it('says so in a lane with no page, which is a finding', () => {
    const { container } = canvas(tierProps);
    expect(within(lane(container, 2)).getByText('No T2 page in view')).toBeInTheDocument();
    expect(within(lane(container, 2)).getByText('0 pages')).toBeInTheDocument();
  });

  it('shows the Untiered lane only when an untiered page is in view', () => {
    // /old links in and has no tier
    const { container } = canvas(tierProps);
    expect(within(lane(container, 99)).getByText('1 page')).toBeInTheDocument();
    expect(container.querySelector('[data-lane]')).toBe(lane(container, 99));
  });

  it('leaves the Untiered lane out when no untiered page is in view', () => {
    const nothingIn: ListLookup<JourneyNeighbor> = (request) =>
      request.direction === 'in' ? { status: 'ready', items: [], total: 0, otherScopes: [] } : lookup(request);
    const { container } = canvas({ ...tierProps, layout: buildJourney(base, nothingIn) });
    expect(container.querySelector('[data-lane="99"]')).toBeNull();
    expect(container.querySelectorAll('[data-lane]')).toHaveLength(4);
  });

  it('shows a page reached twice as one card, and draws both links', () => {
    const open = new Set(['o:2', 'o:3']);
    const step = canvas({}, { open });
    expect(screen.getAllByRole('button', { name: /^\/blog\/post,/ })).toHaveLength(2);
    step.unmount();
    const { container } = canvas(tierProps, { open });
    expect(screen.getAllByRole('button', { name: /^\/blog\/post,/ })).toHaveLength(1);
    // Two links reach it: one line each, in the order the layout gives them
    const lines = container.querySelectorAll('svg path[marker-end]');
    expect(lines.length).toBe(1 + 1 + 1 + 1 + 1);
  });

  it('leaves out the lane a chip turned off, but never the lane of the focus page', () => {
    const off = canvas({ ...tierProps, hiddenLanes: new Set([1, 3]) });
    expect(off.container.querySelector('[data-lane="1"]')).toBeNull();
    expect(off.container.querySelector('[data-lane="3"]')).not.toBeNull();
    // The cards of the lane that is off are gone with it
    expect(screen.queryByRole('button', { name: /^\/pricing,/ })).toBeNull();
  });

  it('colours a line by the way it goes: up a tier, down a tier, or sideways', () => {
    const { container } = canvas(tierProps, { open: new Set(['o:2']) });
    // /old (untiered) to / and / (T3) to /pricing (T1) go up; /pricing to /blog/post (T3) goes down; / to /blog (T3)
    // goes sideways
    expect(container.querySelectorAll('svg path.stroke-positive-text')).toHaveLength(2);
    expect(container.querySelectorAll('svg path.stroke-info-text')).toHaveLength(1);
    expect(container.querySelectorAll('svg path.stroke-foreground-tertiary[stroke-dasharray]')).toHaveLength(1);
  });

  it('gives the By step lines no direction colours', () => {
    const { container } = canvas({}, { open: new Set(['o:2']) });
    expect(container.querySelectorAll('svg path.stroke-positive-text')).toHaveLength(0);
    expect(container.querySelectorAll('svg path.stroke-info-text')).toHaveLength(0);
  });

  it('has one tab stop, and arrows move between the lanes', async () => {
    const { user } = canvas(tierProps);
    const stops = screen.getAllByRole('button').filter((button) => button.getAttribute('tabindex') === '0');
    expect(stops.filter((button) => button.hasAttribute('data-node'))).toHaveLength(1);
    card('/blog').focus();
    await user.keyboard('{ArrowRight}');
    // T3 lane to the next lane with a card: T1
    expect(card('/pricing')).toHaveFocus();
  });

  it('opens a card as in By step', async () => {
    const onToggleCard = vi.fn();
    const { user } = canvas({ ...tierProps, onToggleCard });
    await user.click(card('/pricing'));
    expect(onToggleCard).toHaveBeenCalledWith('o:2');
  });

  it('fits every lane when they stay at 50 percent or more', () => {
    const onViewChange = vi.fn();
    geometry.world = [1500, 300];
    canvas({ ...tierProps, onViewChange });
    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange.mock.lastCall?.[0].scale).toBeGreaterThanOrEqual(0.5);
  });

  it('shows the lanes nearest T1 at 50 percent when all of them would be smaller', () => {
    const onViewChange = vi.fn();
    geometry.world = [6000, 300];
    canvas({ ...tierProps, onViewChange });
    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange.mock.lastCall?.[0].scale).toBe(0.5);
  });

  it('fits the picture again when the layout is switched, and not on every render', () => {
    const onViewChange = vi.fn();
    const { props, rerender } = canvas({ onViewChange });
    expect(onViewChange).toHaveBeenCalledTimes(1);
    geometry.world = [6000, 300];
    rerender(<LinkCanvas {...props} onViewChange={onViewChange} layoutMode="tier" tiers={TIERS} />);
    expect(onViewChange).toHaveBeenCalledTimes(2);
    rerender(
      <LinkCanvas
        {...props}
        onViewChange={onViewChange}
        layoutMode="tier"
        tiers={TIERS}
        view={{ x: 1, y: 1, scale: 1 }}
      />,
    );
    expect(onViewChange).toHaveBeenCalledTimes(2);
  });

  it('keeps the person’s own view of a page when the canvas is made again in By tier', () => {
    const onViewChange = vi.fn();
    canvas({ ...tierProps, onViewChange, holdsView: true });
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it('adds the direction lines to the legend in By tier only', async () => {
    const step = canvas();
    fireEvent.click(screen.getByRole('button', { name: 'Legend and controls' }));
    expect(screen.queryByText('Up a tier')).toBeNull();
    step.unmount();
    canvas(tierProps);
    fireEvent.click(screen.getByRole('button', { name: 'Legend and controls' }));
    expect(screen.getByText('Up a tier')).toBeInTheDocument();
    expect(screen.getByText('Down a tier')).toBeInTheDocument();
    expect(screen.getByText('Same tier')).toBeInTheDocument();
  });

  it('never shows an equity share', () => {
    const { container } = canvas(tierProps, { open: new Set(['o:2']) });
    expect(container.textContent?.toLowerCase()).not.toContain('equity');
  });

  it('uses the tier position of the focus page for its lane', () => {
    expect(tierPosition(FOCUS.tier)).toBe(3);
  });
});

describe('LinkCanvas, growth that keeps the place (spec 7.5)', () => {
  const closed = buildJourney(base, lookup);
  const opened = (): ReturnType<typeof buildJourney<JourneyNeighbor>> =>
    buildJourney({ ...base, open: new Set(['o:2']) }, lookup);
  const animate = vi.fn();
  const reduceMotion = (reduced: boolean): void => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: reduced && query.includes('reduce'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  };
  const withAnimate = (): void => {
    animate.mockReset();
    animate.mockImplementation(() => ({ finished: Promise.resolve() }));
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true });
  };
  const wrapperOf = (button: HTMLElement): HTMLElement => {
    const wrapper = button.closest<HTMLElement>('[data-card]');
    if (wrapper === null) throw new Error('No card wrapper');
    return wrapper;
  };

  it('pans the view by what the pressed card moved, so it stays where it was on the screen', async () => {
    reduceMotion(true);
    geometry.tops.set('o:2', 200);
    const onViewChange = vi.fn();
    const { props, rerender, user } = canvas({ onViewChange, layout: closed });
    await user.click(card('/pricing'));
    onViewChange.mockClear();
    // The layout under the card changed: it now stands 60 lower, and what it opened stands beside it
    geometry.tops.set('o:2', 260);
    geometry.tops.set('o:2.4', 260);
    rerender(<LinkCanvas {...props} onViewChange={onViewChange} layout={opened()} />);
    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith({ x: 0, y: -60, scale: 1 });
  });

  it('does not move the view when the pressed card did not move', async () => {
    reduceMotion(true);
    geometry.tops.set('o:2', 200);
    const onViewChange = vi.fn();
    const { props, rerender, user } = canvas({ onViewChange, layout: closed });
    await user.click(card('/pricing'));
    onViewChange.mockClear();
    geometry.tops.set('o:2.4', 200);
    rerender(<LinkCanvas {...props} onViewChange={onViewChange} layout={opened()} />);
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it('plays nothing under reduced motion: no glide, no fade, no ghost', async () => {
    reduceMotion(true);
    withAnimate();
    geometry.tops.set('o:2', 200);
    const { props, rerender, user } = canvas({ layout: closed });
    await user.click(card('/pricing'));
    geometry.tops.set('o:3', 30);
    rerender(<LinkCanvas {...props} layout={opened()} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('glides a card that stays from its old place to its new one in 300 ms, ease in and out', async () => {
    reduceMotion(false);
    withAnimate();
    geometry.tops.set('o:2', 200);
    geometry.tops.set('o:3', 0);
    const { props, rerender, user } = canvas({ layout: closed });
    await user.click(card('/pricing'));
    geometry.tops.set('o:3', 30);
    rerender(<LinkCanvas {...props} layout={opened()} />);
    const glide = animate.mock.calls.findIndex(([frames]) => JSON.stringify(frames).includes('translate'));
    expect(glide).toBeGreaterThanOrEqual(0);
    expect(animate.mock.calls[glide]?.[0]).toEqual([{ translate: '0px -30px' }, { translate: '0px 0px' }]);
    expect(animate.mock.calls[glide]?.[1]).toMatchObject({ duration: 300, easing: 'ease-in-out' });
    expect(animate.mock.contexts[glide]).toBe(wrapperOf(card('/blog')));
    // The pressed card does not glide: it stays
    expect(animate.mock.contexts).not.toContain(wrapperOf(card('/pricing')));
  });

  it('fades the cards that came in', async () => {
    reduceMotion(false);
    withAnimate();
    const { props, rerender, user } = canvas({ layout: closed });
    await user.click(card('/pricing'));
    rerender(<LinkCanvas {...props} layout={opened()} />);
    const fade = animate.mock.calls.findIndex(([frames]) => JSON.stringify(frames).includes('opacity'));
    expect(fade).toBeGreaterThanOrEqual(0);
    expect(animate.mock.calls[fade]?.[0]).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(animate.mock.contexts[fade]).toBe(wrapperOf(card('/blog/post')));
  });

  it('fades a closed card out where it stood, as a picture nobody can reach, and then removes it', async () => {
    reduceMotion(false);
    withAnimate();
    const { props, rerender, user, container } = canvas({ layout: opened() });
    await user.click(card('/pricing'));
    expect(screen.getByRole('button', { name: /^\/blog\/post,/ })).toBeInTheDocument();
    rerender(<LinkCanvas {...props} layout={closed} />);
    const ghosts = container.querySelectorAll('[inert]');
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toHaveAttribute('aria-hidden', 'true');
    expect(ghosts[0]?.textContent).toContain('/blog/post');
    // Nothing of it is a card of the canvas: no key to find, no node to focus, no id to repeat
    expect(ghosts[0]?.querySelector('[data-node]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^\/blog\/post,/ })).toBeNull();
    const fadeOut = animate.mock.calls.find(
      ([frames]) => JSON.stringify(frames) === JSON.stringify([{ opacity: 1 }, { opacity: 0 }]),
    );
    expect(fadeOut?.[1]).toMatchObject({ duration: 180 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelectorAll('[inert]')).toHaveLength(0);
  });

  it('does nothing for a change of layout that no press caused', () => {
    reduceMotion(false);
    withAnimate();
    const onViewChange = vi.fn();
    const { props, rerender } = canvas({ layout: closed, onViewChange });
    onViewChange.mockClear();
    animate.mockClear();
    geometry.tops.set('o:3', 30);
    rerender(<LinkCanvas {...props} onViewChange={onViewChange} layout={opened()} />);
    expect(animate).not.toHaveBeenCalled();
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it('does not read the page or play anything when the view pans', async () => {
    reduceMotion(false);
    withAnimate();
    const { props, rerender } = canvas({ layout: closed });
    animate.mockClear();
    const reads = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get');
    reads.mockClear();
    for (let step = 1; step <= 5; step += 1) rerender(<LinkCanvas {...props} view={{ x: step, y: step, scale: 1 }} />);
    expect(animate).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
  });

  it('draws the lines again on every frame while cards glide', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    reduceMotion(false);
    withAnimate();
    geometry.tops.set('o:2', 200);
    geometry.tops.set('o:3', 0);
    const { props, rerender, user, container } = canvas({ layout: closed });
    await user.click(card('/pricing'));
    geometry.tops.set('o:3', 30);
    const gliding = wrapperOf(card('/blog'));
    const real = window.getComputedStyle.bind(window);
    // The browser reports the animated `translate` of the card that glides: it is 30 px above its place
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
      const style = real(element, pseudo);
      return element === gliding
        ? new Proxy(style, {
            get: (target, key) => (key === 'translate' ? '0px -30px' : (Reflect.get(target, key) as unknown)),
          })
        : style;
    });
    rerender(<LinkCanvas {...props} layout={opened()} />);
    const lineTo = (): string =>
      [...container.querySelectorAll('svg path[marker-end]')].map((line) => line.getAttribute('d')).join(' ');
    const first = lineTo();
    expect(first).not.toBe('');
    // A frame passes, the card is further along its glide, and the line follows it
    vi.mocked(window.getComputedStyle).mockImplementation((element: Element, pseudo?: string | null) => {
      const style = real(element, pseudo);
      return element === gliding
        ? new Proxy(style, {
            get: (target, key) => (key === 'translate' ? '0px -10px' : (Reflect.get(target, key) as unknown)),
          })
        : style;
    });
    act(() => {
      for (const callback of frames.splice(0)) callback(100);
    });
    expect(lineTo()).not.toBe(first);
  });
});
