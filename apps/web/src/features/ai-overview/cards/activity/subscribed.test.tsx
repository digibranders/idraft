import { act, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AiSpendCard from './ai-spend-card';
import AnswerCalendarCard from './answer-calendar-card';
import AnswerStatusCard from './answer-status-card';
import CollectionStatusCard from './collection-status-card';
import EnginesCard from './engines-card';
import KeyChangesCard from './key-changes-card';
import { recordRequests, renderActivityCard, stopRecording } from '@/test/ai-activity-kit';
import type { CardProps } from '@/features/layouts';
import { stubViewport } from '@/test/customize-harness';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', async () => (await import('@/test/weekly-card-kit')).echartStandIn);

/**
 * Every card of the activity family asks its reads only while it is live (customize mode pauses them): the one place
 * that proves `subscribed: live` reaches each read of each card, since a card that drops it still renders. A card
 * that is not live asks for no runs, schedules or budgets and shows its loading state: the reads are paused, not
 * failed, and not empty.
 */

const CARDS: readonly (readonly [type: string, Card: ComponentType<CardProps>, route: RegExp])[] = [
  ['activity.collection_status', CollectionStatusCard, /\/(runs|schedules)$/],
  ['ops.engines', EnginesCard, /\/schedules$/],
  ['ops.ai_spend', AiSpendCard, /\/budgets\/status$/],
  ['ops.answer_calendar', AnswerCalendarCard, /\/ai\/collection\/daily$/],
  ['ops.answer_status', AnswerStatusCard, /\/ai\/collection\/daily$/],
  ['activity.key_changes', KeyChangesCard, /\/(runs|ai\/collection\/daily|ai\/sources\/changes|ai\/prompts-summary)$/],
];

const LOADING = 'section[aria-busy="true"] [data-slot="skeleton"]';
const pathsOf = (seen: readonly URL[]): string[] => seen.map((url) => url.pathname);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  stopRecording();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(CARDS)('%s', (type, Card, route) => {
  it('a card that is not live makes no request for its reads and shows a skeleton, not an error', async () => {
    const seen = recordRequests();
    const { container } = renderActivityCard(type, Card, { live: false });
    // The engines are read whatever the card does; once they are in, a live card would have asked for its own reads
    await waitFor(() => {
      expect(pathsOf(seen).some((path) => path.endsWith('/engines'))).toBe(true);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(pathsOf(seen).filter((path) => route.test(path))).toEqual([]);
    expect(container.querySelector(LOADING)).not.toBeNull();
    expect(screen.queryByText(/^Could not load/)).not.toBeInTheDocument();
  });

  it('a live card asks for its reads', async () => {
    const seen = recordRequests();
    renderActivityCard(type, Card);
    await waitFor(() => {
      expect(pathsOf(seen).filter((path) => route.test(path)).length).toBeGreaterThan(0);
    });
  });
});

describe('the AI spend card without costs:read', () => {
  it.each([true, false])('makes no budget request with live %s, whatever the card is told', async (live) => {
    const seen = recordRequests();
    renderActivityCard('ops.ai_spend', AiSpendCard, { role: 'viewer', live });
    await screen.findByText('AI spend is not available for your role');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(pathsOf(seen).filter((path) => path.endsWith('/budgets/status'))).toEqual([]);
  });
});
