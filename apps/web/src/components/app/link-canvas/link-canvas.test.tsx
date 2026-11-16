import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LinkCanvas, type CanvasFocus, type LinkCanvasProps } from './link-canvas';
import { SingleKeysContext } from '@/lib/a11y/use-shortcut';
import {
  buildJourney,
  cardKey,
  type JourneyNeighbor,
  type JourneyState,
  type ListLookup,
} from '@/lib/internal-links/journey-layout';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

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
  statusCode: 200,
  clickDepth: 0,
};
const base: JourneyState = { focus: '1', scope: 'editorial', open: new Set(), groups: new Set(), more: new Map() };

function canvas(over: Partial<LinkCanvasProps<JourneyNeighbor>> = {}, state: Partial<JourneyState> = {}) {
  const props: LinkCanvasProps<JourneyNeighbor> = {
    layout: buildJourney({ ...base, ...state }, lookup),
    focus: FOCUS,
    zoom: 1,
    pinned: new Set(),
    onTogglePin: vi.fn(),
    onToggleCard: vi.fn(),
    onToggleGroup: vi.fn(),
    onMore: vi.fn(),
    onRefocus: vi.fn(),
    onDetails: vi.fn(),
    onRetry: vi.fn(),
    onFull: vi.fn(),
    ...over,
  };
  return { props, ...renderWithProviders(<LinkCanvas {...props} />) };
}

afterEach(() => document.documentElement.classList.remove('dark'));

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
    expect(within(pricing).getByText('Both ways')).toBeInTheDocument();
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
