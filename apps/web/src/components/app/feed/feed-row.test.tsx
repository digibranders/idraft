import { screen, within } from '@testing-library/react';
import { TrendingUp } from 'lucide-react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { FeedRow, type FeedItem } from './feed-row';
import {
  formatDetailDateTime,
  formatMetricDelta,
  formatRankChange,
  formatRelative,
  formatTime,
  type MetricDeltaInput,
  type RankChange,
} from '@/lib/format';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NOW = new Date('2026-09-29T12:00:00Z');
const AT = '2026-09-29T06:12:00Z';
const HREF = '/rankings?inspect=keyword:crm' as Route;

const HOSTILE = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(1)</script>',
  '"><svg onload=alert(1)>',
  'javascript:alert(1)',
  // A right-to-left override, written as a code point so the file stays ASCII
  `${String.fromCharCode(0x202e)}gnp.exe`,
] as const;

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return { id: 'e1', glyph: TrendingUp, text: 'ChatGPT mention rate rose', at: AT, href: HREF, ...overrides };
}

function metric(overrides: Partial<MetricDeltaInput> = {}): MetricDeltaInput {
  return { value: 0.034, unit: 'points', polarity: 'higher_is_better', isDetectable: true, ...overrides };
}

function renderRow(item: FeedItem, form: 'compact' | 'full' = 'compact'): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <ul>
      <FeedRow item={item} form={form} timeZone="UTC" now={NOW} />
    </ul>,
  );
}

const glyph = (container: HTMLElement): Element | null => container.querySelector('li [data-slot="icon"]');

describe('FeedRow compact', () => {
  it('is one list item holding one link to the evidence, with a hidden glyph, the sentence and the time', () => {
    const { container } = renderRow(feedItem());
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    const links = within(items[0] as HTMLElement).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', HREF);
    expect(links[0]).toHaveTextContent('ChatGPT mention rate rose');
    expect(glyph(container)).toHaveAttribute('aria-hidden', 'true');
    const time = container.querySelector('time');
    expect(time).toHaveAttribute('datetime', AT);
    expect(time).toHaveTextContent(formatRelative(AT, 'UTC', NOW));
    expect(time).toHaveClass('w-32', 'shrink-0', 'text-right', 'num');
  });

  it('shows a ring on keyboard focus and a hover fill on the link', async () => {
    const { user } = renderRow(feedItem());
    await user.tab();
    const link = screen.getByRole('link');
    expect(link).toHaveFocus();
    expect(link.className).toContain('focus-visible:focus-ring-inset');
    expect(link.className).toContain('hover:bg-surface-hover');
  });

  it('draws a detectable metric change with Delta and colours the glyph and the value by its tone', () => {
    const input = metric();
    const { container } = renderRow(feedItem({ change: { kind: 'metric', input } }));
    const value = screen.getByText(formatMetricDelta(input).text);
    expect(value).toHaveClass('text-positive-text');
    expect(glyph(container)).toHaveClass('text-positive-text');
    // The change is words first: the link's name carries it, the sign and size are drawn and hidden
    expect(screen.getByRole('link')).toHaveAccessibleName(/up 3\.4 pts, detectable/);
  });

  it('colours a detectable decline negative', () => {
    const input = metric({ value: -0.06 });
    const { container } = renderRow(feedItem({ change: { kind: 'metric', input } }));
    expect(screen.getByText(formatMetricDelta(input).text)).toHaveClass('text-negative-text');
    expect(glyph(container)).toHaveClass('text-negative-text');
  });

  it.each([false, null])('leaves a change neutral when its detectability is %s', (isDetectable) => {
    const input = metric({ isDetectable });
    const { container } = renderRow(feedItem({ change: { kind: 'metric', input } }));
    const value = screen.getByText(formatMetricDelta(input).text);
    expect(value).not.toHaveClass('text-positive-text');
    expect(value).not.toHaveClass('text-negative-text');
    expect(glyph(container)).toHaveClass('text-foreground-tertiary');
    expect(glyph(container)).not.toHaveClass('text-positive-text');
  });

  it('draws no change slot content and a tertiary glyph without a change or without a comparison', () => {
    const none = renderRow(feedItem());
    expect(glyph(none.container)).toHaveClass('text-foreground-tertiary');
    none.unmount();
    const empty = renderRow(feedItem({ change: { kind: 'metric', input: metric({ value: null }) } }));
    expect(glyph(empty.container)).toHaveClass('text-foreground-tertiary');
    expect(empty.container.querySelector('.num.type-meta:not(time)')).toBeNull();
  });

  it('draws a rank change from formatRankChange with the same tone rule', () => {
    const emphasized: RankChange = { kind: 'improved', positions: 5, emphasized: true };
    const first = renderRow(feedItem({ change: { kind: 'rank', change: emphasized } }));
    expect(screen.getByText(formatRankChange(emphasized).text)).toHaveClass('text-positive-text');
    expect(glyph(first.container)).toHaveClass('text-positive-text');
    expect(screen.getByRole('link')).toHaveAccessibleName(/improved 5 positions/);
    first.unmount();
    const small: RankChange = { kind: 'declined', positions: 1, emphasized: false };
    const second = renderRow(feedItem({ change: { kind: 'rank', change: small } }));
    const shown = screen.getByText(formatRankChange(small).text);
    expect(shown).not.toHaveClass('text-negative-text');
    expect(glyph(second.container)).toHaveClass('text-foreground-tertiary');
  });

  it('keeps the change slot from shrinking', () => {
    const { container } = renderRow(feedItem({ change: { kind: 'metric', input: metric() } }));
    expect(container.querySelector('[data-slot="feed-change"]')).toHaveClass('shrink-0');
  });

  it('wraps the sentence to two lines, not one truncated line, with the full text in its title', () => {
    const long = 'ChatGPT citation rate fell to 21.6% (143 of 662 answers) in the last 28 days, down from 29.9%';
    renderRow(feedItem({ text: long }));
    const sentence = screen.getByText(long);
    expect(sentence).toHaveClass('line-clamp-2', 'min-w-0', 'flex-1');
    expect(sentence).not.toHaveClass('truncate');
    expect(sentence).toHaveAttribute('title', long);
    expect(sentence).toHaveAttribute('data-truncate');
  });

  it.each(HOSTILE)('renders hostile text as text: %s', (text) => {
    const { container } = renderRow(feedItem({ text }));
    expect(screen.getByRole('link')).toHaveTextContent(text);
    expect(container.querySelector('img, script, svg[onload]')).toBeNull();
    expect(container.querySelector('li svg:not([data-slot="icon"])')).toBeNull();
  });

  it('gives the time slot room for the longest string formatRelative returns (a different year)', () => {
    const old = '2025-12-29T18:32:00Z';
    const text = formatRelative(old, 'UTC', NOW);
    expect(text).toBe('Dec 29, 2025, 18:32');
    const { container } = renderRow(feedItem({ at: old }));
    const time = container.querySelector('time');
    expect(time).toHaveTextContent(text);
    // 128 px: "Dec 29, 2025, 18:32" is about 118 px, which the old 96 px slot clipped
    expect(time).toHaveClass('w-32', 'shrink-0', 'whitespace-nowrap');
    expect(time).not.toHaveClass('w-24');
  });

  it('draws a row without an href as a plain div: no link, no hover fill, no focus ring, not focusable', async () => {
    const { container, user } = renderRow(feedItem({ href: undefined, change: { kind: 'metric', input: metric() } }));
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(container.querySelector('a')).toBeNull();
    const row = container.querySelector('li > div') as HTMLElement;
    expect(row).toHaveTextContent('ChatGPT mention rate rose');
    expect(row.className).not.toContain('hover:');
    expect(row.className).not.toContain('focus-visible');
    expect(row).not.toHaveAttribute('tabindex');
    await user.tab();
    expect(document.body).toHaveFocus();
    // The rest of the row is unchanged: glyph, change and time are all still drawn
    expect(glyph(container)).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[data-slot="feed-change"]')).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('datetime', AT);
  });

  it('replaces the relative time with atLabel and keeps the exact time reachable', () => {
    const { container } = renderRow(feedItem({ atLabel: '28 days' }));
    const time = container.querySelector('time') as HTMLElement;
    expect(time).toHaveTextContent('28 days');
    expect(time).not.toHaveTextContent(formatRelative(AT, 'UTC', NOW));
    expect(time).toHaveAttribute('datetime', AT);
    expect(time).toHaveAttribute('title', formatDetailDateTime(AT, 'UTC'));
    expect(time).toHaveClass('w-32', 'shrink-0', 'text-right', 'num');
  });

  it('draws atLabel in a row without an href too', () => {
    const { container } = renderRow(feedItem({ href: undefined, atLabel: '28 days' }));
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(container.querySelector('time')).toHaveTextContent('28 days');
  });

  it.each(['light', 'dark'])('has no violation in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const { container } = renderRow(feedItem({ change: { kind: 'metric', input: metric() } }));
      expect(await axe(container)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });

  it('has no violation in a row without an href', async () => {
    const { container } = renderRow(feedItem({ href: undefined, atLabel: '28 days' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('FeedRow full', () => {
  const full = feedItem({
    text: 'best crm for startups improved from 5 to 3',
    typeLabel: 'Rank move',
    sourceLabel: 'SERP check',
    change: { kind: 'rank', change: { kind: 'improved', positions: 2, emphasized: false } },
  });

  it('shows the clock time, the glyph, the sentence, the type badge, the source and a named View link', () => {
    const { container } = renderRow(full, 'full');
    const time = container.querySelector('time');
    expect(time).toHaveAttribute('datetime', AT);
    expect(time).toHaveTextContent(formatTime(AT, 'UTC'));
    expect(glyph(container)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('best crm for startups improved from 5 to 3')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="badge"]')).toHaveTextContent('Rank move');
    expect(screen.getByText('SERP check')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'View: best crm for startups improved from 5 to 3' });
    expect(link).toHaveAttribute('href', HREF);
    expect(link).toHaveTextContent('View');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  const slot = (container: HTMLElement, name: 'feed-type' | 'feed-source'): HTMLElement | null =>
    container.querySelector(`[data-slot="${name}"]`);

  it('draws no badge and no source text when they are not given, but keeps both slots (hidden from assistive technology)', () => {
    const { container } = renderRow(feedItem(), 'full');
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(slot(container, 'feed-type')).toHaveClass('w-32', 'shrink-0');
    expect(slot(container, 'feed-type')).toHaveAttribute('aria-hidden', 'true');
    expect(slot(container, 'feed-source')).toHaveClass('w-24', 'shrink-0');
    expect(slot(container, 'feed-source')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['only a badge', { typeLabel: 'Rank move' }],
    ['only a source', { sourceLabel: 'SERP check' }],
    ['both', { typeLabel: 'Rank move', sourceLabel: 'SERP check' }],
    ['neither', {}],
  ] as const)('keeps the badge, source and View slots at the same widths and order with %s', (_name, extra) => {
    const { container } = renderRow(feedItem(extra), 'full');
    const row = container.querySelector('li') as HTMLElement;
    const slots = [...row.children].map((child) => child.getAttribute('data-slot') ?? child.tagName.toLowerCase());
    // The sr-only type text, when there is one, is out of the flow; the visible slots never move
    expect(slots.filter((name) => name !== 'span')).toEqual([
      'time',
      'icon',
      'truncate',
      'feed-type',
      'feed-source',
      'text-link',
    ]);
    expect(slot(container, 'feed-type')).toHaveClass('w-32');
    expect(slot(container, 'feed-source')).toHaveClass('w-24');
  });

  it('hides the badge below @md and keeps its text for screen readers there', () => {
    const { container } = renderRow(feedItem({ typeLabel: 'Rank move' }), 'full');
    const type = slot(container, 'feed-type') as HTMLElement;
    expect(type).toHaveClass('hidden', '@md:block');
    expect(type).not.toHaveAttribute('aria-hidden');
    const spoken = container.querySelector('li > .sr-only');
    expect(spoken).toHaveTextContent('Rank move');
    expect(spoken).toHaveClass('@md:hidden');
  });

  it('names a hostile sentence in the link and renders it as text', () => {
    const text = '<img src=x onerror=alert(1)>';
    const { container } = renderRow(feedItem({ text }), 'full');
    expect(screen.getByRole('link', { name: `View: ${text}` })).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps truncating the sentence to one line (only the compact form wraps)', () => {
    renderRow(full, 'full');
    const sentence = screen.getByText('best crm for startups improved from 5 to 3');
    expect(sentence).toHaveClass('truncate');
    expect(sentence).not.toHaveClass('line-clamp-2');
  });

  it('draws a row without an href with no View link, no hover fill, and the same slot widths', () => {
    const { container } = renderRow({ ...full, href: undefined }, 'full');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: /^View/ })).toBeNull();
    const row = container.querySelector('li') as HTMLElement;
    expect(row.className).not.toContain('hover:');
    expect(slot(container, 'feed-type')).toHaveClass('w-32', 'shrink-0');
    expect(slot(container, 'feed-source')).toHaveClass('w-24', 'shrink-0');
    // The View column keeps its width, so the badge and source columns line up with the rows that have a link
    const spacer = container.querySelector('[data-slot="feed-view-spacer"]');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(spacer).toHaveClass('invisible', 'shrink-0');
  });

  it('replaces the clock time with atLabel and keeps the exact time reachable', () => {
    const { container } = renderRow({ ...full, atLabel: '28 days' }, 'full');
    const time = container.querySelector('time') as HTMLElement;
    expect(time).toHaveTextContent('28 days');
    expect(time).not.toHaveTextContent(formatTime(AT, 'UTC'));
    expect(time).toHaveAttribute('datetime', AT);
    expect(time).toHaveAttribute('title', formatDetailDateTime(AT, 'UTC'));
  });

  it('gives the clock time no title when there is no atLabel', () => {
    const { container } = renderRow(full, 'full');
    expect(container.querySelector('time')).not.toHaveAttribute('title');
  });

  it('has no violation in a row without an href', async () => {
    const { container } = renderRow({ ...full, href: undefined, atLabel: '28 days' }, 'full');
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(['light', 'dark'])('has no violation in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const { container } = renderRow(full, 'full');
      expect(await axe(container)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });
});
