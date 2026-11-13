import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { TopicEngineSections } from './engine-sections';
import { engine, topicRow, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';
import { DRAWER_TOPIC_ID, renderDrawerPart, summaryOf } from '@/test/topic-drawer-harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

describe('TopicEngineSections: the engine sections of the Overview', () => {
  it('draws By engine and then Trend by engine, each in its own state', async () => {
    // The weekly read fails: the panel, which needs only the page summary, is untouched
    server.use(
      http.get(mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary'), () =>
        HttpResponse.json({ status: 500, code: 'internal_error', title: 'x' }, { status: 500 }),
      ),
    );
    const summary = summaryOf([
      topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4, [engine('chatgpt_web', { mentioned: weighted(3, 8, 4) })]),
    ]);
    renderDrawerPart(<TopicEngineSections />, { summary });
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings).toEqual(['By engine', 'Trend by engine']);
    expect(screen.getByRole('list', { name: 'Mention by engine' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
