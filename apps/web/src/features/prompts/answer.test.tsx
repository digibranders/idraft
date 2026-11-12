import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const DETAIL = mswPath(`${P}/ai/observations/{observation_id}`);
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
    expect(screen.getByRole('link', { name: 'Open the answer at the provider' })).toBeInTheDocument();
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
    const { user } = renderOn('viewer', `?tab=prompts&inspect=${encodeURIComponent(`prompt:${first.prompt_id}`)}`);
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
    expect(screen.queryByRole('link', { name: 'Open the answer at the provider' })).toBeNull();
  });

  it('links the provider page that shows the answer when it is a web address', async () => {
    serve(detail({ check_url: 'https://chatgpt.com/c/abc' }));
    renderOn('viewer', opened('2000001'));
    expect(await screen.findByRole('link', { name: 'Open the answer at the provider' })).toHaveAttribute(
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
      `?tab=prompts&inspect=${encodeURIComponent(`prompt:${first.prompt_id}`)}`,
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
    const { user } = renderOn('viewer', `?tab=prompts&inspect=${encodeURIComponent(`prompt:${first.prompt_id}`)}`);
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
    await waitFor(() => expect(revoked).toEqual(['blob:raw-answer']));
  });

  it('is disabled and busy while the raw answer is on its way', async () => {
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
    const button = await screen.findByRole('button', { name: 'Download the raw answer' });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    open();
    await waitFor(() => expect(names).toHaveLength(1));
    expect(button).toBeEnabled();
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
