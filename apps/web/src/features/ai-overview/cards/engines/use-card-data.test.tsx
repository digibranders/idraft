import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCardData, type CardData, type CardDataOptions } from './use-card-data';
import { OverviewProvider } from '../../overview-context';
import { makeQueryClient } from '@/lib/api/query-client';
import { PermissionProvider } from '@/lib/permissions';
import { engineRates } from '@/lib/rates/strip-model';
import { setAiSeeded } from '@/mocks/ai-seed';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject, type OverviewWorld } from '@/test/ai-overview-harness';
import { server } from '@/test/msw';

/** The window of the strip's own tests: Oct 16 to Nov 12 and the 28 days before it. */
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const PROJECT_PATH = '*/api/v1/workspaces/:w/projects/:p';
const SUMMARY = `${PROJECT_PATH}/ai/prompts-summary`;
const PREVIOUS_TO = '2026-10-15';

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

const listeners: ((info: { request: Request }) => void)[] = [];
/** The summary requests the server sees from now until the test ends. */
function recordSummaryRequests(): URL[] {
  const seen: URL[] = [];
  const listener = ({ request }: { request: Request }): void => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ai/prompts-summary')) seen.push(url);
  };
  listeners.push(listener);
  server.events.on('request:start', listener);
  return seen;
}

function hookOf(
  options: CardDataOptions,
  search: string = WINDOW,
  world: OverviewWorld = 'fynix',
): ReturnType<typeof renderHook<CardData, unknown>> {
  const client = makeQueryClient({ retry: false });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={search} hasMemory>
        <PermissionProvider membership={membershipFactory('admin')}>
          <OverviewProvider
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={overviewProject(world)}
          >
            {children}
          </OverviewProvider>
        </PermissionProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>
  );
  return renderHook(() => useCardData(options), { wrapper });
}

const ready = async (result: { current: CardData }): Promise<void> => {
  await waitFor(() => {
    expect(result.current.phase).toBe('ready');
  });
};

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.useRealTimers();
  setAiSeeded(false);
});

describe('useCardData', () => {
  it('asked lists the enabled engines inside the scope choice in catalog order', async () => {
    const all = hookOf({ previous: 'none' });
    await waitFor(() => {
      expect(all.result.current.engines.status).toBe('ready');
    });
    expect(all.result.current.asked).toEqual(['chatgpt_web', 'gemini_web']);

    const chosen = hookOf({ previous: 'none' }, `${WINDOW}&engine=gemini_web,chatgpt_web`);
    await waitFor(() => {
      expect(chosen.result.current.engines.status).toBe('ready');
    });
    expect(chosen.result.current.asked).toEqual(['chatgpt_web', 'gemini_web']);

    // AI Mode is off in Fynix, so a choice of it asks nothing
    const off = hookOf({ previous: 'none' }, `${WINDOW}&engine=google_ai_mode`);
    await waitFor(() => {
      expect(off.result.current.engines.status).toBe('ready');
    });
    expect(off.result.current.asked).toEqual([]);
  });

  it('current and previous are two summary requests and a card that needs no previous makes one', async () => {
    const seen = recordSummaryRequests();
    const optional = hookOf({ previous: 'optional' });
    await ready(optional.result);
    await waitFor(() => {
      expect(optional.result.current.comparing).toBe(true);
    });
    expect(seen.map((url) => `${url.searchParams.get('from')} ${url.searchParams.get('to')}`).sort()).toEqual([
      '2026-09-18 2026-10-15',
      '2026-10-16 2026-11-12',
    ]);

    seen.length = 0;
    const none = hookOf({ previous: 'none' });
    await ready(none.result);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.searchParams.get('to')).toBe('2026-11-12');
    expect(none.result.current.previous).toBeNull();
    expect(none.result.current.comparing).toBe(false);
  });

  it('asks the series of the window when the card says so', async () => {
    const seen = recordSummaryRequests();
    const { result } = hookOf({ previous: 'none', include: ['series'] });
    await ready(result);
    expect(seen[0]?.searchParams.getAll('include')).toEqual(['series']);
  });

  it('the previous read is dropped while the two reads are not paired', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        if (new URL(request.url).searchParams.get('to') === PREVIOUS_TO) await gate;
        return undefined;
      }),
    );
    const { result } = hookOf({ previous: 'optional' });
    await waitFor(() => {
      expect(result.current.current.status).toBe('ready');
    });
    // The current window answered, the previous one has not: no change between two windows is built
    expect(result.current.previous).toBeNull();
    expect(result.current.comparing).toBe(false);
    expect(result.current.aggregates?.previousAnswers).toBeNull();
    expect(result.current.phase).toBe('refetching');

    release();
    await waitFor(() => {
      expect(result.current.comparing).toBe(true);
    });
    expect(result.current.previous?.status).toBe('ready');
    expect(result.current.aggregates?.previousAnswers).not.toBeNull();
    expect(result.current.phase).toBe('ready');
  });

  it('aggregates equal the strip figures for the same scope (R12 parity against engineRates on the same prompts)', async () => {
    const { result } = hookOf({ previous: 'none' });
    await ready(result);
    const prompts = result.current.current.data?.prompts ?? [];
    expect(prompts.length).toBeGreaterThan(0);
    for (const engine of result.current.aggregates?.engines ?? []) {
      if (!engine.asked) continue;
      const strip = engineRates(prompts, engine.engineCode);
      expect(engine.mentioned).toEqual(strip.mentioned);
      expect(engine.cited).toEqual(strip.cited);
      expect(engine.shareOfVoice).toEqual(strip.shareOfVoice);
    }
    expect(result.current.aggregates?.promptCount).toBe(prompts.length);
  });

  it('a card that asked for the sources gets them, and one that did not has none and asks nothing', async () => {
    const withSources = hookOf({ previous: 'none', sources: true });
    await waitFor(() => {
      expect(withSources.result.current.sources?.status).toBe('ready');
    });
    expect(withSources.result.current.aggregates?.engines[0]?.citationShare).not.toBeNull();

    const without = hookOf({ previous: 'none' });
    await ready(without.result);
    expect(without.result.current.sources).toBeNull();
    expect(without.result.current.aggregates?.engines[0]?.citationShare).toBeNull();
  });

  it('a failed summary gives phase error with the error id and retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-summary')));
    const { result } = hookOf({ previous: 'optional' });
    await waitFor(() => {
      expect(result.current.phase).toBe('error');
    });
    expect(result.current.errorId).toBe('req-summary');
    expect(result.current.aggregates).toBeNull();

    server.resetHandlers();
    act(() => {
      result.current.retry();
    });
    await ready(result);
    expect(result.current.errorId).toBeNull();
    expect(result.current.aggregates).not.toBeNull();
  });

  it('a failed refetch keeps the data and sets stale', async () => {
    const { result } = hookOf({ previous: 'none' });
    await ready(result);
    const before = result.current.aggregates;
    expect(result.current.stale).toBe(false);

    server.use(http.get(SUMMARY, () => failing('req-again')));
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.stale).toBe(true);
    });
    expect(result.current.phase).toBe('ready');
    expect(result.current.aggregates).toEqual(before);
    expect(result.current.errorId).toBe('req-again');
  });

  it('a failed previous read is partial on a card that can do without it and an error on one that cannot', async () => {
    const failPrevious = http.get(SUMMARY, ({ request }) =>
      new URL(request.url).searchParams.get('to') === PREVIOUS_TO ? failing('req-previous') : undefined,
    );
    server.use(failPrevious);
    const optional = hookOf({ previous: 'optional' });
    await waitFor(() => {
      expect(optional.result.current.partialPrevious).toBe(true);
    });
    expect(optional.result.current.phase).toBe('ready');
    expect(optional.result.current.comparing).toBe(false);
    expect(optional.result.current.aggregates?.previousAnswers).toBeNull();

    const required = hookOf({ previous: 'required' });
    await waitFor(() => {
      expect(required.result.current.phase).toBe('error');
    });
    expect(required.result.current.errorId).toBe('req-previous');
  });

  it('a card with no engine on is empty and reads nothing', async () => {
    const seen = recordSummaryRequests();
    const { result } = hookOf({ previous: 'optional' }, WINDOW, 'cleanstart');
    await waitFor(() => {
      expect(result.current.engines.status).toBe('ready');
    });
    expect(result.current.phase).toBe('empty');
    expect(result.current.asked).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it('is an error, not an empty card, when the engines of the project cannot be read, and retry reads them again', async () => {
    server.use(http.get(`${PROJECT_PATH}/engines`, () => failing('req-engines')));
    const { result } = hookOf({ previous: 'none' });
    await waitFor(() => {
      expect(result.current.phase).toBe('error');
    });
    expect(result.current.errorId).toBe('req-engines');

    server.resetHandlers();
    act(() => {
      result.current.retry();
    });
    await ready(result);
  });

  it('is loading while the engines of the project are not known, not empty', () => {
    const { result } = hookOf({ previous: 'none' });
    expect(result.current.engines.status).toBe('loading');
    expect(result.current.phase).toBe('loading');
  });
});

describe('world facts the later tasks rely on (read from the mock itself)', () => {
  it('Fynix has 2 engines on and the third off', async () => {
    const { result } = hookOf({ previous: 'none' });
    await ready(result);
    expect(result.current.engines.data).toHaveLength(3);
    expect(result.current.engines.enabled).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('Fynix asks 22 prompts in Germany with branded prompts left out (23 with them) and 1 in India', async () => {
    const de = hookOf({ previous: 'none' }, `${WINDOW}&country=DE`);
    await ready(de.result);
    const deBranded = hookOf({ previous: 'none' }, `${WINDOW}&country=DE&branded=included`);
    await ready(deBranded.result);
    const india = hookOf({ previous: 'none' }, `${WINDOW}&country=IN`);
    await ready(india.result);
    expect({
      DE: de.result.current.aggregates?.promptCount,
      DEBranded: deBranded.result.current.aggregates?.promptCount,
      IN: india.result.current.aggregates?.promptCount,
    }).toEqual({ DE: 22, DEBranded: 23, IN: 1 });
  });

  it('Fynix has 7 valid answers on ChatGPT and 8 on Gemini for the Indian prompt', async () => {
    const { result } = hookOf({ previous: 'none' }, `${WINDOW}&country=IN`);
    await ready(result);
    const valid = Object.fromEntries(
      (result.current.aggregates?.engines ?? [])
        .filter((engine) => engine.asked)
        .map((engine) => [engine.engineCode, engine.validAnswers]),
    );
    expect(valid).toEqual({ chatgpt_web: 7, gemini_web: 8 });
  });

  it('Eventus Security, seeded, has answers in every week of 92 days', async () => {
    setAiSeeded(true);
    const { result } = hookOf(
      { previous: 'none', include: ['series'] },
      'from=2026-08-13&to=2026-11-12',
      'eventus-security',
    );
    await ready(result);
    const series = result.current.current.data?.prompts[0]?.engines[0]?.series ?? [];
    expect(series).toHaveLength(14);
    expect(series[0]?.week_start).toBe('2026-08-10');
    expect(series.every((point) => point.mentioned.n_observations > 0)).toBe(true);
  });
});
