import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { Suspense, useEffect, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OverviewProvider, useOverview, useOverviewEngines, useOverviewSummary } from '../overview-context';
import { useNumberValues, type NumberValues } from './use-number-values';
import { PromptsStrip } from '@/features/prompts/prompts-strip';
import { CustomizableScreen, defineCards, useLayoutCapabilities } from '@/features/layouts';
import type { NumberItem } from '@/lib/layouts/types';
import { PermissionProvider } from '@/lib/permissions';
import { setAiSeeded } from '@/mocks/ai-seed';
import { membershipFactory } from '@/mocks/factories/identity';
import { handlers } from '@/mocks/handlers';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { overviewProject, type OverviewWorld } from '@/test/ai-overview-harness';
import { serveLayouts, stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

// The customize controller of the screen reads the router and the address
vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/:w/projects/:p';
const SUMMARY = mswPath(`${P}/ai/prompts-summary`);
const SOURCES = mswPath(`${P}/ai/sources/domains`);
const FANOUT = mswPath(`${P}/ai/fanout-queries`);

const MENTION: NumberItem[] = [
  { id: 'prompts', metric: 'ai.prompts_in_scope' },
  { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
  { id: 'mention-gemini', metric: 'ai.mention_rate', engine: 'gemini_web' },
  { id: 'mention-ai-mode', metric: 'ai.mention_rate', engine: 'google_ai_mode' },
];

beforeEach(() => {
  vi.setSystemTime(NOW);
  // The customize controller of the screen reads the media queries
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAiSeeded(false);
});

/** The answer the mock world gives, for a handler that held it back first. */
const passThrough = (request: Request): Promise<Response | undefined> =>
  getResponse([...handlers], new Request(request.url, { headers: request.headers }));

interface Seen {
  values: NumberValues[];
}

/** What a page would draw of each number, as text a test can read, and the controls that change the scope. */
function Probe({ items, seen }: { items: readonly NumberItem[]; seen: Seen }): ReactElement {
  const numbers = useNumberValues();
  const { setScope } = useOverview();
  useEffect(() => {
    seen.values.push(numbers);
  });
  return (
    <div>
      <p data-testid="status">{numbers.status}</p>
      <p data-testid="error">{numbers.error === null ? 'none' : (numbers.error.errorId ?? 'no id')}</p>
      <button
        type="button"
        onClick={() => {
          numbers.error?.retry();
        }}
      >
        retry
      </button>
      <button
        type="button"
        onClick={() => {
          setScope({ engines: ['gemini_web'] });
        }}
      >
        gemini only
      </button>
      {items.map((item) => {
        const value = numbers.valueOf(item);
        return (
          <div key={item.id} data-testid={item.id}>
            <span data-slot="value">{value.value}</span>
            <span data-slot="context">{value.context ?? ''}</span>
            <span data-slot="delta">{value.delta}</span>
            <span data-slot="tip">{value.tip ?? ''}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The page mounts its strip once the engines are known: until then every read is idle, which is not "loading". */
function OnceEnginesAreRead({ children }: { children: ReactNode }): ReactNode {
  return useOverviewEngines().status === 'ready' ? children : null;
}

function Screen({ children, projectId }: { children: ReactNode; projectId: string }): ReactElement {
  const { capabilities } = useLayoutCapabilities({ workspaceId: MOCK_WORKSPACE.workspace_id, projectId });
  return (
    <CustomizableScreen
      screen="ai_overview"
      workspaceId={MOCK_WORKSPACE.workspace_id}
      workspaceName={MOCK_WORKSPACE.name}
      capabilities={capabilities}
      registry={defineCards({})}
    >
      {children}
    </CustomizableScreen>
  );
}

/** The provider, the screen and the layout of `items` around `children`, as the page has them. */
function tree(items: readonly NumberItem[], children: ReactNode, world: OverviewWorld = 'fynix'): ReactElement {
  serveLayouts({ layout: { source: 'personal', document: { schema: 1, numbers: items, cards: [] } } });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  const project = overviewProject(world);
  return (
    <PermissionProvider membership={membershipFactory('admin')}>
      <Suspense fallback={null}>
        <OverviewProvider
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={project}
        >
          <Screen projectId={project.id}>
            <OnceEnginesAreRead>{children}</OnceEnginesAreRead>
          </Screen>
        </OverviewProvider>
      </Suspense>
    </PermissionProvider>
  );
}

const cell = (id: string): HTMLElement => screen.getByTestId(id);
const slot = (id: string, name: string): string => cell(id).querySelector(`[data-slot="${name}"]`)?.textContent ?? '';
const status = (): string => screen.getByTestId('status').textContent ?? '';
const requests = (): URL[] => {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    seen.push(new URL(request.url));
  });
  return seen;
};

describe('useNumberValues', () => {
  it('gives a valueOf that is a plain lookup: the same function and the same words while nothing it reads changes', async () => {
    const seen: Seen = { values: [] };
    renderWithProviders(tree(MENTION, <Probe items={MENTION} seen={seen} />));
    await waitFor(() => {
      expect(status()).toBe('ready');
    });
    await waitFor(() => {
      expect(slot('mention-chatgpt', 'value')).toMatch(/%$/);
    });
    const first = seen.values.at(-1);
    const words = ['prompts', 'mention-chatgpt', 'mention-gemini', 'mention-ai-mode'].map((id) => slot(id, 'context'));
    // A later render of the page changes nothing the numbers read
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen.values.at(-1)?.valueOf).toBe(first?.valueOf);
    const again = ['prompts', 'mention-chatgpt', 'mention-gemini', 'mention-ai-mode'].map((id) => slot(id, 'context'));
    expect(again).toEqual(words);
    // Calling it twice for the same number is the same answer
    const item = MENTION[1];
    if (item === undefined || first === undefined) throw new Error('the fixture is missing');
    expect(first.valueOf(item).value).toBe(first.valueOf(item).value);
    expect(first.valueOf(item).context).toBe(first.valueOf(item).context);
  });

  it('is loading until the summary has answered, then ready', async () => {
    const held = gate();
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        await held.promise;
        return passThrough(request);
      }),
    );
    renderWithProviders(tree(MENTION, <Probe items={MENTION} seen={{ values: [] }} />));
    await waitFor(() => {
      expect(screen.getByTestId('status')).toBeInTheDocument();
    });
    expect(status()).toBe('loading');
    held.open();
    await waitFor(() => {
      expect(status()).toBe('ready');
    });
  });

  it('is refetching on a scope change, keeps the numbers, and does not call a loading engine empty', async () => {
    const seen: Seen = { values: [] };
    const { user } = renderWithProviders(tree(MENTION, <Probe items={MENTION} seen={seen} />));
    await waitFor(() => {
      expect(status()).toBe('ready');
    });
    const before = slot('mention-gemini', 'value');
    expect(before).toMatch(/%$|answers?$/);
    const held = gate();
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        await held.promise;
        return passThrough(request);
      }),
    );
    await user.click(screen.getByRole('button', { name: 'gemini only' }));
    await waitFor(() => {
      expect(status()).toBe('refetching');
    });
    // The engine that is no longer chosen says so at once; the one that is keeps its last figure while it is read
    expect(slot('mention-chatgpt', 'value')).toBe('Not asked');
    expect(slot('mention-gemini', 'value')).not.toBe('No valid answers');
    held.open();
    await waitFor(() => {
      expect(status()).toBe('ready');
    });
  });

  it('gives the strip error with Retry when the summary fails, and n/a for every number', async () => {
    let failing = true;
    server.use(
      http.get(SUMMARY, ({ request }) =>
        failing
          ? HttpResponse.json(
              {
                type: 'about:blank',
                title: 'Internal error',
                status: 500,
                code: 'internal_error',
                request_id: 'req-9',
              },
              { status: 500, headers: { 'content-type': 'application/problem+json' } },
            )
          : passThrough(request),
      ),
    );
    const { user } = renderWithProviders(tree(MENTION, <Probe items={MENTION} seen={{ values: [] }} />));
    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('req-9');
    });
    expect(slot('mention-chatgpt', 'value')).toBe('n/a');
    expect(slot('prompts', 'value')).toBe('n/a');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('none');
    });
    await waitFor(() => {
      expect(slot('mention-chatgpt', 'value')).toMatch(/%$|answers?$|No valid answers/);
    });
  });

  it('waits for the sources of the citation share without holding back the other numbers', async () => {
    const items: NumberItem[] = [
      { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
      { id: 'citation-share-chatgpt', metric: 'ai.citation_share', engine: 'chatgpt_web' },
    ];
    const held = gate();
    server.use(
      http.get(SOURCES, async ({ request }) => {
        await held.promise;
        return passThrough(request);
      }),
    );
    renderWithProviders(tree(items, <Probe items={items} seen={{ values: [] }} />));
    await waitFor(() => {
      expect(slot('mention-chatgpt', 'value')).toMatch(/%$|answers?$/);
    });
    await waitFor(() => {
      expect(slot('citation-share-chatgpt', 'value')).toBe('Reading');
    });
    expect(status()).toBe('ready');
    held.open();
    await waitFor(() => {
      expect(slot('citation-share-chatgpt', 'value')).not.toBe('Reading');
    });
    expect(slot('citation-share-chatgpt', 'context')).toMatch(/citation units$/);
  });

  it('asks the sources and the fan-out only when the layout has a number that needs them', async () => {
    const seen = requests();
    renderWithProviders(tree(MENTION, <Probe items={MENTION} seen={{ values: [] }} />));
    await waitFor(() => {
      expect(slot('mention-chatgpt', 'value')).toMatch(/%$|answers?$/);
    });
    expect(seen.some((url) => url.pathname.endsWith('/ai/sources/domains'))).toBe(false);
    expect(seen.some((url) => url.pathname.endsWith('/ai/fanout-queries'))).toBe(false);
    server.events.removeAllListeners();
  });

  it('reads the fan-out presence of ChatGPT and says Not exposed for Gemini', async () => {
    const items: NumberItem[] = [
      { id: 'fanout-chatgpt', metric: 'ai.fanout_presence_rate', engine: 'chatgpt_web' },
      { id: 'fanout-gemini', metric: 'ai.fanout_presence_rate', engine: 'gemini_web' },
    ];
    server.use(http.get(FANOUT, ({ request }) => passThrough(request)));
    renderWithProviders(tree(items, <Probe items={items} seen={{ values: [] }} />));
    await waitFor(() => {
      expect(slot('fanout-gemini', 'value')).toBe('Not exposed');
    });
    await waitFor(() => {
      expect(slot('fanout-chatgpt', 'context')).toMatch(/of \d[\d,]* answers$/);
    });
  });
});

/** The Topics and Prompts strip over the prompts this page read, next to the numbers this page shows (R12). */
function Parity({ seen }: { seen: Seen }): ReactElement {
  const engines = useOverviewEngines();
  const summary = useOverviewSummary();
  const enabled = (engines.data ?? []).filter((engine) => engine.is_enabled);
  return (
    <div>
      <Probe items={MENTION} seen={seen} />
      {summary.data === undefined ? null : (
        <PromptsStrip
          prompts={summary.data.prompts}
          engines={enabled}
          topics={null}
          status="ready"
          countsFailed={false}
        />
      )}
    </div>
  );
}

describe('the numbers and the Topics and Prompts strip (R12)', () => {
  it.each<{ world: OverviewWorld; seeded: boolean }>([
    { world: 'fynix', seeded: false },
    { world: 'eventus-security', seeded: true },
  ])('show the same mention rate and counts for each engine of $world', async ({ world, seeded }) => {
    setAiSeeded(seeded);
    const { user } = renderWithProviders(tree(MENTION, <Parity seen={{ values: [] }} />, world));
    const chips = await screen.findByRole('group', { name: 'Summary of the prompts in view' });
    await waitFor(() => {
      expect(chips).not.toHaveAttribute('aria-busy');
    });
    await waitFor(() => {
      expect(status()).toBe('ready');
    });
    const byLabel = new Map(
      within(chips)
        .getAllByRole('term')
        .map((term) => [term.textContent, term.parentElement?.querySelector('dd') ?? null] as const),
    );
    const engineIds: readonly [string, string][] = [
      ['mention-chatgpt', 'ChatGPT'],
      ['mention-gemini', 'Gemini'],
      ['mention-ai-mode', 'AI Mode'],
    ];
    let compared = 0;
    for (const [id, label] of engineIds) {
      const chip = byLabel.get(label);
      if (chip === undefined || chip === null) continue;
      const mine = slot(id, 'value');
      const theirs = chip.textContent ?? '';
      if (theirs === 'n/a') {
        // The Prompts strip has no word for an engine with no valid answer: this page says it
        expect(mine).toBe('No valid answers');
        continue;
      }
      expect(mine).toBe(theirs);
      compared += 1;
      if (/%$/.test(theirs)) {
        // "612 of 1,800 answers" is the Prompts strip's own "Mentioned: 612 of 1,800 answers"
        await user.hover(chip);
        expect(
          await screen.findByText(`Mentioned: ${slot(id, 'context')}.`, {
            exact: false,
            selector: '[data-slot="tooltip"] span',
          }),
        ).toBeInTheDocument();
        expect(slot(id, 'tip')).toContain(slot(id, 'context').replace(' answers', ' valid answers'));
        await user.unhover(chip);
      }
    }
    expect(compared).toBeGreaterThan(0);
    // The prompts in scope are the Prompts chip's count
    expect(slot('prompts', 'value')).toBe(byLabel.get('Prompts')?.textContent);
  });
});
