import { act, waitFor } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { Suspense, useEffect, type ComponentType, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TopicData } from './model-types';
import { READ, useTopicPeriods, useTopicSummary } from './use-topic-reads';
import { OverviewProvider, useOverview } from '../../overview-context';
import type { ScopePatch } from '../../scope/scope-model';
import type { CardProps } from '@/features/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { EVENTUS_WORLD } from '@/mocks/ai-prompt-world';
import { setAiSeeded } from '@/mocks/ai-seed';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { handlers } from '@/mocks/handlers';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { cardInOverview, overviewProject, type OverviewWorld } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';
import { engineRates } from '@/lib/rates/strip-model';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const NOW = new Date('2026-11-12T12:00:00Z');
const SUMMARY = mswPath('/api/v1/workspaces/:w/projects/:p/ai/prompts-summary');

/** What the probe card saw last: the hook's data and the scope setter of the page. */
const seen: { data: TopicData | null; setScope: ((patch: ScopePatch) => void) | null } = {
  data: null,
  setScope: null,
};
const current = (): TopicData => {
  if (seen.data === null) throw new Error('the probe has not rendered yet');
  return seen.data;
};

/** Calls the hook under test and keeps what it returned. */
function Reader({ read }: { read: () => TopicData }): ReactElement {
  const data = read();
  const { setScope } = useOverview();
  useEffect(() => {
    seen.data = data;
    seen.setScope = setScope;
  });
  return <p>{data.phase}</p>;
}

/** A card made of the reader. */
const probe = (read: () => TopicData): ComponentType<CardProps> =>
  function Probe(): ReactElement {
    return <Reader read={read} />;
  };

/**
 * The reader inside the provider alone, with no layout around it: a project with no engine on shows no card in the
 * customizable grid, and what the hook says then is the thing to test.
 */
function renderBare(read: () => TopicData, world: OverviewWorld): ReturnType<typeof renderWithProviders> {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('admin')}>
      <Suspense fallback={null}>
        <OverviewProvider
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={overviewProject(world)}
        >
          <Reader read={read} />
        </OverviewProvider>
      </Suspense>
    </PermissionProvider>,
  );
}

function renderProbe(
  read: () => TopicData,
  { world = 'fynix', searchParams = '' }: { world?: OverviewWorld; searchParams?: string } = {},
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(cardInOverview({ type: 'ai.topic_heatmap', Card: probe(read), world }), { searchParams });
}

const ready = async (): Promise<void> => {
  await waitFor(() => {
    expect(current().phase).toBe('ready');
  });
};

/** The requests the server sees from now until the test ends. */
const listeners: ((info: { request: Request }) => void)[] = [];
function recordRequests(): URL[] {
  const urls: URL[] = [];
  const listener = ({ request }: { request: Request }): void => {
    urls.push(new URL(request.url));
  };
  listeners.push(listener);
  server.events.on('request:start', listener);
  return urls;
}
const summaryRequests = (urls: readonly URL[]): URL[] =>
  urls.filter((url) => url.pathname.endsWith('/ai/prompts-summary'));

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubViewport();
  seen.data = null;
  seen.setScope = null;
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAiSeeded(false);
});

// V4 of the plan: the series cards rest on topic rows that carry weekly points from the mock
describe('the mock the series cards are built on', () => {
  it('the mock gives topic rows weekly series on Fynix and Eventus with rows=topics', async () => {
    renderProbe(() => useTopicSummary(READ.topicSeries));
    await ready();
    const fynix = current().summary?.topics ?? [];
    expect(fynix.length).toBeGreaterThan(0);
    expect(fynix.some((topic) => topic.engines.some((cells) => (cells.series?.length ?? 0) > 0))).toBe(true);
    expect(current().summary?.prompts).toEqual([]);
    expect(current().promptsRead).toBe(false);
  });

  it('the mock gives topic rows weekly series on Eventus with rows=topics', async () => {
    setAiSeeded(true);
    renderProbe(() => useTopicSummary(READ.topicSeries), { world: 'eventus-security' });
    await ready();
    const topics = current().summary?.topics ?? [];
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.some((topic) => topic.engines.some((cells) => (cells.series?.length ?? 0) > 0))).toBe(true);
  });
});

describe('what the hooks ask', () => {
  it('default options ask the summary once with no include and no rows', async () => {
    const urls = recordRequests();
    renderProbe(() => useTopicSummary());
    await ready();
    const asked = summaryRequests(urls);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.has('include')).toBe(false);
    expect(asked[0]?.searchParams.has('rows')).toBe(false);
    expect(asked[0]?.searchParams.get('from')).toBe('2026-10-16');
    expect(current()).toMatchObject({ paired: true, compared: false, previous: null, previousNodes: null });
  });

  it('READ.topicSeries asks include=series and rows=topics', async () => {
    const urls = recordRequests();
    renderProbe(() => useTopicSummary(READ.topicSeries));
    await ready();
    const asked = summaryRequests(urls);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.get('include')).toBe('series');
    expect(asked[0]?.searchParams.get('rows')).toBe('topics');
  });

  it('READ.promptSeries asks include=series only', async () => {
    const urls = recordRequests();
    renderProbe(() => useTopicSummary(READ.promptSeries));
    await ready();
    const asked = summaryRequests(urls);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.get('include')).toBe('series');
    expect(asked[0]?.searchParams.has('rows')).toBe(false);
    expect(current().promptsRead).toBe(true);
    expect(current().prompts.length).toBeGreaterThan(0);
  });

  it('useTopicPeriods asks both windows and reports paired and compared', async () => {
    const urls = recordRequests();
    renderProbe(() => useTopicPeriods());
    await waitFor(() => {
      expect(current().compared).toBe(true);
    });
    const froms = summaryRequests(urls).map((url) => url.searchParams.get('from'));
    expect(froms.sort()).toEqual(['2026-09-18', '2026-10-16']);
    expect(current()).toMatchObject({ phase: 'ready', paired: true, settled: true });
    expect(current().previous).not.toBeNull();
    expect(current().previousNodes).not.toBeNull();
    expect(current().previousPrompts).not.toBeNull();
  });

  it('compare off gives no previous and compared false', async () => {
    const urls = recordRequests();
    renderProbe(() => useTopicPeriods(), { searchParams: 'cmp=off' });
    await ready();
    expect(summaryRequests(urls)).toHaveLength(1);
    expect(current()).toMatchObject({ compared: false, previous: null, previousNodes: null, previousPrompts: null });
  });

  it('while the windows are not paired the previous is null', async () => {
    renderProbe(() => useTopicPeriods());
    await waitFor(() => {
      expect(current().compared).toBe(true);
    });
    // The next scope is held back: the last data stays on screen, and the two windows answer for different scopes
    const release = gate();
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        await release.promise;
        return getResponse([...handlers], new Request(request.url, { headers: request.headers }));
      }),
    );
    act(() => {
      seen.setScope?.({ engines: ['chatgpt_web'] });
    });
    await waitFor(() => {
      expect(current().settled).toBe(false);
    });
    expect(current()).toMatchObject({ paired: false, compared: false, previous: null, phase: 'refetching' });
    expect(current().summary).toBeDefined();
    release.open();
    await waitFor(() => {
      expect(current()).toMatchObject({ paired: true, compared: true, settled: true });
    });
  });
});

describe('the engines asked', () => {
  it('no asked engine is idle and asks nothing', async () => {
    const urls = recordRequests();
    renderBare(() => useTopicSummary(), 'cleanstart');
    await waitFor(() => {
      expect(current().phase).toBe('idle');
    });
    expect(current()).toMatchObject({ engines: [], summary: undefined, nodes: [], aggregates: null });
    expect(summaryRequests(urls)).toEqual([]);
  });

  it('the engines are the enabled ones inside the engine filter in catalog order', async () => {
    renderProbe(() => useTopicSummary(), { searchParams: 'engine=gemini_web,chatgpt_web' });
    await ready();
    expect(current().engines).toEqual([
      { code: 'chatgpt_web', label: 'ChatGPT' },
      { code: 'gemini_web', label: 'Gemini' },
    ]);
  });
});

describe('failures', () => {
  it('a failed read is error with an error id and retry refetches', async () => {
    const urls = recordRequests();
    server.use(http.get(SUMMARY, () => failing('req_topic_1'), { once: true }));
    renderProbe(() => useTopicSummary());
    await waitFor(() => {
      expect(current().phase).toBe('error');
    });
    expect(current()).toMatchObject({ errorId: 'req_topic_1', summary: undefined, stale: false });
    act(() => {
      current().retry();
    });
    await ready();
    expect(current().errorId).toBeNull();
    expect(summaryRequests(urls)).toHaveLength(2);
  });

  it('a failed refetch keeps the data and sets stale', async () => {
    renderProbe(() => useTopicSummary());
    await ready();
    const before = current().summary;
    server.use(http.get(SUMMARY, () => failing('req_topic_2'), { once: true }));
    act(() => {
      current().retry();
    });
    await waitFor(() => {
      expect(current().stale).toBe(true);
    });
    expect(current()).toMatchObject({ phase: 'ready', errorId: 'req_topic_2' });
    expect(current().summary).toEqual(before);
    expect(current().nodes.length).toBeGreaterThan(0);
  });
});

/**
 * Serves the whole summary whatever topic the request filters to, as an API that narrows prompts and not the rows of
 * the topics above them would (D17): the cards must narrow the rows themselves.
 */
function serveWholeSummary(): void {
  server.use(
    http.get(SUMMARY, ({ request }) => {
      const url = new URL(request.url);
      url.searchParams.delete('filter[term]');
      return getResponse([...handlers], new Request(url, { headers: request.headers }));
    }),
  );
}

describe('the data built from the reads', () => {
  it('a scope topic keeps that topic and the ones below it', async () => {
    setAiSeeded(true);
    serveWholeSummary();
    const parent = EVENTUS_WORLD.terms.find((term) =>
      EVENTUS_WORLD.terms.some((child) => child.parent_id === term.term_id),
    );
    if (parent === undefined) throw new Error('Eventus has no topic with topics below it');
    const below = EVENTUS_WORLD.terms.filter((term) => term.parent_id === parent.term_id).map((term) => term.term_id);
    renderProbe(() => useTopicSummary(), { world: 'eventus-security', searchParams: `topic=${parent.term_id}` });
    await waitFor(() => {
      expect(current().phase).toBe('ready');
      expect(current().tree.pending).toBe(false);
      expect(current().nodes.length).toBeGreaterThan(0);
    });
    expect(current().nodes.map((node) => node.key)).toEqual([parent.term_id]);
    expect(
      current()
        .nodes[0]?.children.map((node) => node.key)
        .sort(),
    ).toEqual([...below].sort());
    // The read holds rows of other topics, so the narrowing above is the hook's own
    const kept = new Set([parent.term_id, ...below]);
    const rows = current().summary?.topics ?? [];
    expect(rows.some((row) => row.term_id !== null && !kept.has(row.term_id))).toBe(true);
    // The topic and the topics below it, and no other
    const inside = rows.filter((row) => row.term_id !== null && kept.has(row.term_id) && row.prompt_count > 0);
    expect(inside.length).toBeGreaterThan(0);
    expect(current().aggregates?.topicCount).toBe(inside.length);
  });

  it('a scope topic below the top level stands at the top level', async () => {
    setAiSeeded(true);
    serveWholeSummary();
    const child = EVENTUS_WORLD.terms.find((term) => term.parent_id !== undefined && term.parent_id !== null);
    if (child === undefined) throw new Error('Eventus has no topic below another');
    renderProbe(() => useTopicSummary(), { world: 'eventus-security', searchParams: `topic=${child.term_id}` });
    await waitFor(() => {
      expect(current().phase).toBe('ready');
      expect(current().tree.pending).toBe(false);
      expect(current().nodes.length).toBeGreaterThan(0);
    });
    expect(current().summary?.topics.length).toBeGreaterThan(1);
    expect(current().nodes.map((node) => node.key)).toEqual([child.term_id]);
    expect(current().nodes[0]).toMatchObject({ level: 1, parentKey: null });
    expect(current().aggregates?.topicCount).toBe(1);
  });

  it('the aggregates equal the strip arithmetic (engineRates) for each engine', async () => {
    renderProbe(() => useTopicSummary());
    await ready();
    const { aggregates, summary, engines } = current();
    expect(aggregates).not.toBeNull();
    expect(summary?.prompts.length).toBeGreaterThan(0);
    expect(aggregates?.promptCount).toBe(summary?.prompts.length);
    for (const { code } of engines) {
      const strip = engineRates(summary?.prompts ?? [], code);
      const figures = aggregates?.engines.find((engine) => engine.engineCode === code);
      expect(figures?.mentioned).toEqual(strip.mentioned);
      expect(figures?.cited).toEqual(strip.cited);
      expect(figures?.shareOfVoice).toEqual(strip.shareOfVoice);
    }
  });

  it('builds topic nodes with their prompts and reports the last valid answer', async () => {
    renderProbe(() => useTopicSummary());
    await ready();
    const { nodes, prompts, lastValidAt, promptsRead, descendants } = current();
    expect(promptsRead).toBe(true);
    expect(prompts.length).toBeGreaterThan(0);
    expect(nodes.length).toBeGreaterThan(0);
    expect(descendants.size).toBeGreaterThan(0);
    expect(lastValidAt).not.toBeNull();
  });
});
