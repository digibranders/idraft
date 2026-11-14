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

/** SEO holds the open topic (DRAWER_TOPIC_ID) beside Content and Links; Sales stands alone at the top. */
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
]);

const renderTab = (options: Parameters<typeof renderDrawerPart>[1] = {}) =>
  renderDrawerPart(<RelatedTab />, { summary: SUMMARY, descendants: DESCENDANTS, ...options });
const rows = (): HTMLElement[] =>
  within(screen.getByRole('table', { name: 'Topics beside this one' }))
    .getAllByRole('row')
    .slice(1);

describe('RelatedTab: the topics beside this one', () => {
  it('lists sibling topics with prompts and mention and opens one on the Related tab', async () => {
    const writes: string[] = [];
    const { user } = renderTab({ onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    expect(screen.getByRole('heading', { name: 'Topics beside this one' })).toBeInTheDocument();
    const [content, links] = rows();
    // Most prompts first: Content has 6, Links 2
    expect(content).toHaveTextContent('Content');
    expect(content).toHaveTextContent('6');
    expect(content).toHaveTextContent('50%');
    expect(content).toHaveTextContent('avg of 2');
    expect(links).toHaveTextContent('Links');
    expect(links).toHaveTextContent('25%');
    expect(rows()).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Open the topic Content' }));
    const params = new URLSearchParams(writes.at(-1));
    expect(params.get('inspect')).toBe('topic:content');
    expect(params.get('itab')).toBe('related');
  });

  it('names the count behind the mention rate and the engines averaged in its tooltip', async () => {
    const { user } = renderTab();
    await user.hover(within(rows()[0] ?? document.body).getByText('50%'));
    // Each engine's own count, since a pooled count beside an equal weight percent would read as another rate: in the
    // tooltip for sighted users and in the cell for everyone else
    expect(await screen.findAllByText('ChatGPT 4 of 8 and Gemini 4 of 8')).toHaveLength(2);
    expect(
      screen.getByText('Equal weight average of ChatGPT and Gemini, each engine counting once'),
    ).toBeInTheDocument();
  });

  it('never writes a rate of 0 for a topic with no answer', () => {
    renderTab({
      summary: summaryOf([rowOf(DRAWER_TOPIC_ID, 'Technical SEO', 4), topicRow('content', 'Content', 6, [])]),
    });
    const [content] = rows();
    expect(content).toHaveTextContent('n/a');
    expect(content?.textContent).not.toMatch(/(^|\s)0%/);
  });

  it('lists the other top level topics beside a top level topic', () => {
    renderTab({ topicKey: 'seo', summary: summaryOf([rowOf('seo', 'SEO', 12), rowOf('sales', 'Sales', 3)]) });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Sales');
  });

  it('counts the topics it does not list', () => {
    const tree = [
      term('root', 'Root'),
      term('me', 'Me', 'root'),
      ...Array.from({ length: 13 }, (_, at) =>
        term(`s${String(at)}`, `Sibling ${String(at).padStart(2, '0')}`, 'root'),
      ),
    ];
    const summary = summaryOf([
      rowOf('me', 'Me', 1),
      ...Array.from({ length: 13 }, (_, at) =>
        rowOf(`s${String(at)}`, `Sibling ${String(at).padStart(2, '0')}`, at + 1),
      ),
    ]);
    renderTab({ topicKey: 'me', summary, descendants: topicDescendants(tree, []) });
    expect(rows()).toHaveLength(10);
    expect(screen.getByText('3 more topics are in the Topics table.')).toBeInTheDocument();
    // The ten with the most prompts: Sibling 12 (13 prompts) down to Sibling 03 (4 prompts)
    expect(rows()[0]).toHaveTextContent('Sibling 12');
    expect(rows()[9]).toHaveTextContent('Sibling 03');
  });

  it('is a skeleton while the summary is on its way', () => {
    renderTab({ summary: undefined, counts: { ...READY_COUNTS, status: 'loading' } });
    expect(screen.getByRole('heading', { name: 'Topics beside this one' }).closest('section')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('says why when the topic tree does not hold the topic, and is no endless skeleton', () => {
    renderTab({ descendants: new Map() });
    const section = screen.getByRole('heading', { name: 'Topics beside this one' }).closest('section');
    expect(section).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('No topic beside this one')).toBeInTheDocument();
    expect(
      screen.getByText('The topic tree does not list this topic, so the topics beside it cannot be told.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
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

  it('says there is no sibling when the topic has none in the tree', () => {
    renderTab({
      topicKey: 'content',
      descendants: topicDescendants([term('seo', 'SEO'), term('content', 'Content', 'seo')], []),
      summary: summaryOf([rowOf('content', 'Content', 6)]),
    });
    expect(screen.getByText('No topic beside this one')).toBeInTheDocument();
    expect(screen.getByText('This topic has no sibling in the tree.')).toBeInTheDocument();
  });
});

describe('topicRelatedTab: the tab entry', () => {
  const context = (topicKey: string, descendants: TopicTabContext['descendants']): TopicTabContext => ({
    topicKey,
    summary: SUMMARY,
    counts: READY_COUNTS,
    engines: [projectEngine('chatgpt_web')],
    descendants,
    onOpenPrompt: () => undefined,
  });

  it('is offered only with siblings', () => {
    expect(topicRelatedTab.id).toBe('related');
    const available = topicRelatedTab.available;
    if (available === undefined) throw new Error('The tab has no availability rule');
    expect(available(context(DRAWER_TOPIC_ID, DESCENDANTS))).toBe(true);
    // A top level topic has the other top level topics beside it
    expect(available(context('seo', DESCENDANTS))).toBe(true);
    expect(available(context('sales', topicDescendants([term('sales', 'Sales')], [])))).toBe(false);
    expect(available(context('__none', DESCENDANTS))).toBe(false);
  });

  it('is offered while the tree is not read, so an address that names it keeps its tab', () => {
    expect(topicRelatedTab.available?.(context(DRAWER_TOPIC_ID, new Map()))).toBe(true);
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
    renderDrawerPart(<>{topicRelatedTab.render(context(DRAWER_TOPIC_ID, DESCENDANTS))}</>, {
      summary: SUMMARY,
      descendants: DESCENDANTS,
    });
    expect(screen.getByRole('table', { name: 'Topics beside this one' })).toBeInTheDocument();
  });
});
