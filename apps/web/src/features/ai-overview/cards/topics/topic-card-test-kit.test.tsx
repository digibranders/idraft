import { describe, expect, it } from 'vitest';

import {
  cell,
  engineCells,
  promptRow,
  summaryHandler,
  summaryOf,
  topicRow,
  vocabularyHandlers,
} from './topic-card-test-kit';
import { server } from '@/test/msw';

describe('the topic card test kit', () => {
  it('a cell has no value for no valid answer, never 0', () => {
    expect(cell(0, 0).value).toBeNull();
    expect(cell(3, 12).value).toBe(0.25);
  });

  it('a topic cell weights prompts and keeps the answers in pooled', () => {
    expect(cell(6, 12, { prompts: 4 })).toMatchObject({
      denominator: 4,
      value: 0.5,
      pooled: { successes: 6, trials: 12 },
    });
  });

  it('an engine has previous cells and weekly points only when asked', () => {
    const plain = engineCells('chatgpt_web', { mentioned: [5, 10] });
    expect(plain.previous).toBeUndefined();
    expect(plain.series).toBeUndefined();
    const full = engineCells('chatgpt_web', {
      mentioned: [5, 10],
      previous: { mentioned: [2, 10] },
      series: [{ weekStart: '2026-11-09', prompts: 3, mentioned: [1, 4], pool: { weeks: 4 } }],
    });
    expect(full.previous?.mentioned.value).toBe(0.2);
    expect(full.series?.[0]).toMatchObject({ is_pooled: true, pool: { weeks: 4, below_prompts: 10 } });
  });

  it('a summary lists the engine codes of its rows', () => {
    const summary = summaryOf({
      topics: [topicRow('t1', 'SEO', 2, [engineCells('gemini_web', { mentioned: [1, 4] })])],
      prompts: [promptRow('p1', 'best seo tool', ['t1'], [engineCells('chatgpt_web', { mentioned: [1, 4] })])],
    });
    expect(summary.engine_codes).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('summaryHandler answers the summary route with the data envelope, or a response as it is', async () => {
    server.use(summaryHandler(summaryOf({ topics: [topicRow('t1', 'SEO', 2, [])] })));
    const answer = await fetch('http://localhost/api/v1/workspaces/w/projects/p/ai/prompts-summary');
    expect(((await answer.json()) as { data: { topics: unknown[] } }).data.topics).toHaveLength(1);
    server.use(summaryHandler(() => new Response(null, { status: 500 })));
    expect((await fetch('http://localhost/api/v1/workspaces/w/projects/p/ai/prompts-summary')).status).toBe(500);
  });

  it('vocabularyHandlers serve a tree with the parents', async () => {
    server.use(
      ...vocabularyHandlers([
        { id: 'a', name: 'SEO', parent: null },
        { id: 'b', name: 'Local SEO', parent: 'a' },
      ]),
    );
    const list = await fetch('http://localhost/api/v1/workspaces/w/vocabularies?limit=200');
    const [vocabulary] = ((await list.json()) as { data: { vocabulary_id: string }[] }).data;
    const terms = await fetch(
      `http://localhost/api/v1/workspaces/w/vocabularies/${vocabulary?.vocabulary_id ?? ''}/terms`,
    );
    const tree = ((await terms.json()) as { data: { name: string; children: { name: string; parent_id: string }[] }[] })
      .data;
    expect(tree.map((term) => term.name)).toEqual(['SEO']);
    expect(tree[0]?.children[0]).toMatchObject({ name: 'Local SEO', parent_id: 'a' });
  });
});
