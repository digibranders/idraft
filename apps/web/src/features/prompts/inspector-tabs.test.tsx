import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { ObservationDetail, ObservationSummary, Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_ENTITY_IDS } from '@/mocks/entity-fixtures';
import { promptsOf } from '@/mocks/prompts-state';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { FIXTURE_PROMPTS } from '@/mocks/prompt-fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { readChartTokens } from '@/lib/design/read-tokens';

// jsdom has no canvas: the chart's frame and the option it is given are what these tests read
const echartOptions: Record<string, unknown>[] = [];
vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({ option }: { option: (tokens: ChartTokens) => Record<string, unknown> }) => {
    echartOptions.push(option(readChartTokens()));
    return <div data-testid="echart-canvas" />;
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const LIST = mswPath(`${P}/ai/observations`);
const DETAIL = mswPath(`${P}/ai/observations/{observation_id}`);

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const [first] = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
if (first === undefined) throw new Error('The fixture prompts are missing');

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
  server.events.removeAllListeners();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: fynix?.project_id ?? '',
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const opened = `?tab=prompts&inspect=${encodeURIComponent(`prompt:${first.prompt_id}`)}`;
const openedOn = (tab: string): string => `${opened}&itab=${tab}`;
const panel = (): Promise<HTMLElement> => screen.findByRole('complementary', { name: first.text });
const renderOn = (role: Role, searchParams: string, onUrl?: (query: string) => void): ProvidedRender =>
  renderWithProviders(promptsAs(role), {
    searchParams,
    ...(onUrl === undefined ? {} : { onUrlUpdate: ({ queryString }) => onUrl(queryString) }),
  });

const FYNIX_ID = MOCK_ENTITY_IDS.fynix;
const RIVAL_ID = MOCK_ENTITY_IDS.rankforge;
/** An answer with the brand named first, a competitor second, and the text long enough to be cut. */
const TEXT = `Fynix leads the list. ${'Many tools help with audits. '.repeat(14)}Rankforge follows far behind.`;
const summary = (id: string, engine: string, observedAt: string): ObservationSummary => ({
  answer_char_count: TEXT.length,
  citation_count: 2,
  device: null,
  engine_code: engine,
  facts: {
    competitor_cited: [],
    competitor_mentions: [RIVAL_ID],
    derivation_id: 1,
    had_structured_list: true,
    is_valid: true,
    outcome: 'mentioned_and_cited',
    own_citation_count: 1,
    own_domain_cited: true,
    own_mention_order: 1,
    own_mentioned: true,
    own_prominence: 1,
    total_citation_count: 2,
    tracked_entities_mentioned: 2,
  },
  fanout_count: 0,
  language_code: 'en',
  location_id: 2276,
  model_reported: engine === 'chatgpt_web' ? 'gpt-5' : 'gemini-3',
  observation_class: 'consumer_ui',
  observation_id: id,
  observed_at: observedAt,
  observed_date: observedAt.slice(0, 10),
  query_text: first.text,
  replicate_index: 1,
  run_id: null,
  served_from_cache: false,
  status: 'complete',
  subject: { type: 'prompt', prompt_id: first.prompt_id, prompt_version_id: first.version_id, version_no: 1 },
});
const detail = (row: ObservationSummary): ObservationDetail => ({
  ...row,
  answer_text: TEXT,
  check_url: null,
  citations: [
    {
      answer_block_index: 0,
      citation_index: 2,
      citation_kind: 'inline',
      domain_role: 'third_party',
      first_char_offset: 40,
      flags: [],
      host: 'reviews.example',
      occurrences: 1,
      raw_url: 'https://reviews.example/a',
      referral_tag: null,
      role_entity_id: null,
      source_name: null,
      title: 'A review',
      url: 'https://reviews.example/a',
    },
    {
      answer_block_index: 0,
      citation_index: 1,
      citation_kind: 'inline',
      domain_role: 'own',
      first_char_offset: 10,
      flags: [],
      host: 'fynix.example',
      occurrences: 1,
      raw_url: 'https://fynix.example/a',
      referral_tag: null,
      role_entity_id: null,
      source_name: null,
      title: 'Fynix',
      url: 'https://fynix.example/a',
    },
  ],
  error_code: null,
  mentions: [
    {
      confidence: 0.99,
      entity_id: FYNIX_ID,
      evidence_spans: [[0, 5]],
      first_char_offset: 0,
      match_method: 'alias_word',
      mention_count: 1,
      mention_order: 1,
      mention_status: 'accepted',
      name: 'Fynix',
      role: 'own',
    },
    {
      confidence: 0.9,
      entity_id: RIVAL_ID,
      evidence_spans: [[TEXT.indexOf('Rankforge'), TEXT.indexOf('Rankforge') + 9]],
      first_char_offset: TEXT.indexOf('Rankforge'),
      match_method: 'alias_word',
      mention_count: 1,
      mention_order: 2,
      mention_status: 'accepted',
      name: 'Rankforge',
      role: 'competitor',
    },
  ],
  offsets_unit: 'utf16',
});

const CHATGPT_ROW = summary('3000002', 'chatgpt_web', '2026-11-12T02:00:00Z');
const GEMINI_ROW = summary('3000001', 'gemini_web', '2026-11-09T02:00:00Z');
/** The list and the detail reads of two answers, one for each engine. */
/** The list as the API answers it: the rows the filters keep, in the order given (newest first), up to the limit. */
const listOf =
  (rows: ObservationSummary[]) =>
  ({ request }: { request: Request }): Response => {
    const params = new URL(request.url).searchParams;
    const engines = params.getAll('filter[engine_code_in]').flatMap((value) => value.split(','));
    const kept = rows
      .filter((row) => engines.length === 0 || engines.includes(row.engine_code))
      .filter((row) => params.get('filter[is_valid]') !== 'true' || row.facts?.is_valid === true)
      .slice(0, Number(params.get('limit') ?? 200));
    return HttpResponse.json({ data: kept, page: { has_more: false, next_cursor: null, limit: 200 } });
  };
const serveTwoAnswers = (): void =>
  server.use(
    http.get(LIST, listOf([CHATGPT_ROW, GEMINI_ROW])),
    http.get(DETAIL, ({ params }) =>
      HttpResponse.json({ data: detail(params.observation_id === '3000002' ? CHATGPT_ROW : GEMINI_ROW) }),
    ),
  );

describe('the tabs of the prompt inspector', () => {
  it('has Latest, History, Competitors and Stats in that order, with Latest chosen and left out of the address', async () => {
    renderOn('viewer', opened);
    const inspector = await panel();
    const list = await within(inspector).findByRole('tablist', { name: 'Prompt sections' });
    const tabs = within(list).getAllByRole('tab');
    ['Latest', 'History', 'Competitors', 'Stats'].forEach((name, place) =>
      expect(tabs[place]).toHaveAccessibleName(name),
    );
    expect(tabs).toHaveLength(4);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    // There is no Citations tab until its routes exist
    expect(within(inspector).queryByRole('tab', { name: 'Citations' })).toBeNull();
  });

  it('chooses a tab by click and by the arrow keys, and keeps the choice in the address', async () => {
    const urls: string[] = [];
    const { user } = renderOn('viewer', opened, (query) => urls.push(decodeURIComponent(query)));
    const inspector = await panel();
    await user.click(await within(inspector).findByRole('tab', { name: 'History' }));
    expect(urls.at(-1)).toContain('itab=history');
    expect(within(inspector).getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    expect(await within(inspector).findByText('Latest answers')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(urls.at(-1)).toContain('itab=competitors');
    expect(within(inspector).getByRole('tab', { name: 'Competitors' })).toHaveAttribute('aria-selected', 'true');
    // Focus follows the chosen tab, so the keys go on from it
    expect(within(inspector).getByRole('tab', { name: 'Competitors' })).toHaveFocus();
    await user.click(within(inspector).getByRole('tab', { name: 'Latest' }));
    expect(urls.at(-1)).not.toContain('itab');
  });

  it('opens on the tab the address names, and on Latest for one it does not know', async () => {
    const { unmount } = renderOn('viewer', openedOn('stats'));
    expect(await within(await panel()).findByRole('tab', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true');
    unmount();
    renderOn('viewer', openedOn('citations'));
    expect(await within(await panel()).findByRole('tab', { name: 'Latest' })).toHaveAttribute('aria-selected', 'true');
  });

  it('falls back to Latest for the tab of the topic drawer a prompt was opened from', async () => {
    // The topic drawer's Prompts tab is `itab=prompts`; the prompt has no tab of that name
    renderOn('viewer', openedOn('prompts'));
    expect(await within(await panel()).findByRole('tab', { name: 'Latest' })).toHaveAttribute('aria-selected', 'true');
  });

  it('reads only what the tab shown draws on', async () => {
    serveTwoAnswers();
    const lists: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/ai/observations')) lists.push(url.searchParams);
    });
    // Latest: one row of the newest valid answer of each engine over the widest window, and none of the window's list
    const first = renderOn('viewer', opened);
    await within(await panel()).findByText('gpt-5');
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((params) => params.get('limit') === '1' && params.get('filter[is_valid]') === 'true')).toBe(
      true,
    );
    expect(lists.map((params) => params.get('filter[engine_code_in]')).sort()).toEqual(['chatgpt_web', 'gemini_web']);
    first.unmount();
    // Stats: no list at all
    lists.length = 0;
    const stats = renderOn('viewer', openedOn('stats'));
    await within(await panel()).findByRole('heading', { name: 'ChatGPT' });
    await screen.findByText(/^The interval is the 95 percent Wilson interval/);
    expect(lists).toEqual([]);
    stats.unmount();
    // History: the window's list, once, and nothing of Latest
    renderOn('viewer', openedOn('history'));
    await within(await panel()).findByRole('table', { name: 'Answers to this prompt' });
    expect(lists).toHaveLength(1);
    expect(lists[0]?.get('limit')).toBe('200');
    expect(lists[0]?.get('filter[is_valid]')).toBeNull();
  });

  it('keeps the tab while J and K, or Next, step to another prompt', async () => {
    const { user } = renderOn('viewer', openedOn('stats'));
    const inspector = await panel();
    const title = within(inspector).getByRole('heading', { level: 2 }).textContent;
    await user.click(await within(inspector).findByRole('button', { name: 'Next prompt' }));
    await waitFor(() =>
      expect(within(screen.getByRole('complementary')).getByRole('heading', { level: 2 }).textContent).not.toBe(title),
    );
    expect(within(screen.getByRole('complementary')).getByRole('tab', { name: 'Stats' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('the Latest tab', () => {
  it('shows the newest valid answer of each engine, marked at the brands it names, with its facts and sources', async () => {
    serveTwoAnswers();
    renderOn('viewer', opened);
    const inspector = await panel();
    const chatgpt = (await within(inspector).findByRole('heading', { name: 'ChatGPT' })).closest('section');
    const gemini = within(inspector).getByRole('heading', { name: 'Gemini' }).closest('section');
    if (chatgpt === null || gemini === null) throw new Error('A card is missing');
    expect(await within(chatgpt).findByText('gpt-5')).toBeInTheDocument();
    // The first 280 characters, with the own brand marked and what the limit cuts off left to the viewer
    const marks = await within(chatgpt).findAllByText('Fynix');
    expect(marks[0]?.tagName).toBe('MARK');
    expect(within(chatgpt).queryByText('Rankforge')).toBeNull();
    expect(chatgpt.textContent).not.toContain('follows far behind');
    expect(within(chatgpt).getByText('Mentioned first among the tracked brands')).toBeInTheDocument();
    expect(within(chatgpt).getByText('Mentioned')).toBeInTheDocument();
    expect(within(chatgpt).getByText('Cited')).toBeInTheDocument();
    // No rank and no recommendation: only where the brand stands among the brands named
    expect(chatgpt.textContent).not.toMatch(/Rank|Recommended/);
    // The sources come in the order the answer cites them, each with its role
    const sources = within(chatgpt).getByRole('list', { name: 'Top sources of this answer' });
    expect(
      within(sources)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['fynix.example (Own)', 'reviews.example (Third party)']);
    // The time is relative, with the exact time as its name
    expect(within(chatgpt).getByText('10h ago').closest('time')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Nov 12, 2026'),
    );
    expect(await within(gemini).findByText('gemini-3')).toBeInTheDocument();
  });

  it('opens the whole answer in the answer viewer from the card', async () => {
    serveTwoAnswers();
    const urls: string[] = [];
    const { user } = renderOn('viewer', opened, (query) => urls.push(decodeURIComponent(query)));
    const inspector = await panel();
    await user.click(await within(inspector).findByRole('button', { name: 'Open the full answer from ChatGPT' }));
    expect(await screen.findByRole('complementary', { name: /^ChatGPT answer, / })).toBeInTheDocument();
    expect(urls.at(-1)).toContain('inspect=answer:3000002');
  });

  it('says why an engine has no valid answer when its newest answer failed, in the words of the viewer', async () => {
    const failed: ObservationSummary = { ...GEMINI_ROW, status: 'error', facts: null };
    server.use(
      http.get(LIST, listOf([CHATGPT_ROW, failed])),
      http.get(DETAIL, ({ params }) =>
        HttpResponse.json({
          data:
            params.observation_id === '3000002'
              ? detail(CHATGPT_ROW)
              : { ...detail(failed), answer_text: null, citations: [], mentions: [], error_code: '50301' },
        }),
      ),
    );
    renderOn('viewer', opened);
    const inspector = await panel();
    expect(await within(inspector).findByText('No valid answer on Gemini in the last 90 days')).toBeInTheDocument();
    expect(
      within(inspector).getByText(
        'The provider had an error while it answered. The answer is left out of every count.',
      ),
    ).toBeInTheDocument();
  });

  it('looks for the newest answer further back than the window of the page', async () => {
    // The newest valid answer of ChatGPT is 9 days old, and the window of the page is 7
    const old: ObservationSummary = {
      ...CHATGPT_ROW,
      observed_at: '2026-11-03T02:00:00Z',
      observed_date: '2026-11-03',
    };
    server.use(
      http.get(LIST, listOf([old])),
      http.get(DETAIL, () => HttpResponse.json({ data: detail(old) })),
    );
    const asked: URLSearchParams[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/ai/observations')) asked.push(url.searchParams);
    });
    renderOn('viewer', `${opened}&window=7`);
    const inspector = await panel();
    expect(await within(inspector).findByText('gpt-5')).toBeInTheDocument();
    expect(within(inspector).queryByText(/No valid answer on ChatGPT/)).toBeNull();
    expect(asked[0]?.get('from')).toBe('2026-08-15');
    expect(asked[0]?.get('to')).toBe('2026-11-12');
  });

  it('marks a partial answer, and says so when a valid answer has no text', async () => {
    const partial: ObservationSummary = { ...CHATGPT_ROW, status: 'partial' };
    server.use(
      http.get(LIST, listOf([partial, GEMINI_ROW])),
      http.get(DETAIL, ({ params }) =>
        HttpResponse.json({
          data:
            params.observation_id === '3000002'
              ? detail(partial)
              : { ...detail(GEMINI_ROW), answer_text: null, mentions: [] },
        }),
      ),
    );
    renderOn('viewer', opened);
    const inspector = await panel();
    const chatgpt = (await within(inspector).findByRole('heading', { name: 'ChatGPT' })).closest('section');
    const gemini = within(inspector).getByRole('heading', { name: 'Gemini' }).closest('section');
    if (chatgpt === null || gemini === null) throw new Error('A card is missing');
    expect(await within(chatgpt).findByText('Partial')).toBeInTheDocument();
    expect(within(chatgpt).getByText('The answer was cut off. It counts with what it holds.')).toBeInTheDocument();
    expect(await within(gemini).findByText('The answer text is not available.')).toBeInTheDocument();
    expect(within(gemini).queryByText(/has not been read yet/)).toBeNull();
    // The facts and the button to the viewer stay
    expect(within(gemini).getByRole('button', { name: 'Open the full answer from Gemini' })).toBeInTheDocument();
  });

  it('gives the relative time a tab stop, so the keyboard reaches its tooltip', async () => {
    serveTwoAnswers();
    renderOn('viewer', opened);
    const inspector = await panel();
    const time = (await within(inspector).findAllByText('10h ago'))[0];
    expect(time?.closest('time')).toHaveAttribute('tabindex', '0');
  });

  it('says one error for the newest answers when their read fails, and reads them again on Try again', async () => {
    serveTwoAnswers();
    let failing = true;
    server.use(
      http.get(LIST, (info) =>
        failing ? HttpResponse.json({ code: 'boom' }, { status: 500 }) : listOf([CHATGPT_ROW, GEMINI_ROW])(info),
      ),
    );
    const { user } = renderOn('viewer', opened);
    const inspector = await panel();
    expect(await within(inspector).findAllByText('The answers could not be loaded.')).toHaveLength(1);
    failing = false;
    await user.click(within(inspector).getByRole('button', { name: 'Try again' }));
    expect(await within(inspector).findByText('gpt-5')).toBeInTheDocument();
  });

  it('fails one card on its own, with a retry', async () => {
    serveTwoAnswers();
    let failing = true;
    server.use(
      http.get(DETAIL, ({ params }) =>
        params.observation_id === '3000001' && failing
          ? HttpResponse.json({ code: 'boom' }, { status: 500 })
          : undefined,
      ),
    );
    const { user } = renderOn('viewer', opened);
    const inspector = await panel();
    expect(await within(inspector).findByText('The Gemini answer could not be loaded.')).toBeInTheDocument();
    expect(await within(inspector).findByText('gpt-5')).toBeInTheDocument();
    failing = false;
    await user.click(within(inspector).getByRole('button', { name: 'Try again' }));
    expect(await within(inspector).findByText('gemini-3')).toBeInTheDocument();
  });
});

describe('the History tab', () => {
  it('plots the trailing four weeks of each engine with a band, and says the numbers in the Table view', async () => {
    const { user } = renderOn('viewer', openedOn('history'));
    const inspector = await panel();
    expect(await within(inspector).findByRole('img', { name: 'Mention rate by engine' })).toBeInTheDocument();
    // The frame's own table is the one text equivalent: there is no second, hidden one
    expect(within(inspector).queryByRole('table', { name: 'Mention rate by engine' })).toBeNull();
    await user.click(within(inspector).getByRole('button', { name: 'Table' }));
    const table = within(inspector).getByRole('table', { name: 'Mention rate by engine' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['4 weeks to', 'ChatGPT', 'Gemini']);
    // A point over enough valid answers says its rate, its counts and its interval
    expect(within(table).getAllByText(/^\d+%, \d+ of \d+ answers, 95% interval \d+% to \d+%$/).length).toBeGreaterThan(
      0,
    );
    expect(
      within(inspector).getByText(/Each point is the share of valid answers that name your brand/),
    ).toBeInTheDocument();
    expect(within(inspector).queryByText(/computed in the browser/i)).toBeNull();
    const events = within(inspector).getByRole('list', { name: 'Events of this prompt' });
    expect(within(events).getByText('Prompt added')).toBeInTheDocument();
    // One line for each engine, with the band of the engines that have a point over four valid answers
    const series = (echartOptions.at(-1)?.series ?? []) as { id: string }[];
    expect(series.filter((entry) => !entry.id.includes(':band')).map((entry) => entry.id)).toEqual([
      'chatgpt_web',
      'gemini_web',
    ]);
    expect(series.some((entry) => entry.id === 'chatgpt_web:band')).toBe(true);
  });

  it('lists a change of the model an engine reports', async () => {
    const older: ObservationSummary = {
      ...CHATGPT_ROW,
      observation_id: '3000000',
      observed_at: '2026-11-05T02:00:00Z',
      model_reported: 'gpt-4.1',
    };
    server.use(http.get(LIST, listOf([CHATGPT_ROW, older])));
    renderOn('viewer', openedOn('history'));
    const inspector = await panel();
    expect(await within(inspector).findByText('Answer model changed on ChatGPT: gpt-4.1 to gpt-5')).toBeInTheDocument();
  });
});

describe('the Competitors tab', () => {
  it('counts the brands named in the answers of this prompt, the own brand first, on one engine or on all', async () => {
    serveTwoAnswers();
    const { user } = renderOn('viewer', openedOn('competitors'));
    const inspector = await panel();
    const table = await within(inspector).findByRole('table', { name: 'Brands named in the answers to this prompt' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Fynix');
    expect(rows[0]).toHaveTextContent('Own');
    expect(rows[0]).toHaveTextContent('2 of 2 answers');
    expect(rows[0]).toHaveTextContent('100%');
    expect(rows[1]).toHaveTextContent('Rankforge');
    expect(rows[1]).toHaveTextContent('2 of 2 answers');
    // The switch narrows the counts to one engine
    await user.click(within(inspector).getByRole('radio', { name: 'Gemini' }));
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('1 of 1 answer');
    expect(within(inspector).getByText(/A mention is a tracked brand named in an answer/)).toBeInTheDocument();
  });

  it('says no competitor was named when the answers name none', async () => {
    const quiet = (row: ObservationSummary): ObservationSummary =>
      row.facts === null ? row : { ...row, facts: { ...row.facts, competitor_mentions: [] } };
    server.use(http.get(LIST, listOf([quiet(CHATGPT_ROW), quiet(GEMINI_ROW)])));
    renderOn('viewer', openedOn('competitors'));
    const inspector = await panel();
    expect(
      await within(inspector).findByText('No competitor was named in the answers of this window'),
    ).toBeInTheDocument();
    // The own brand stays in view, with its own count
    const table = within(inspector).getByRole('table', { name: 'Brands named in the answers to this prompt' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('Fynix')).toBeInTheDocument();
  });

  it('counts only the engines that are on in All, and falls back to All when the engine chosen is turned off', async () => {
    serveTwoAnswers();
    const gemini = promptsOf(fynix.project_id).engines.find((engine) => engine.engine_code === 'gemini_web');
    if (gemini === undefined) throw new Error('The Gemini fixture is missing');
    gemini.is_enabled = false;
    renderOn('viewer', openedOn('competitors'));
    const inspector = await panel();
    const table = await within(inspector).findByRole('table', { name: 'Brands named in the answers to this prompt' });
    // The list holds a Gemini answer too: it is no part of All
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('1 of 1 answer');
    expect(within(inspector).queryByRole('radio', { name: 'Gemini' })).toBeNull();
    expect(within(inspector).getByRole('radio', { name: 'All' })).toBeChecked();
  });
});

describe('the Stats tab', () => {
  it('says the estimate, the 95 percent interval, the sample and the method of each rate of each engine', async () => {
    renderOn('viewer', openedOn('stats'));
    const inspector = await panel();
    const chatgpt = (await within(inspector).findByRole('heading', { name: 'ChatGPT' })).closest('section');
    if (chatgpt === null) throw new Error('The ChatGPT card is missing');
    const lines = await within(chatgpt).findByRole('list', { name: 'Rates of ChatGPT with their 95% intervals' });
    const [mention, citation] = within(lines).getAllByRole('listitem');
    // 3 of 6 mentioned and 4 of 6 cited, as the strip and the Prompts table say
    expect(mention).toHaveTextContent('Mention');
    expect(mention).toHaveTextContent('50%');
    expect(
      within(mention as HTMLElement).getByRole('img', { name: /^95% interval \d+% to \d+%$/ }),
    ).toBeInTheDocument();
    expect(mention).toHaveTextContent('3 of 6 valid answers');
    expect(citation).toHaveTextContent('4 of 6 valid answers');
    expect(
      within(inspector).getByText(
        'The interval is the 95 percent Wilson interval over the valid answers of this window.',
      ),
    ).toBeInTheDocument();
    expect(within(inspector).queryByText(/server provides it/)).toBeNull();
  });

  it('shows the sample and no interval below the minimum of valid answers', async () => {
    // A week holds two runs: two valid answers on an engine, under the four a rate needs
    renderOn('viewer', `${openedOn('stats')}&window=7`);
    const inspector = await panel();
    const chatgpt = (await within(inspector).findByRole('heading', { name: 'ChatGPT' })).closest('section');
    if (chatgpt === null) throw new Error('The ChatGPT card is missing');
    expect((await within(chatgpt).findAllByText('Too few answers for a reliable rate')).length).toBe(2);
    expect(within(chatgpt).queryByRole('img', { name: /^95% interval/ })).toBeNull();
    expect(within(chatgpt).getAllByText(/^\d+ of 2 valid answers$/).length).toBe(2);
  });
});
