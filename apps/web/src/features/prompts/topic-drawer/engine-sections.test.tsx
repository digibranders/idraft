import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { TopicEngineSections } from './engine-sections';
import { NO_TOPIC } from '@/features/prompts/prompt-model';
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
  it('draws In search last, and not for the prompts without a topic', async () => {
    // The weekly reads are not what this is about: they fail, as in the test below
    server.use(
      http.get(mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary'), () =>
        HttpResponse.json({ status: 500, code: 'internal_error', title: 'x' }, { status: 500 }),
      ),
    );
    const summary = summaryOf([topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4, [engine('chatgpt_web')])]);
    const { unmount } = renderDrawerPart(<TopicEngineSections />, { summary });
    expect(screen.getAllByRole('heading').at(-1)).toHaveTextContent('In search');
    expect(await screen.findByText('No tracked keyword is given this topic')).toBeInTheDocument();
    unmount();

    renderDrawerPart(<TopicEngineSections />, { summary: summaryOf([topicRow(null, null, 2)]), topicKey: NO_TOPIC });
    expect(screen.queryByRole('heading', { name: 'In search' })).not.toBeInTheDocument();
  });

  it('draws By engine, Trend by engine and the Visibility trend, each in its own state', async () => {
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
    expect(headings).toEqual(['By engine', 'Trend by engine', 'Visibility trend against competitors', 'In search']);
    expect(screen.getByRole('list', { name: 'Mention by engine' })).toBeInTheDocument();
    // Both weekly sections say they failed, one Retry each, and the panel above them is untouched
    expect(await screen.findAllByRole('button', { name: 'Try again' })).toHaveLength(2);
    expect(screen.getByRole('list', { name: 'Mention by engine' })).toBeInTheDocument();
  });
});
