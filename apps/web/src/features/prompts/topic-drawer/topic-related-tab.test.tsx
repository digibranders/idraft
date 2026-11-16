import { screen, within } from '@testing-library/react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RelatedTab, topicRelatedTab } from './topic-related-tab';
import { topicDescendants } from '@/features/prompts/prompt-model';
import type { TopicTabContext } from '@/features/prompts/seams/topic-tabs';
import { engine, projectEngine, term, topicRow, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { TopicSummaryRow } from '@/lib/api/types';
import { DRAWER_TOPIC_ID, READY_COUNTS, renderDrawerPart, summaryOf } from '@/test/topic-drawer-harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

/** SEO holds the open group (DRAWER_TOPIC_ID) beside Content and Links; Sales stands alone: four groups, SEO is no row. */
const TREE = [
  term('seo', 'SEO'),
  term(DRAWER_TOPIC_ID, 'Technical SEO', 'seo', 'SEO / Technical SEO'),
  term('content', 'Content', 'seo', 'SEO / Content'),
  term('links', 'Links', 'seo', 'SEO / Links'),
  term('sales', 'Sales'),
];
const DESCENDANTS = topicDescendants(TREE, []);

const rowOf = (key: string, name: string, prompts: number, k = 4, n = 8): TopicSummaryRow =>
  topicRow(key, name, prompts, [
    engine('chatgpt_web', { mentioned: weighted(k, n, prompts) }),
    engine('gemini_web', { mentioned: weighted(k, n, prompts) }),
  ]);
const SUMMARY = summaryOf([
  rowOf('seo', 'SEO', 12),
  rowOf(DRAWER_TOPIC_ID, 'Technical SEO', 4),
  rowOf('content', 'Content', 6),
  rowOf('links', 'Links', 2, 1, 4),
  rowOf('sales', 'Sales', 3),
]);

const renderTab = (options: Parameters<typeof renderDrawerPart>[1] = {}) =>
  renderDrawerPart(<RelatedTab />, {
    summary: SUMMARY,
    descendants: DESCENDANTS,
    ...options,
    extras: { tree: TREE, ...options.extras },
  });
const rows = (): HTMLElement[] =>
  within(screen.getByRole('table', { name: 'Related groups' }))
    .getAllByRole('row')
    .slice(1);

describe('RelatedTab: the other groups of the scope', () => {
  it('lists the other groups with prompts and mention, most prompts first, and opens one on the Related tab', async () => {
    const writes: string[] = [];
    const { user } = renderTab({ onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    expect(screen.getByRole('heading', { name: 'Related groups' })).toBeInTheDocument();
    expect(screen.getByText('other groups in this scope')).toBeInTheDocument();
    const [content, sales, links] = rows();
    // No parent row (SEO) and not the open group itself; Content has 6 prompts, Sales 3, Links 2
    expect(rows()).toHaveLength(3);
    expect(content).toHaveTextContent('Content');
    expect(content).toHaveTextContent('6');
    expect(content).toHaveTextContent('50%');
    expect(sales).toHaveTextContent('Sales');
    expect(links).toHaveTextContent('Links');
    expect(links).toHaveTextContent('25%');

    await user.click(screen.getByRole('button', { name: 'Open the group Content' }));
    const params = new URLSearchParams(writes.at(-1));
    expect(params.get('inspect')).toBe('topic:content');
    expect(params.get('itab')).toBe('related');
  });

  it('names the count behind the mention rate and the platforms averaged in its tooltip', async () => {
    const { user } = renderTab();
    await user.hover(within(rows()[0] ?? document.body).getByText('50%'));
    // Each platform's own count, since a pooled count beside an equal weight percent would read as another rate: in the
    // tooltip for sighted users and in the cell for everyone else
    expect((await screen.findAllByText('ChatGPT 4 of 8 and Gemini 4 of 8')).length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText('Equal weight average of ChatGPT and Gemini, each platform and each prompt counting once'),
    ).toBeInTheDocument();
  });

  it('never writes a rate of 0 for a group with no answer', () => {
    renderTab({
      summary: summaryOf([rowOf(DRAWER_TOPIC_ID, 'Technical SEO', 4), topicRow('content', 'Content', 6, [])]),
    });
    const [content] = rows();
    expect(content).toHaveTextContent('n/a');
    expect(content?.textContent).not.toMatch(/(^|\s)0%/);
  });

  it('lists five at most', () => {
    const tree = Array.from({ length: 8 }, (_, at) => term(`g${at}`, `Group ${at}`));
    const summary = summaryOf(tree.map((entry, at) => rowOf(entry.termId, entry.name, at + 1)));
    renderTab({ topicKey: 'g0', summary, descendants: topicDescendants(tree, []), extras: { tree } });
    expect(rows()).toHaveLength(5);
    // Largest first: Group 7 holds 8 prompts
    expect(rows()[0]).toHaveTextContent('Group 7');
  });

  it('is a skeleton while the summary is on its way', () => {
    renderTab({ summary: undefined, counts: { ...READY_COUNTS, status: 'loading' } });
    expect(screen.getByRole('heading', { name: 'Related groups' }).closest('section')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('says a failed read of the page with Retry and keeps the drawer', async () => {
    const retry = vi.fn();
    const { user } = renderTab({
      summary: undefined,
      counts: { status: 'failed', errorId: null, retry, retrying: false },
    });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says there is no other group when the scope holds only this one', () => {
    renderTab({ summary: summaryOf([rowOf(DRAWER_TOPIC_ID, 'Technical SEO', 4)]) });
    expect(screen.getByText('No other group is in this scope.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('topicRelatedTab: the tab entry', () => {
  const context = (topicKey: string): TopicTabContext => ({
    topicKey,
    summary: SUMMARY,
    counts: READY_COUNTS,
    engines: [projectEngine('chatgpt_web')],
    descendants: DESCENDANTS,
    onOpenPrompt: () => undefined,
  });

  it('is always offered, as the preview offers it', () => {
    expect(topicRelatedTab.id).toBe('related');
    expect(topicRelatedTab.available).toBeUndefined();
    expect(context(DRAWER_TOPIC_ID).topicKey).toBe(DRAWER_TOPIC_ID);
  });

  it('is named Related and placed after the Competitors tab', () => {
    function Label(): ReactElement {
      return <p>{topicRelatedTab.label(useTranslations())}</p>;
    }
    renderDrawerPart(<Label />);
    expect(screen.getByText('Related')).toBeInTheDocument();
    expect(topicRelatedTab.after).toBe('competitors');
  });

  it('renders the Related section as its panel', () => {
    renderDrawerPart(<>{topicRelatedTab.render(context(DRAWER_TOPIC_ID))}</>, {
      summary: SUMMARY,
      descendants: DESCENDANTS,
      extras: { tree: TREE },
    });
    expect(screen.getByRole('table', { name: 'Related groups' })).toBeInTheDocument();
  });
});
