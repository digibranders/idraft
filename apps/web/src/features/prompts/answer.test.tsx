import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnswerInspector } from './answer-inspector';
import { PromptsScreen } from './prompts-screen';
import type { EngineCode, ObservationDetail, Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_ENTITY_IDS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { answerOf, DAY_MS, ENGINE_CODES, FIXTURE_PROMPTS, observationIdOf, runInstants } from '@/mocks/prompt-fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

// jsdom has no canvas: the History tab's chart is a frame with a table beside it here
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const DETAIL = mswPath(`${P}/ai/observations/{observation_id}`);
const COMPARE = mswPath(`${P}/ai/observations/{observation_id}/compare`);
/** `404 no_baseline`, as the API answers an answer that has no earlier one to compare with. */
const noBaseline = (request: Request): Response =>
  HttpResponse.json(
    {
      type: 'https://idraft.ai/api/problems/no_baseline',
      title: 'No earlier answer to compare',
      status: 404,
      code: 'no_baseline',
      instance: new URL(request.url).pathname,
      request_id: 'req-no-baseline',
    },
    { status: 404, headers: { 'content-type': 'application/problem+json' } },
  );
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const projectId = fynix.project_id;
const prompts = FIXTURE_PROMPTS.get(projectId) ?? [];
const [first] = prompts;
if (first === undefined) throw new Error('The fixture prompts are missing');
const ENABLED: readonly EngineCode[] = ['chatgpt_web', 'gemini_web'];

type FixtureAnswer = ReturnType<typeof answerOf>;
interface Found {
  id: string;
  promptId: string;
  engine: EngineCode;
  answer: FixtureAnswer;
}

/** The first fixture answer of the last 28 days that `test` picks, newest first. */
function answerWhere(test: (answer: FixtureAnswer) => boolean): Found {
  for (const at of runInstants(NOW.getTime()).slice(0, 8)) {
    const day = Math.floor(at / DAY_MS);
    for (const prompt of prompts) {
      for (const engine of ENABLED) {
        if (prompt.index === null) continue;
        const answer = answerOf(prompt.index, prompt.language_code, engine, day);
        if (test(answer)) {
          return {
            id: observationIdOf(day, prompt.index, ENGINE_CODES.indexOf(engine)),
            promptId: prompt.prompt_id,
            engine,
            answer,
          };
        }
      }
    }
  }
  throw new Error('No fixture answer matches');
}

const cited = answerWhere(
  (answer) =>
    answer.status === 'complete' &&
    answer.facts.own_mentioned &&
    answer.mentions.every((mention) => mention.match_method !== 'via_product') &&
    answer.citations.some((citation) => citation.domain_role === 'own') &&
    answer.citations.some((citation) => citation.domain_role === 'third_party') &&
    answer.mentions.some((mention) => mention.role === 'competitor'),
);
const failed = answerWhere((answer) => answer.status === 'error');
const refused = answerWhere((answer) => answer.status === 'refused');
const empty = answerWhere((answer) => answer.status === 'empty');
const uncertain = answerWhere(
  (answer) => answer.status === 'complete' && answer.mentions.some((mention) => mention.mention_status === 'uncertain'),
);
const watched = answerWhere(
  (answer) => answer.status === 'complete' && answer.mentions.some((mention) => mention.role === 'watch'),
);
// The brand named through its product: two mentions with the same span, of which the numbered one is marked
const product = answerWhere((answer) => answer.mentions.some((mention) => mention.match_method === 'via_product'));

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
  // The tests that stub the detail name answers the mock world has no earlier answer for; the comparison tests say otherwise
  server.use(http.get(COMPARE, ({ request }) => noBaseline(request)));
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
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
            id: projectId,
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

const opened = (id: string): string => `?tab=prompts&inspect=${encodeURIComponent(`answer:${id}`)}`;
const renderOn = (role: Role, searchParams: string, urls: string[] = []): ProvidedRender =>
  renderWithProviders(promptsAs(role), {
    searchParams,
    onUrlUpdate: ({ queryString }) => {
      urls.push(queryString);
    },
  });
const viewer = (): Promise<HTMLElement> => screen.findByRole('complementary', { name: /answer, / });

/** An answer as the API sends it, with the parts a test changes. */
const detail = (overrides: Partial<ObservationDetail>): ObservationDetail => ({
  observation_id: '2000001',
  observed_at: '2026-11-12T02:00:00Z',
  observed_date: '2026-11-12',
  engine_code: 'chatgpt_web',
  observation_class: 'consumer_ui',
  subject: { type: 'prompt', prompt_id: first.prompt_id, prompt_version_id: first.version_id, version_no: 1 },
  query_text: first.text,
  run_id: null,
  replicate_index: 1,
  location_id: 2276,
  language_code: 'en',
  device: 'desktop',
  status: 'complete',
  model_reported: 'gpt-6',
  answer_char_count: 30,
  citation_count: 0,
  fanout_count: 0,
  served_from_cache: false,
  facts: null,
  answer_text: 'Fynix and Rankforge lead.',
  error_code: null,
  check_url: null,
  offsets_unit: 'utf16',
  citations: [],
  mentions: [],
  ...overrides,
});
/** A mention of a made-up entity as the API sends it; the entity ids are the project's own where the name says so. */
const mentionOf = (
  name: string,
  spans: [number, number][],
  role: ObservationDetail['mentions'][number]['role'] = 'competitor',
): ObservationDetail['mentions'][number] => ({
  entity_id: name.startsWith('Fynix') ? MOCK_ENTITY_IDS.fynix : MOCK_ENTITY_IDS.rankforge,
  name,
  role,
  mention_count: spans.length,
  first_char_offset: spans[0]?.[0] ?? 0,
  mention_order: 1,
  match_method: 'alias_word',
  mention_status: 'accepted',
  confidence: 0.9,
  evidence_spans: spans,
});
const serve = (answer: ObservationDetail): void =>
  server.use(http.get(DETAIL, () => HttpResponse.json({ data: answer })));

describe('the answer viewer: what it shows', () => {
  it('shows the answer with the own brand and competitors marked, and the sources with their roles', async () => {
    const { container } = renderOn('viewer', opened(cited.id));
    expect(await screen.findByLabelText(/^Fynix mention, own brand/)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/mention, tracked brand/).length).toBeGreaterThan(0);
    const sources = screen.getByRole('list', { name: 'Sources cited in this answer' });
    expect(within(sources).getByText('Own')).toBeInTheDocument();
    expect(within(sources).getByText('Third party')).toBeInTheDocument();
    expect(screen.getByText('Ads in the answer are left out of the mentions and the sources.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download the raw answer' })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('passes the accessibility checks for a member who sees the raw and provider links and an uncertain mark', async () => {
    serve(
      detail({
        answer_text: 'Fynix and Rankforge lead.',
        check_url: 'https://chatgpt.com/c/abc',
        mentions: [
          { ...mentionOf('Fynix', [[0, 5]], 'own'), mention_order: 1 },
          { ...mentionOf('Rankforge', [[10, 19]], 'competitor'), mention_status: 'uncertain', mention_order: null },
        ],
      }),
    );
    const { container } = renderOn('analyst', opened('2000001'));
    await screen.findByRole('button', { name: 'Download the raw answer' });
    expect(screen.getByRole('link', { name: 'Open at the provider' })).toBeInTheDocument();
    expect((await screen.findAllByLabelText(/Uncertain match, excluded from rates/)).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('passes the accessibility checks for an answer that could not be read', async () => {
    const { container } = renderOn('viewer', opened(failed.id));
    await screen.findByText('The answer could not be read');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('lets long unbroken text wrap inside the card: the answer, a source title, a brand name', async () => {
    const long = 'x'.repeat(300);
    serve(
      detail({
        answer_text: `Fynix ${long}`,
        mentions: [mentionOf(`Fynix${long}`, [[0, 5]], 'own')],
        citations: [
          {
            citation_index: 1,
            url: `https://example.org/${long}`,
            raw_url: `https://example.org/${long}`,
            host: `${long}.example.org`,
            title: long,
            source_name: null,
            citation_kind: 'source_list',
            domain_role: 'third_party',
            role_entity_id: null,
            occurrences: 1,
            first_char_offset: null,
            answer_block_index: null,
            referral_tag: null,
            flags: [],
          },
        ],
      }),
    );
    renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    expect((await within(panel).findByLabelText(/^Fynix.* mention/)).closest('p')).toHaveClass('wrap-anywhere');
    expect(within(panel).getByRole('link', { name: long }).parentElement).toHaveClass('wrap-anywhere');
    expect(within(panel).getByText(`Fynix${long}`, { selector: 'dt' })).toHaveClass('wrap-anywhere');
  });

  it('names the answer by its engine and its date, and its engine, model and outcome', async () => {
    renderOn('viewer', opened(cited.id));
    const panel = await viewer();
    expect(panel.getAttribute('aria-labelledby')).not.toBeNull();
    const details = within(panel).getByRole('heading', { name: 'Details' }).closest('section');
    expect(details).not.toBeNull();
    expect(await within(details as HTMLElement).findByText('Mentioned and cited')).toBeInTheDocument();
    expect(within(details as HTMLElement).getByText(cited.answer.model_reported ?? '')).toBeInTheDocument();
  });

  it('lists each brand the answer names with its role and how often, and the number only where there is one', async () => {
    renderOn('viewer', opened(cited.id));
    const panel = await viewer();
    const list = within(panel).getByRole('heading', { name: 'Mentions' }).closest('section') as HTMLElement;
    for (const mention of cited.answer.mentions) {
      const term = within(list).getByText(mention.name, { selector: 'dt' });
      const row = term.parentElement as HTMLElement;
      expect(within(row).getByText(mention.role === 'own' ? 'Own' : 'Competitor')).toBeInTheDocument();
      expect(
        within(row).getByText(
          mention.mention_count === 1 ? 'Named once' : `Named ${String(mention.mention_count)} times`,
        ),
      ).toBeInTheDocument();
      if (mention.mention_order === null) expect(within(row).queryByText(/^Order /)).toBeNull();
      else expect(within(row).getByText(`Order ${String(mention.mention_order)}`)).toBeInTheDocument();
    }
  });

  it('marks an uncertain mention as uncertain in the text and in the list, never as an accepted one', async () => {
    renderOn('viewer', opened(uncertain.id));
    const panel = await viewer();
    const marks = await within(panel).findAllByLabelText(/Uncertain match, excluded from rates/);
    expect(marks.length).toBeGreaterThan(0);
    const name = uncertain.answer.mentions.find((mention) => mention.mention_status === 'uncertain')?.name ?? '';
    const row = within(panel).getByText(name, { selector: 'dt' }).parentElement as HTMLElement;
    expect(within(row).getByText('Uncertain')).toBeInTheDocument();
    expect(within(row).queryByText(/^Order /)).toBeNull();
  });

  it('marks a brand named through its product once, and says so in the list of mentions, not on the mark', async () => {
    renderOn('viewer', opened(product.id));
    const panel = await viewer();
    // Two mentions have the span, and one mark is drawn over it
    const mark = await within(panel).findByLabelText(/^Fynix mention, own brand/);
    expect(within(panel).getAllByLabelText(/^Fynix.* mention, own brand/)).toHaveLength(1);
    expect(mark.getAttribute('aria-label')).not.toMatch(/via/);
    expect(mark.textContent).toBe('Fynix Audit');
    expect((mark.closest('p') as HTMLElement).textContent).toBe(product.answer.answer_text);
    // The match method is the mention's, the best of its spans: the list says it, the mark does not claim it
    const brand = within(panel).getByText('Fynix', { selector: 'dt' }).parentElement as HTMLElement;
    expect(within(brand).getByText('Through a product')).toBeInTheDocument();
    const productRow = within(panel).getByText('Fynix Audit', { selector: 'dt' }).parentElement as HTMLElement;
    expect(within(productRow).queryByText('Through a product')).toBeNull();
  });

  it('words the mark by the role of the brand: a watched or an untracked brand is not called a tracked one', async () => {
    serve(
      detail({
        answer_text: 'Fynix, Rankforge, SEO Weekly and Zoomly.',
        mentions: [
          mentionOf('Fynix', [[0, 5]], 'own'),
          mentionOf('Rankforge', [[7, 16]], 'competitor'),
          { ...mentionOf('SEO Weekly', [[18, 28]], 'watch'), entity_id: MOCK_ENTITY_IDS.seoWeekly },
          { ...mentionOf('Zoomly', [[33, 39]], 'untracked'), entity_id: '0192f0a1-0000-7000-8000-0000000000ff' },
        ],
      }),
    );
    renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    expect(await within(panel).findByLabelText(/^Fynix mention, own brand/)).toBeInTheDocument();
    expect(within(panel).getByLabelText(/^Rankforge mention, tracked brand/)).toBeInTheDocument();
    expect(within(panel).getByLabelText(/^SEO Weekly mention, watched brand/)).toBeInTheDocument();
    expect(within(panel).getByLabelText(/^Zoomly mention, brand not tracked/)).toBeInTheDocument();
  });

  describe('the colors of the brands', () => {
    const named = detail({
      answer_text: 'Fynix and Rankforge lead.',
      mentions: [mentionOf('Fynix', [[0, 5]], 'own'), mentionOf('Rankforge', [[10, 19]], 'competitor')],
    });
    const ENTITIES = mswPath(`${P}/entities`);

    it('leaves a competitor unmarked until the colors are read, so it is not drawn grey and then recolored', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      serve(named);
      server.use(
        http.get(ENTITIES, async () => {
          await gate;
          return HttpResponse.json({ data: [] });
        }),
      );
      renderOn('viewer', opened('2000001'));
      const panel = await viewer();
      // The own brand needs no color; the text is whole and the competitor is plain text for now
      const text = (await within(panel).findByLabelText(/^Fynix mention, own brand/)).closest('p') as HTMLElement;
      expect(text.textContent).toBe('Fynix and Rankforge lead.');
      expect(within(text).queryByLabelText(/^Rankforge mention/)).toBeNull();
      release();
      expect(await within(text).findByLabelText(/^Rankforge mention, tracked brand/)).toBeInTheDocument();
    });

    it('marks the competitor with the fallback style, and the viewer stays whole, when the colors cannot be read', async () => {
      serve(named);
      server.use(
        http.get(ENTITIES, () =>
          HttpResponse.json(
            { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error' },
            { status: 500 },
          ),
        ),
      );
      renderOn('viewer', opened('2000001'));
      const panel = await viewer();
      const text = (await within(panel).findByLabelText(/^Fynix mention, own brand/)).closest('p') as HTMLElement;
      expect(await within(text).findByLabelText(/^Rankforge mention, tracked brand/)).toBeInTheDocument();
      expect(text.textContent).toBe('Fynix and Rankforge lead.');
      expect(within(panel).getByRole('heading', { name: 'Mentions' })).toBeInTheDocument();
      expect(screen.queryByText('The answer could not be loaded.')).toBeNull();
    });
  });

  it('keeps the prompt of the answer marked in the table while the answer is open, and after going back', async () => {
    // The answers are listed on the History tab, which the answer viewer gives back to
    const { user } = renderOn(
      'viewer',
      `?tab=prompts&inspect=${encodeURIComponent(`prompt:${first.prompt_id}`)}&itab=history`,
    );
    const table = await screen.findByRole('grid', { name: 'Prompts' });
    const rowOf = (): HTMLElement => within(table).getByText(first.text).closest<HTMLElement>('[role="row"]') ?? table;
    await waitFor(() => expect(rowOf()).toHaveAttribute('aria-current', 'true'));
    const inspector = await screen.findByRole('complementary', { name: first.text });
    const [date] = await within(inspector).findAllByRole('button', { name: /^Open the ChatGPT answer of / });
    await user.click(date as HTMLElement);
    const panel = await viewer();
    expect(screen.queryByRole('complementary', { name: first.text })).toBeNull();
    expect(rowOf()).toHaveAttribute('aria-current', 'true');
    await user.click(within(panel).getByRole('button', { name: 'Back to the prompt' }));
    await screen.findByRole('complementary', { name: first.text });
    expect(rowOf()).toHaveAttribute('aria-current', 'true');
  });

  it('marks the prompt of an answer opened from a link, once the answer is read', async () => {
    const target = prompts.find((candidate) => candidate.prompt_id === cited.promptId);
    renderOn('viewer', opened(cited.id));
    const table = await screen.findByRole('grid', { name: 'Prompts' });
    await viewer();
    await waitFor(() => {
      const row = within(table)
        .queryByText(target?.text ?? '')
        ?.closest<HTMLElement>('[role="row"]');
      expect(row).toHaveAttribute('aria-current', 'true');
    });
  });

  it('lists a watched brand without a number', async () => {
    renderOn('viewer', opened(watched.id));
    const panel = await viewer();
    const name = watched.answer.mentions.find((mention) => mention.role === 'watch')?.name ?? '';
    const row = (await within(panel).findByText(name, { selector: 'dt' })).parentElement as HTMLElement;
    expect(within(row).getByText('Watched')).toBeInTheDocument();
    expect(within(row).queryByText(/^Order /)).toBeNull();
  });

  it('links a source by its canonical address, not by the raw one the provider sent', async () => {
    renderOn('viewer', opened(cited.id));
    const sources = await screen.findByRole('list', { name: 'Sources cited in this answer' });
    const own = cited.answer.citations.find((citation) => citation.domain_role === 'own');
    const link = within(sources).getByRole('link', { name: own?.title ?? '' });
    expect(link).toHaveAttribute('href', own?.url);
    expect(link.getAttribute('href')).not.toContain('utm_source');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('never makes a link of an address that is not a web address', async () => {
    serve(
      detail({
        citation_count: 1,
        citations: [
          {
            citation_index: 1,
            url: 'javascript:alert(1)',
            raw_url: 'javascript:alert(2)',
            host: 'example.org',
            title: 'Read more',
            source_name: null,
            citation_kind: 'source_list',
            domain_role: 'third_party',
            role_entity_id: null,
            occurrences: 1,
            first_char_offset: null,
            answer_block_index: null,
            referral_tag: null,
            flags: [],
          },
        ],
        check_url: 'javascript:alert(3)',
      }),
    );
    renderOn('viewer', opened('2000001'));
    expect(await screen.findByText('Read more')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Read more' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open at the provider' })).toBeNull();
  });

  it('links the provider page that shows the answer when it is a web address', async () => {
    serve(detail({ check_url: 'https://chatgpt.com/c/abc' }));
    renderOn('viewer', opened('2000001'));
    expect(await screen.findByRole('link', { name: 'Open at the provider' })).toHaveAttribute(
      'href',
      'https://chatgpt.com/c/abc',
    );
  });

  it('keeps the text whole when the spans are hostile, and marks only the ones that are sound', async () => {
    serve(
      detail({
        answer_text: 'Fynix and Rankforge lead.',
        mentions: [
          mentionOf('Rankforge', [
            [10, 99],
            [12, 12],
            [-4, 3],
          ]),
          mentionOf(
            'Fynix',
            [
              [0, 5],
              [3, 8],
            ],
            'own',
          ),
        ],
      }),
    );
    renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    const text = (await within(panel).findByLabelText(/^Fynix mention/)).closest('p') as HTMLElement;
    expect(text.textContent).toBe('Fynix and Rankforge lead.');
    expect(within(text).getAllByLabelText(/mention/)).toHaveLength(1);
  });

  it('opens the answer of a prompt from the date of one of its answers, and goes back to the prompt', async () => {
    const urls: string[] = [];
    const { user } = renderOn(
      'viewer',
      `?tab=prompts&inspect=${encodeURIComponent(`prompt:${first.prompt_id}`)}&itab=history`,
      urls,
    );
    const inspector = await screen.findByRole('complementary', { name: first.text });
    const [date] = await within(inspector).findAllByRole('button', { name: /^Open the ChatGPT answer of / });
    await user.click(date as HTMLElement);
    const panel = await viewer();
    expect(decodeURIComponent(urls.at(-1) ?? '')).toMatch(/inspect=answer:\d+/);
    expect(screen.queryByRole('complementary', { name: first.text })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Back to the prompt' }));
    expect(await screen.findByRole('complementary', { name: first.text })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /answer, / })).toBeNull();
  });

  it('asks for the answer with the time it was given, so the API finds its month', async () => {
    const asked: URL[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (/\/ai\/observations\/\d+$/.test(url.pathname)) asked.push(url);
    });
    const { user } = renderOn(
      'viewer',
      `?tab=prompts&inspect=${encodeURIComponent(`prompt:${first.prompt_id}`)}&itab=history`,
    );
    const inspector = await screen.findByRole('complementary', { name: first.text });
    const [date] = await within(inspector).findAllByRole('button', { name: /^Open the ChatGPT answer of / });
    await user.click(date as HTMLElement);
    await viewer();
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]?.searchParams.get('observed_at')).toMatch(/^2026-\d\d-\d\dT02:00:00/);
    server.events.removeAllListeners();
  });
});

describe('the answer viewer: the raw answer', () => {
  const RAW = mswPath(`${P}/ai/observations/{observation_id}/raw`);
  /** The newest run the fixtures keep that is past the 90 days a raw answer is kept for. */
  const expiredId = (): string => {
    const at = runInstants(NOW.getTime()).find((instant) => NOW.getTime() - instant > 90 * DAY_MS);
    if (at === undefined || first.index === null) throw new Error('No fixture answer is past its retention');
    return observationIdOf(Math.floor(at / DAY_MS), first.index, 0);
  };
  const saved: Blob[] = [];
  const names: string[] = [];
  const revoked: string[] = [];

  beforeEach(() => {
    saved.length = 0;
    names.length = 0;
    revoked.length = 0;
    URL.createObjectURL = (blob: Blob | MediaSource): string => {
      saved.push(blob as Blob);
      return 'blob:raw-answer';
    };
    URL.revokeObjectURL = (url: string): void => {
      revoked.push(url);
    };
    // jsdom does not follow a download link: the link's name is what the browser would save the file as
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads the raw answer as a file named for the answer, for a member with raw:read', async () => {
    const { user } = renderOn('analyst', opened(cited.id));
    await user.click(await screen.findByRole('button', { name: 'Download the raw answer' }));
    await waitFor(() => expect(names).toEqual([`answer-${cited.id}.json`]));
    expect(saved).toHaveLength(1);
    expect(saved[0]?.size).toBeGreaterThan(0);
    // The address is released a second after the click, not at once
    expect(revoked).toEqual([]);
    await waitFor(() => expect(revoked).toEqual(['blob:raw-answer']), { timeout: 3000 });
  });

  it('is busy, and keeps its focus, while the raw answer is on its way, and a second click asks for nothing', async () => {
    let open: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      open = () => resolve();
    });
    let asked = 0;
    server.use(
      http.get(RAW, async () => {
        asked += 1;
        await held;
        return HttpResponse.json({ tasks: [] });
      }),
    );
    const { user } = renderOn('analyst', opened(cited.id));
    const button = await screen.findByRole('button', { name: 'Download the raw answer' });
    await user.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Not disabled: a loading button keeps its place in the tab order
    expect(button).not.toHaveAttribute('disabled');
    await user.click(button);
    open();
    await waitFor(() => expect(names).toHaveLength(1));
    expect(asked).toBe(1);
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('says the raw answer is past its retention and is no longer kept, and downloads nothing', async () => {
    const { user } = renderOn('analyst', opened(expiredId()));
    await user.click(await screen.findByRole('button', { name: 'Download the raw answer' }));
    expect(await screen.findByText('The raw answer is past its retention and is no longer kept.')).toBeInTheDocument();
    expect(names).toEqual([]);
  });

  it('says the raw answer is not available now, and a second try downloads it once the provider answers', async () => {
    server.use(http.get(RAW, ({ request }) => problem(request, 'raw_unavailable')));
    const { user } = renderOn('analyst', opened(cited.id));
    const button = await screen.findByRole('button', { name: 'Download the raw answer' });
    await user.click(button);
    // An error toast is also announced, so its words are in the document twice: the toast and the announcement
    expect((await screen.findAllByText('The raw answer is not available now. Try again later.'))[0]).toBeVisible();
    expect(names).toEqual([]);
    expect(button).toBeEnabled();
    server.resetHandlers();
    await user.click(button);
    await waitFor(() => expect(names).toEqual([`answer-${cited.id}.json`]));
  });

  it('shows no raw answer control to a viewer, who may not read it', async () => {
    renderOn('viewer', opened(cited.id));
    await viewer();
    await screen.findByLabelText(/^Fynix mention, own brand/);
    expect(screen.queryByRole('button', { name: 'Download the raw answer' })).toBeNull();
  });
});

describe('the answer viewer: answers with no text, or not read yet', () => {
  it('says an answer could not be read, in words and without the provider code, and goes back to its prompt', async () => {
    const { user } = renderOn('viewer', opened(failed.id));
    expect(await screen.findByText('The answer could not be read')).toBeInTheDocument();
    expect(screen.queryByText(/50000|provider_error/)).toBeNull();
    expect(screen.getByText(/left out of every count/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to the prompt' }));
    const prompt = prompts.find((candidate) => candidate.prompt_id === failed.promptId);
    expect(await screen.findByRole('complementary', { name: prompt?.text ?? '' })).toBeInTheDocument();
  });

  it.each([
    ['missing', 'The provider sent no result'],
    ['50000', 'The provider had an error'],
    // The dot stands for the curly apostrophe of the catalog, which this file does not spell
    ['40501', 'The provider.s reply could not be read'],
    [null, 'The provider.s reply could not be read'],
  ])('words the error code %s as a sentence and never prints it', async (code, words) => {
    serve(detail({ status: 'error', answer_text: null, error_code: code }));
    renderOn('viewer', opened('2000001'));
    expect(await screen.findByText(new RegExp(words))).toBeInTheDocument();
    if (code !== null) expect(screen.queryByText(new RegExp(`\\b${code}\\b`))).toBeNull();
  });

  it('says an empty answer is empty, and that it counts nowhere', async () => {
    renderOn('viewer', opened(empty.id));
    expect(await screen.findByText('The engine gave no answer')).toBeInTheDocument();
    expect(screen.getByText('An empty answer is left out of every count.')).toBeInTheDocument();
  });

  it('shows the text of a refused answer and says the engine declined', async () => {
    renderOn('viewer', opened(refused.id));
    expect(await screen.findByText(refused.answer.answer_text ?? '')).toBeInTheDocument();
    expect(
      screen.getByText('The engine declined to answer. The answer is left out of every count.'),
    ).toBeInTheDocument();
  });

  it('says a refusal without a text declined, not that the engine gave nothing', async () => {
    serve(detail({ status: 'refused', answer_text: null }));
    renderOn('viewer', opened('2000001'));
    expect(await screen.findByText('The engine declined to answer')).toBeInTheDocument();
  });

  it('says a cut off answer counts with what it holds', async () => {
    serve(detail({ status: 'partial' }));
    renderOn('viewer', opened('2000001'));
    expect(await screen.findByText('The answer was cut off. It counts with what it holds.')).toBeInTheDocument();
  });

  it('says the mentions follow when the answer has not been read yet, not that it names no brand', async () => {
    serve(detail({ facts: null, mentions: [] }));
    renderOn('viewer', opened('2000001'));
    expect(await screen.findByText('Mentions are not read yet')).toBeInTheDocument();
    expect(screen.queryByText('No tracked brand is named')).toBeNull();
    expect(screen.getByText('Being read')).toBeInTheDocument();
  });

  it('says no brand is named, and no source is cited, when the answer has none of either', async () => {
    serve(
      detail({
        facts: {
          derivation_id: 1,
          is_valid: true,
          outcome: 'neither',
          own_mentioned: false,
          own_domain_cited: false,
          own_mention_order: null,
          own_prominence: null,
          own_citation_count: 0,
          total_citation_count: 0,
          tracked_entities_mentioned: 0,
          competitor_mentions: [],
          competitor_cited: [],
          had_structured_list: false,
        },
      }),
    );
    renderOn('viewer', opened('2000001'));
    expect(await screen.findByText('No tracked brand is named')).toBeInTheDocument();
    expect(screen.getByText('No source cited')).toBeInTheDocument();
    expect(screen.getByText('Neither')).toBeInTheDocument();
  });
});

describe('the answer viewer: loading and failing', () => {
  it('says an answer that does not exist is not there, and shows no retry', async () => {
    renderOn('viewer', opened('99999999999'));
    expect(await screen.findByText('The answer could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('This answer does not exist or you do not have access to it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says an id that is no number is not an answer, and asks for nothing', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => asked.push(new URL(request.url).pathname));
    renderOn('viewer', opened('abc'));
    expect(await screen.findByText('This answer does not exist or you do not have access to it.')).toBeInTheDocument();
    expect(asked.filter((path) => path.includes('/ai/observations/'))).toEqual([]);
    server.events.removeAllListeners();
  });

  it('says so when the answer could not be loaded, and reads it again on Try again', async () => {
    let calls = 0;
    server.use(
      http.get(DETAIL, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error' },
              { status: 500 },
            )
          : HttpResponse.json({ data: detail({}) });
      }),
    );
    const { user } = renderOn('viewer', opened('2000001'));
    expect(await screen.findByText('The answer could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Fynix and Rankforge lead.')).toBeInTheDocument();
    expect(screen.queryByText('The answer could not be loaded.')).toBeNull();
  });

  it('closes with Escape and leaves the page where it was', async () => {
    const urls: string[] = [];
    const { user } = renderOn('viewer', opened(cited.id), urls);
    const panel = await viewer();
    within(panel).getByRole('heading', { level: 2 }).focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: /answer, / })).toBeNull());
    expect(urls.at(-1) ?? '').not.toContain('inspect=');
  });
});

/** A source as the API sends it, with the parts a test changes. */
const citationOf = (
  index: number,
  overrides: Partial<ObservationDetail['citations'][number]> = {},
): ObservationDetail['citations'][number] => ({
  citation_index: index,
  url: `https://a${String(index)}.example/m`,
  raw_url: `https://a${String(index)}.example/m?utm_source=chatgpt.com`,
  host: `a${String(index)}.example`,
  title: `Source ${String(index)}`,
  source_name: null,
  citation_kind: 'inline',
  domain_role: 'third_party',
  role_entity_id: null,
  occurrences: 1,
  first_char_offset: null,
  answer_block_index: null,
  referral_tag: null,
  flags: [],
  ...overrides,
});

describe('the answer viewer: the evidence view, markers and entity toggles', () => {
  const RAW_URL = 'https://a1.example/m?utm_source=chatgpt.com';
  const TEXT = `Fynix and Rankforge lead. See ${RAW_URL} for the method.`;
  const cited1 = (): ObservationDetail =>
    detail({
      answer_text: TEXT,
      citation_count: 2,
      mentions: [mentionOf('Fynix', [[0, 5]], 'own'), mentionOf('Rankforge', [[10, 19]], 'competitor')],
      citations: [
        citationOf(1, { first_char_offset: TEXT.indexOf(RAW_URL), raw_url: RAW_URL }),
        citationOf(2, {
          title: 'Listed only',
          host: 'b.example',
          url: 'https://b.example/',
          raw_url: 'https://b.example/',
        }),
      ],
    });
  const sources = (): HTMLElement => screen.getByRole('list', { name: 'Sources cited in this answer' });

  it('puts a marker named for its source after the cited address, and none for a source the text does not hold', async () => {
    serve(cited1());
    renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    const marker = await within(panel).findByRole('button', { name: 'Citation 1: a1.example' });
    expect(marker).toHaveTextContent('[1]');
    const text = marker.closest('p') as HTMLElement;
    // The marker follows the address, which ends the sentence's address and not the text
    expect(text.textContent).toBe(`Fynix and Rankforge lead. See ${RAW_URL}[1] for the method.`);
    expect(within(panel).queryByRole('button', { name: /^Citation 2/ })).toBeNull();
    expect(text).toHaveClass('whitespace-pre-wrap');
  });

  it('jumps from a marker to its item in the list: scrolled, marked and focused', async () => {
    serve(cited1());
    const { user } = renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    const scrolled = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrolled;
    try {
      await user.click(await within(panel).findByRole('button', { name: 'Citation 1: a1.example' }));
      const item = within(sources()).getByRole('link', { name: 'Source 1' }).closest('li') as HTMLElement;
      expect(item).toHaveAttribute('aria-current', 'true');
      expect(item).toHaveFocus();
      expect(scrolled).toHaveBeenCalled();
      expect(within(sources()).getByRole('link', { name: 'Listed only' }).closest('li')).not.toHaveAttribute(
        'aria-current',
      );
    } finally {
      Reflect.deleteProperty(window.HTMLElement.prototype, 'scrollIntoView');
    }
  });

  it('jumps back from "Show in answer" to the marker, and a source with no marker has no such button', async () => {
    serve(cited1());
    const { user } = renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    const marker = await within(panel).findByRole('button', { name: 'Citation 1: a1.example' });
    expect(within(sources()).queryByRole('button', { name: 'Show in answer, citation 2' })).toBeNull();
    await user.click(within(sources()).getByRole('button', { name: 'Show in answer, citation 1' }));
    expect(marker).toHaveFocus();
    expect(marker).toHaveAttribute('data-active');
  });

  it('lists the entities the text marks, with how many marks each has, and nothing for an entity it does not mark', async () => {
    serve(cited1());
    renderOn('viewer', opened('2000001'));
    const group = await screen.findByRole('group', { name: 'Entities' });
    expect(within(group).getByRole('checkbox', { name: 'Fynix' })).toBeChecked();
    expect(within(group).getByRole('checkbox', { name: 'Rankforge' })).toHaveAccessibleDescription('1 mark');
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2);
  });

  it('takes the marks of an entity away when it is toggled off, keeps its words, and puts them back when it is toggled on', async () => {
    serve(cited1());
    const { user } = renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    const text = (await within(panel).findByLabelText(/^Rankforge mention/)).closest('p') as HTMLElement;
    await user.click(within(panel).getByRole('checkbox', { name: 'Rankforge' }));
    expect(within(text).queryByLabelText(/^Rankforge mention/)).toBeNull();
    expect(text.textContent).toContain('Fynix and Rankforge lead.');
    // The own brand and the marker are untouched
    expect(within(text).getByLabelText(/^Fynix mention, own brand/)).toBeInTheDocument();
    expect(within(text).getByRole('button', { name: 'Citation 1: a1.example' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('checkbox', { name: 'Rankforge' }));
    expect(within(text).getByLabelText(/^Rankforge mention/)).toBeInTheDocument();
  });

  it('shows no toggle list for an answer that marks no entity, and no marker for a citation without an offset', async () => {
    serve(detail({ citations: [citationOf(1)], citation_count: 1 }));
    renderOn('viewer', opened('2000001'));
    await viewer();
    await screen.findByText('Fynix and Rankforge lead.');
    expect(screen.queryByRole('group', { name: 'Entities' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Citation 1/ })).toBeNull();
  });

  it('passes the accessibility checks with markers, toggles and an active source', async () => {
    serve(cited1());
    const { container, user } = renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    await user.click(await within(panel).findByRole('button', { name: 'Citation 1: a1.example' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the answer viewer: the Formatted view', () => {
  const MARKDOWN = [
    '# Compared',
    '',
    'Fynix leads. See [the guide](https://guide.example/seo) and [bad](javascript:alert(1)).',
    '',
    '- first',
    '- second',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '<script>window.__wp26_xss=1</script>',
  ].join('\n');
  const modeOf = (name: 'Evidence' | 'Formatted' | 'Raw'): HTMLElement => screen.getByRole('radio', { name });

  it('renders the markdown as elements without marks, and keeps hostile markup as text', async () => {
    serve(detail({ answer_text: MARKDOWN, mentions: [mentionOf('Fynix', [[10, 15]], 'own')] }));
    const { user } = renderOn('viewer', opened('2000001'));
    await screen.findByLabelText(/^Fynix mention, own brand/);
    await user.click(modeOf('Formatted'));
    expect(await screen.findByRole('heading', { level: 4, name: 'Compared' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'the guide' })).toHaveAttribute('href', 'https://guide.example/seo');
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    expect(screen.getByText(/^Fynix leads\. See/)).toHaveTextContent('and bad.');
    // No marks, no markers and no toggles in this view; a table stays text
    expect(within(await viewer()).queryByLabelText(/mention/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Entities' })).toBeNull();
    expect((await viewer()).querySelector('table, script')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(/\| a \| b \|/)).toBeInTheDocument();
    expect(Reflect.get(window, '__wp26_xss')).toBeUndefined();
  });

  it('goes back to the marks when Evidence is chosen again, and says it is the view the viewer opens in', async () => {
    serve(detail({ answer_text: MARKDOWN, mentions: [mentionOf('Fynix', [[10, 15]], 'own')] }));
    const { user } = renderOn('viewer', opened('2000001'));
    await screen.findByLabelText(/^Fynix mention, own brand/);
    expect(modeOf('Evidence')).toBeChecked();
    await user.click(modeOf('Formatted'));
    await user.click(modeOf('Evidence'));
    expect(await screen.findByLabelText(/^Fynix mention, own brand/)).toBeInTheDocument();
  });

  it('shows no view control for an answer with no text', async () => {
    renderOn('viewer', opened(failed.id));
    await screen.findByText('The answer could not be read');
    expect(screen.queryByRole('radiogroup', { name: 'Answer view' })).toBeNull();
  });
});

describe('the answer viewer: the Raw view', () => {
  const RAW = mswPath(`${P}/ai/observations/{observation_id}/raw`);
  const expiredId = (): string => {
    const at = runInstants(NOW.getTime()).find((instant) => NOW.getTime() - instant > 90 * DAY_MS);
    if (at === undefined || first.index === null) throw new Error('No fixture answer is past its retention');
    return observationIdOf(Math.floor(at / DAY_MS), first.index, 0);
  };
  const raws: string[] = [];
  beforeEach(() => {
    raws.length = 0;
    server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname.endsWith('/raw')) raws.push(request.url);
    });
  });
  afterEach(() => {
    server.events.removeAllListeners();
  });
  const openRaw = async (user: ProvidedRender['user']): Promise<void> => {
    await user.click(await screen.findByRole('radio', { name: 'Raw' }));
  };

  it('has no Raw mode for a viewer, who may not read it, and asks for nothing', async () => {
    renderOn('viewer', opened(cited.id));
    await viewer();
    await screen.findByLabelText(/^Fynix mention, own brand/);
    expect(screen.getByRole('radio', { name: 'Formatted' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Raw' })).toBeNull();
    expect(raws).toEqual([]);
  });

  it('fetches the raw answer once, when Raw is opened and not before, and shows it as escaped monospace text', async () => {
    server.use(
      http.get(RAW, () =>
        HttpResponse.text('{"tasks":[{"note":"<script>window.__wp26_xss=1</script>"}]}', {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { user } = renderOn('analyst', opened(cited.id));
    await screen.findByLabelText(/^Fynix mention, own brand/);
    expect(raws).toEqual([]);
    await openRaw(user);
    const raw = await screen.findByText(/"note":/);
    expect(raw.tagName).toBe('PRE');
    expect(raw).toHaveClass('type-mono', 'whitespace-pre-wrap');
    expect(raw.textContent).toBe('{"tasks":[{"note":"<script>window.__wp26_xss=1</script>"}]}');
    expect(document.querySelector('script')).toBeNull();
    expect(Reflect.get(window, '__wp26_xss')).toBeUndefined();
    // Away and back: the answer is kept, not asked for again
    await user.click(screen.getByRole('radio', { name: 'Formatted' }));
    await user.click(screen.getByRole('radio', { name: 'Raw' }));
    expect(await screen.findByText(/"note":/)).toBeInTheDocument();
    expect(raws).toHaveLength(1);
  });

  it('shows a skeleton while the raw answer is on its way', async () => {
    let open: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      open = () => resolve();
    });
    server.use(
      http.get(RAW, async () => {
        await held;
        return HttpResponse.json({ tasks: [] });
      }),
    );
    const { user } = renderOn('analyst', opened(cited.id));
    await openRaw(user);
    expect(await screen.findByRole('status', { name: 'Loading the raw answer' })).toBeInTheDocument();
    open();
    expect(await screen.findByText('{"tasks":[]}')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading the raw answer' })).toBeNull();
  });

  it('cuts a very long raw answer at 200,000 characters, says so, and keeps the download for the rest', async () => {
    server.use(
      http.get(RAW, () => new HttpResponse('x'.repeat(250_000), { headers: { 'content-type': 'application/json' } })),
    );
    const { user } = renderOn('analyst', opened(cited.id));
    await openRaw(user);
    const raw = await screen.findByText(/^x+$/);
    expect(raw.textContent).toHaveLength(200_000);
    expect(
      screen.getByText('Showing the first 200,000 characters. Download the raw answer for the rest.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download the raw answer' })).toBeInTheDocument();
  });

  it('says the raw answer is past its retention, and shows no retry', async () => {
    const { user } = renderOn('analyst', opened(expiredId()));
    await openRaw(user);
    expect(await screen.findByText('The raw answer is past its retention and is no longer kept.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says the raw answer is not available now, and reads it again on Try again', async () => {
    let calls = 0;
    server.use(
      http.get(RAW, ({ request }) => {
        calls += 1;
        return calls === 1 ? problem(request, 'raw_unavailable') : HttpResponse.json({ tasks: ['ok'] });
      }),
    );
    const { user } = renderOn('analyst', opened(cited.id));
    await openRaw(user);
    expect(await screen.findByText('The raw answer is not available now. Try again later.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('{"tasks":["ok"]}')).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('says any other failure in the words of the download, with a retry', async () => {
    server.use(
      http.get(RAW, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error' },
          { status: 500 },
        ),
      ),
    );
    const { user } = renderOn('analyst', opened(cited.id));
    await openRaw(user);
    expect(
      await screen.findByText('The raw answer could not be downloaded. Try again in a moment.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('passes the accessibility checks in the Raw view', async () => {
    const { container, user } = renderOn('analyst', opened(cited.id));
    await openRaw(user);
    await screen.findByText(/"tasks"/);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the answer viewer: going back to the marks, a new answer, and the provider link', () => {
  const RAW_URL = 'https://a1.example/m?utm_source=chatgpt.com';
  const TEXT = `Fynix and Rankforge lead. See ${RAW_URL} for the method.`;
  const withMarker = (id = '2000001'): ObservationDetail =>
    detail({
      observation_id: id,
      answer_text: TEXT,
      citation_count: 1,
      mentions: [mentionOf('Fynix', [[0, 5]], 'own'), mentionOf('Rankforge', [[10, 19]], 'competitor')],
      citations: [citationOf(1, { first_char_offset: TEXT.indexOf(RAW_URL), raw_url: RAW_URL })],
    });
  const sources = (): HTMLElement => screen.getByRole('list', { name: 'Sources cited in this answer' });
  const showInAnswer = (): HTMLElement => within(sources()).getByRole('button', { name: 'Show in answer, citation 1' });

  it('goes back to the marked text from Formatted on "Show in answer", and focuses the marker', async () => {
    serve(withMarker());
    const { user } = renderOn('viewer', opened('2000001'));
    await screen.findByRole('button', { name: 'Citation 1: a1.example' });
    await user.click(screen.getByRole('radio', { name: 'Formatted' }));
    expect(screen.queryByRole('button', { name: 'Citation 1: a1.example' })).toBeNull();
    await user.click(showInAnswer());
    expect(screen.getByRole('radio', { name: 'Evidence' })).toBeChecked();
    const marker = await screen.findByRole('button', { name: 'Citation 1: a1.example' });
    await waitFor(() => expect(marker).toHaveFocus());
    expect(marker).toHaveAttribute('data-active');
  });

  it('goes back to the marked text from Raw on "Show in answer", and focuses the marker', async () => {
    serve(withMarker());
    // The made-up answer has no payload in the mocks
    server.use(http.get(mswPath(`${P}/ai/observations/{observation_id}/raw`), () => HttpResponse.json({ tasks: [] })));
    const { user } = renderOn('analyst', opened('2000001'));
    await screen.findByRole('button', { name: 'Citation 1: a1.example' });
    await user.click(screen.getByRole('radio', { name: 'Raw' }));
    await screen.findByText(/"tasks"/);
    expect(screen.queryByRole('button', { name: 'Citation 1: a1.example' })).toBeNull();
    await user.click(showInAnswer());
    expect(screen.getByRole('radio', { name: 'Evidence' })).toBeChecked();
    const marker = await screen.findByRole('button', { name: 'Citation 1: a1.example' });
    await waitFor(() => expect(marker).toHaveFocus());
  });

  it('starts the view, the toggles and the focused citation again when another answer is opened', async () => {
    server.use(
      http.get(DETAIL, ({ params }) => HttpResponse.json({ data: withMarker(String(params.observation_id)) })),
    );
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    const element = (observationId: string): ReactElement => (
      <PermissionProvider membership={membershipFactory('viewer')}>
        <AnswerInspector
          scope={{ workspaceId: MOCK_WORKSPACE.workspace_id, projectId }}
          observationId={observationId}
          timeZone="Europe/Berlin"
          engines={[]}
          onBack={vi.fn()}
          onClose={vi.fn()}
        />
      </PermissionProvider>
    );
    const { user, rerender } = renderWithProviders(element('2000001'));
    const panel = await viewer();
    await user.click(await within(panel).findByRole('checkbox', { name: 'Rankforge' }));
    await user.click(within(panel).getByRole('button', { name: 'Citation 1: a1.example' }));
    expect(within(sources()).getByRole('link', { name: 'Source 1' }).closest('li')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await user.click(within(panel).getByRole('radio', { name: 'Formatted' }));
    rerender(element('2000002'));
    await screen.findByLabelText(/^Rankforge mention/);
    expect(screen.getByRole('radio', { name: 'Evidence' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Rankforge' })).toBeChecked();
    expect(within(sources()).getByRole('link', { name: 'Source 1' }).closest('li')).not.toHaveAttribute('aria-current');
  });

  it('cuts the Formatted view at 200,000 characters with the note of the Raw view', async () => {
    serve(detail({ answer_text: 'x'.repeat(250_000), mentions: [] }));
    const { user } = renderOn('viewer', opened('2000001'));
    await user.click(await screen.findByRole('radio', { name: 'Formatted' }));
    const text = await screen.findByText(/^x+$/);
    expect(text.textContent).toHaveLength(200_000);
    expect(
      screen.getByText('Showing the first 200,000 characters. Download the raw answer for the rest.'),
    ).toBeInTheDocument();
  });

  it('opens the provider link in a new tab that cannot reach back, and links only a web address without credentials', async () => {
    serve(detail({ check_url: 'https://chatgpt.com/c/abc' }));
    const view = renderOn('viewer', opened('2000001'));
    const link = await screen.findByRole('link', { name: 'Open at the provider' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    view.unmount();
    for (const address of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://example.com/',
      'https://user:pw@evil.example/',
    ]) {
      serve(detail({ check_url: address }));
      const again = renderOn('viewer', opened('2000001'));
      await viewer();
      await screen.findByText('Fynix and Rankforge lead.');
      expect(screen.queryByRole('link', { name: 'Open at the provider' }), address).toBeNull();
      again.unmount();
    }
  });
});

const COMPARISON = {
  prompt_id: first.prompt_id,
  engine_code: 'chatgpt_web',
  latest: {
    observation_id: '2000001',
    observed_at: '2026-11-12T02:00:00Z',
    own_mentioned: true,
    own_domain_cited: true,
  },
  baseline: {
    observation_id: '1999990',
    observed_at: '2026-11-05T02:00:00Z',
    own_mentioned: true,
    own_domain_cited: false,
  },
  entities: {
    gained: [{ entity_id: MOCK_ENTITY_IDS.rankforge, name: 'Rankforge', role: 'competitor' }],
    lost: [],
    kept: [{ entity_id: MOCK_ENTITY_IDS.fynix, name: 'Fynix', role: 'own' }],
  },
  sources: {
    gained: [{ registrable_domain: 'a1.example', host: 'a1.example', domain_role: 'third_party', title: 'Source 1' }],
    lost: [],
    kept_count: 2,
  },
};
const compareHeading = (): Promise<HTMLElement> =>
  screen.findByRole('heading', { name: 'Change since the last answer that named the brand' });

describe('the answer viewer: the provider link', () => {
  it('test_the_provider_link_is_http_or_https_only: a javascript address renders no link', async () => {
    serve(detail({ check_url: 'javascript:alert(1)' }));
    renderOn('viewer', opened('2000001'));
    await screen.findByText('Fynix and Rankforge lead.');
    expect(screen.queryByRole('link', { name: 'Open at the provider' })).toBeNull();
    expect(screen.queryByText('Open at the provider')).toBeNull();
  });

  it('test_the_provider_link_has_noopener_noreferrer_and_opens_a_new_tab, with the external link glyph', async () => {
    serve(detail({ check_url: 'https://chatgpt.com/c/abc' }));
    renderOn('viewer', opened('2000001'));
    const link = await screen.findByRole('link', { name: 'Open at the provider' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.querySelector('svg')).not.toBeNull();
  });
});

describe('the answer viewer: the facts and the hashes', () => {
  const ANSWER_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const factsOf = (): NonNullable<ObservationDetail['facts']> => ({
    competitor_cited: [],
    competitor_mentions: [],
    derivation_id: 41,
    had_structured_list: false,
    is_valid: true,
    outcome: 'mentioned_only',
    own_citation_count: 0,
    own_domain_cited: false,
    own_mention_order: 1,
    own_mentioned: true,
    own_prominence: 0.5,
    total_citation_count: 3,
    tracked_entities_mentioned: 1,
  });

  it('shows the extracted facts and the first 12 characters of each hash in the Details section', async () => {
    serve(detail({ facts: factsOf(), answer_sha256: ANSWER_HASH, raw_sha256: null }));
    renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    const details = within(panel).getByRole('heading', { name: 'Details' }).closest('section') as HTMLElement;
    expect(await within(details).findByText('Answer SHA-256')).toBeInTheDocument();
    expect(within(details).getByText('a1b2c3d4e5f6')).toBeInTheDocument();
    expect(within(details).queryByText('Raw SHA-256')).toBeNull();
    expect(within(details).getByText('Derivation').nextElementSibling).toHaveTextContent('41');
  });

  it('shows n/a for facts the API has not given yet, never 0', async () => {
    serve(detail({ facts: null }));
    renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    const term = await within(panel).findByText('Derivation');
    expect(term.nextElementSibling).toHaveTextContent(/^n\/a$/);
  });
});

describe('the answer viewer: the comparison with the last answer that named the brand', () => {
  it('test_the_compare_section_reads_the_route_and_opens_the_baseline', async () => {
    const asked: string[] = [];
    server.use(
      http.get(COMPARE, ({ request }) => {
        asked.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: COMPARISON });
      }),
    );
    serve(detail({}));
    const urls: string[] = [];
    const { user } = renderOn('viewer', opened('2000001'), urls);
    const panel = await viewer();
    await compareHeading();
    expect(await within(panel).findByText('1 brand gained')).toBeInTheDocument();
    expect(within(panel).getByText('2 sources in both answers')).toBeInTheDocument();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/\/ai\/observations\/2000001\/compare$/);
    await user.click(within(panel).getByRole('button', { name: /^Open the answer of Nov 5/ }));
    expect(decodeURIComponent(urls.at(-1) ?? '')).toContain('inspect=answer:1999990');
  });

  it('says there is no earlier answer, as a reason, when the API has no baseline, and does not read it again', async () => {
    let reads = 0;
    server.use(
      http.get(COMPARE, ({ request }) => {
        reads += 1;
        return noBaseline(request);
      }),
    );
    serve(detail({}));
    renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    expect(await within(panel).findByText('No earlier answer to compare')).toBeInTheDocument();
    expect(within(panel).queryByText('The comparison could not be loaded')).toBeNull();
    expect(reads).toBe(1);
  });

  it('says the comparison failed, with Try again that reads it once more', async () => {
    let reads = 0;
    server.use(
      http.get(COMPARE, ({ request }) => {
        reads += 1;
        return reads === 1 ? problem(request, 'internal_error') : HttpResponse.json({ data: COMPARISON });
      }),
    );
    serve(detail({}));
    const { user } = renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    expect(await within(panel).findByText('The comparison could not be loaded')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByText('1 brand gained')).toBeInTheDocument();
    expect(reads).toBe(2);
  });

  it('passes the accessibility checks with the comparison shown', async () => {
    server.use(http.get(COMPARE, () => HttpResponse.json({ data: COMPARISON })));
    serve(detail({}));
    const { container } = renderOn('viewer', opened('2000001'));
    await screen.findByText('1 brand gained');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the answer viewer: quoted passages', () => {
  it('test_quoted_passages_show_only_where_the_payload_has_one', async () => {
    serve(
      detail({
        citation_count: 2,
        citations: [
          citationOf(1, { quote: 'The method counts every answer.' }),
          citationOf(2, { title: 'No passage', host: 'b.example', url: 'https://b.example/' }),
        ],
      }),
    );
    const view = renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    const section = (await within(panel).findByRole('heading', { name: 'Quoted passages' })).closest(
      'section',
    ) as HTMLElement;
    expect(within(section).getAllByRole('listitem')).toHaveLength(1);
    expect(within(section).getByText('“The method counts every answer.”')).toBeInTheDocument();
    // The passage is shown once: the sources list does not repeat it
    const sources = within(panel).getByRole('list', { name: 'Sources cited in this answer' });
    expect(sources).not.toHaveTextContent('The method counts every answer.');
    expect(panel.querySelectorAll('blockquote')).toHaveLength(1);
    view.unmount();
    serve(detail({ citations: [citationOf(1)] }));
    renderOn('viewer', opened('2000001'));
    await screen.findByRole('list', { name: 'Sources cited in this answer' });
    expect(screen.queryByRole('heading', { name: 'Quoted passages' })).toBeNull();
  });

  it('shows a hostile passage once, as text', async () => {
    const hostile = '<img src=x onerror="window.__wp26_xss=1">[x](javascript:alert(1))&lt;b&gt;';
    serve(detail({ citations: [citationOf(1, { quote: hostile })] }));
    renderOn('viewer', opened('2000001'));
    const panel = await viewer();
    await within(panel).findByRole('heading', { name: 'Quoted passages' });
    expect(panel.querySelectorAll('img, script')).toHaveLength(0);
    expect(within(panel).getByText(`“${hostile}”`)).toBeInTheDocument();
    expect(panel.querySelectorAll('blockquote')).toHaveLength(1);
    expect(Reflect.get(window, '__wp26_xss')).toBeUndefined();
  });
});
