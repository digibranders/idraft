import { screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AnswerCalendarCard from './answer-calendar-card';
import AnswerStatusCard from './answer-status-card';
import { twoWeeks } from './model/daily-fixtures';
import { PROJECT, renderActivityCard } from '@/test/ai-activity-kit';
import type { CardProps } from '@/features/layouts';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', async () => (await import('@/test/weekly-card-kit')).echartStandIn);

/**
 * The two collection-day cards must not move when their days arrive. jsdom has no layout, so this asserts what the
 * layout is made of: the loading frame holds the same rows as the loaded one (the engine tabs, the views group, which
 * wrap like the real ones), and the room the loaded card takes at narrow widths (a meta line that wraps, and for the
 * calendar its key) is reserved by container-width classes, never by a fixed height that is wrong at wide widths.
 */

const DAILY = `${PROJECT}/ai/collection/daily`;
const CARDS: readonly (readonly [string, ComponentType<CardProps>, string, readonly string[]])[] = [
  ['ops.answer_calendar', AnswerCalendarCard, 'Answer collection calendar', ['h-0 @max-md:h-5', 'h-0 @max-md:h-6']],
  ['ops.answer_status', AnswerStatusCard, 'Answer status by engine and day', ['h-0 @max-md:h-5']],
];

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const frameOf = async (title: string): Promise<HTMLElement> => {
  const heading = await screen.findByRole('heading', { name: title });
  const frame = heading.closest('section');
  if (frame === null) throw new Error('The card has no frame');
  return frame;
};

describe.each(CARDS)('%s while it loads', (type, Card, title, reserve) => {
  it('holds the rows the loaded card has: the engine tabs and the views group, in the frame controls row', async () => {
    server.use(http.get(DAILY, async () => delay('infinite')));
    renderActivityCard(type, Card);
    const frame = await frameOf(title);
    const tabs = frame.querySelector('[data-slot="controls-placeholder"]');
    const views = frame.querySelector('[data-slot="views-placeholder"]');
    expect(tabs).not.toBeNull();
    expect(views).not.toBeNull();
    // Siblings in one row, as the tabs and the views group are once loaded; the views sit at the end of the row
    expect(tabs?.parentElement).toBe(views?.parentElement);
    expect(views).toHaveClass('ml-auto');
    // The tabs placeholder wraps like the real toolbar, and is as tall as a control
    expect(tabs).toHaveClass('flex', 'flex-wrap', 'gap-2');
    expect(tabs?.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Engine' })).not.toBeInTheDocument();
  });

  it('reserves, by the width of the card, the room the loaded card takes when it is narrow', async () => {
    server.use(http.get(DAILY, async () => delay('infinite')));
    renderActivityCard(type, Card);
    const frame = await frameOf(title);
    const room = frame.querySelector('[data-slot="narrow-reserve"]');
    expect(room).not.toBeNull();
    expect(room).toHaveClass('@container');
    expect([...(room?.children ?? [])].map((part) => part.className)).toEqual(reserve);
    // Hidden from assistive technology, and in the footnote block, which is the full width of the frame
    expect(room).toHaveAttribute('aria-hidden', 'true');
    expect(room?.parentElement).toHaveClass('type-meta');
  });

  it('has the loaded rows, and no placeholder or reserve, once the days arrive', async () => {
    server.use(http.get(DAILY, () => HttpResponse.json(twoWeeks())));
    renderActivityCard(type, Card);
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: 'Engine' })).toBeInTheDocument();
    });
    const frame = await frameOf(title);
    expect(frame.querySelector('[data-slot="controls-placeholder"]')).toBeNull();
    expect(frame.querySelector('[data-slot="views-placeholder"]')).toBeNull();
    expect(frame.querySelector('[data-slot="narrow-reserve"]')).toBeNull();
    expect(screen.getByRole('group', { name: `${title} view` })).toBeInTheDocument();
  });
});
