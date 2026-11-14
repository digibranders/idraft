import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EVENTUS_DEFINITION } from '@/mocks/ai-prompt-definition';
import { installPromptsClock, renderPrompts, serveSchedules, type ScheduleServing } from '@/test/prompts-header-kit';
// A topic drawer reads the entities and the tracked keywords: the harness answers both with none
import '@/test/topic-drawer-harness';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

installPromptsClock();

const SCHEDULES_URL = 'http://localhost/api/v1/workspaces/w/projects/p/schedules';

async function scheduledWeekdays(serving: ScheduleServing): Promise<number[] | number> {
  serveSchedules(serving);
  const answer = await fetch(SCHEDULES_URL);
  if (!answer.ok) return answer.status;
  const body = (await answer.json()) as { data: { weekday: number; is_active: boolean }[] };
  return body.data.map((row) => row.weekday);
}

describe('the test kit of the Topics and Prompts header', () => {
  it('renders the Prompts page of Fynix for a viewer', async () => {
    renderPrompts({ search: '?tab=prompts' });
    expect(await screen.findByRole('grid', { name: 'Prompts' })).toBeInTheDocument();
  });

  it('renders the prompts of Eventus Security when asked, which turns its data set on', async () => {
    renderPrompts({ search: '?tab=prompts', project: 'eventus' });
    const grid = await screen.findByRole('grid', { name: 'Prompts' });
    const texts = EVENTUS_DEFINITION.prompts.map((prompt) => prompt.text);
    await waitFor(() => {
      expect(texts.some((text) => within(grid).queryByText(text) !== null)).toBe(true);
    });
    expect(within(grid).queryByText('Which SEO agency is best for a SaaS startup in Germany?')).toBeNull();
  });

  it('records every URL write the page makes, with its history mode', async () => {
    const { user, writes } = renderPrompts({ search: '?tab=prompts' });
    await screen.findByRole('grid', { name: 'Prompts' });
    await user.click(screen.getByRole('radio', { name: 'Topics' }));
    await waitFor(() => {
      expect(writes.length).toBeGreaterThan(0);
    });
    // Topics is the page's default tab, so the write drops the key that named the Prompts tab
    expect(writes.at(-1)?.queryString).not.toContain('tab=prompts');
  });

  it('serves the schedules a test asks for', async () => {
    expect(await scheduledWeekdays([1, 4])).toEqual([1, 4]);
    expect(await scheduledWeekdays('none')).toEqual([]);
    expect(await scheduledWeekdays('paused')).toEqual([1, 4]);
    expect(await scheduledWeekdays('fail')).toBe(500);
  });
});
