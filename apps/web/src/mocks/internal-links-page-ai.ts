import { EVENTUS_WORLD } from './ai-prompt-world';
import { crawledPage } from './internal-links-world';
import { mockId } from './mock-ids';
import { ENGINE_FACTS } from './prompt-fixtures';
import type { PageAi } from '@/lib/internal-links/types';

/**
 * Deterministic mock data for `GET .../internal-links/pages/{url_id}/ai`. Five unused fixture pages cover
 * every drawer state, using real Eventus prompt ids and texts and real fixture pages for `alongside`.
 */

/** Live page with citations across 3 platforms, 6 prompts (one branded) and 5 alongside pages. */
export const AI_CITED_PAGE = '104';
/** Live page that exists in the crawl, with counted answers in the period, none citing it. */
export const AI_QUIET_PAGE = '105';
/** Live page in a project whose tracked prompts have no counted answer in the period. */
export const AI_NO_ANSWERS_PAGE = '109';
/** Live page in a project with no tracked prompts yet. */
export const AI_NO_PROMPTS_PAGE = '110';
/** Live page that makes the mocked handler answer 500 for testing the error and retry path. */
export const AI_ERROR_PAGE = '117';

const MOCK_TODAY = '2026-11-18';
const WINDOW_DAYS = 28;
const DAY_MS = 86_400_000;
const PROFILE_FIRST_PROMPT = 25;

const isoDayOffset = (anchor: string, offsetDays: number): string =>
  new Date(Date.parse(`${anchor}T00:00:00Z`) + offsetDays * DAY_MS).toISOString().slice(0, 10);

const WINDOW: PageAi['window'] = {
  from: isoDayOffset(MOCK_TODAY, -(WINDOW_DAYS - 1)),
  to: MOCK_TODAY,
  timezone: EVENTUS_WORLD.definition.project.timezone,
};

const COMPARE_WINDOW: NonNullable<PageAi['compare_window']> = {
  from: isoDayOffset(WINDOW.from, -WINDOW_DAYS),
  to: isoDayOffset(WINDOW.from, -1),
};

// 28 daily counts: sum(answers) = 42, sum(answers_citing) = 14, with realistic zero days.
const DAILY_ANSWERS: readonly number[] = [
  2, 2, 2, 0, 2, 1, 2, 2, 1, 2, 0, 2, 1, 2, 2, 1, 2, 0, 2, 1, 2, 2, 1, 2, 0, 2, 2, 2,
];
const DAILY_CITING: readonly number[] = [
  0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1,
];

function zeroTrend(): PageAi['trend'] {
  return Array.from({ length: WINDOW_DAYS }, (_, index) => ({
    date: isoDayOffset(WINDOW.from, index),
    answers: 0,
    answers_citing: 0,
  }));
}

function citedTrend(): PageAi['trend'] {
  return Array.from({ length: WINDOW_DAYS }, (_, index) => ({
    date: isoDayOffset(WINDOW.from, index),
    answers: DAILY_ANSWERS[index] ?? 0,
    answers_citing: DAILY_CITING[index] ?? 0,
  }));
}

function zeroPlatforms(compared: boolean): PageAi['platforms'] {
  return (['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const).map((code) => ({
    engine_code: code,
    label: ENGINE_FACTS[code].label,
    answers: 0,
    answers_citing: 0,
    previous_answers_citing: compared ? 0 : null,
  }));
}

interface PromptSpec {
  index: number;
  lastCitedAt: string;
  counts: readonly [
    readonly [chatgptAnswers: number, chatgptCiting: number],
    readonly [geminiAnswers: number, geminiCiting: number],
    readonly [aiModeAnswers: number, aiModeCiting: number],
  ];
}

// 5 non-branded prompts (p01..p05) plus 1 branded prompt (p66 at index 65).
const CITED_PROMPT_SPECS: readonly PromptSpec[] = [
  {
    index: 0,
    lastCitedAt: '2026-11-18T02:00:00Z',
    counts: [
      [3, 2],
      [3, 1],
      [3, 1],
    ],
  },
  {
    index: 1,
    lastCitedAt: '2026-11-16T02:00:00Z',
    counts: [
      [3, 2],
      [3, 1],
      [1, 0],
    ],
  },
  {
    index: 65,
    lastCitedAt: '2026-11-15T02:00:00Z',
    counts: [
      [2, 1],
      [2, 1],
      [1, 0],
    ],
  },
  {
    index: 2,
    lastCitedAt: '2026-11-13T02:00:00Z',
    counts: [
      [2, 1],
      [2, 0],
      [2, 1],
    ],
  },
  {
    index: 3,
    lastCitedAt: '2026-11-10T02:00:00Z',
    counts: [
      [2, 1],
      [2, 1],
      [2, 0],
    ],
  },
  {
    index: 4,
    lastCitedAt: '2026-11-06T02:00:00Z',
    counts: [
      [2, 0],
      [2, 1],
      [1, 0],
    ],
  },
];

function citedPrompts(): PageAi['prompts'] {
  const codes = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;
  return CITED_PROMPT_SPECS.map((spec) => {
    const prompt = EVENTUS_WORLD.definition.prompts[spec.index];
    if (prompt === undefined) throw new Error(`Missing Eventus prompt at index ${String(spec.index)}`);
    const platforms = codes.map((code, pos) => {
      const pair = spec.counts[pos] ?? [0, 0];
      return {
        engine_code: code,
        label: ENGINE_FACTS[code].label,
        answers: pair[0],
        answers_citing: pair[1],
      };
    });
    return {
      prompt_id: mockId('prompt', PROFILE_FIRST_PROMPT + spec.index),
      text: prompt.text,
      answers: platforms.reduce((sum, row) => sum + row.answers, 0),
      answers_citing: platforms.reduce((sum, row) => sum + row.answers_citing, 0),
      platforms,
      last_cited_at: spec.lastCitedAt,
    };
  });
}

function ownAlongsideRow(id: string, shared: number): PageAi['alongside'][number] {
  const page = crawledPage(id);
  if (page === undefined) throw new Error(`Missing fixture page ${id}`);
  return {
    url_id: Number(page.id),
    url: `https://eventussecurity.com${page.path}`,
    path: page.path,
    title: page.title,
    host: 'eventussecurity.com',
    registrable_domain: 'eventussecurity.com',
    domain_role: 'own',
    in_crawl: true,
    answers_shared: shared,
  };
}

function buildAlongside(urlId: string): PageAi['alongside'] {
  const firstOwn = urlId === '103' ? AI_CITED_PAGE : '103';
  const secondOwn = urlId === '108' ? AI_CITED_PAGE : '108';
  return [
    ownAlongsideRow(firstOwn, 9),
    {
      url_id: 902,
      url: 'https://sentinelgate-cyber.com/managed-soc',
      path: '/managed-soc',
      title: 'Managed SOC services',
      host: 'sentinelgate-cyber.com',
      registrable_domain: 'sentinelgate-cyber.com',
      domain_role: 'competitor',
      in_crawl: false,
      answers_shared: 7,
    },
    ownAlongsideRow(secondOwn, 6),
    {
      url_id: 901,
      url: 'https://eventussecurity.com/legacy/soc-datasheet',
      path: '/legacy/soc-datasheet',
      title: 'Legacy SOC datasheet',
      host: 'eventussecurity.com',
      registrable_domain: 'eventussecurity.com',
      domain_role: 'own',
      in_crawl: false,
      answers_shared: 4,
    },
    {
      url_id: 903,
      url: 'https://secopsjournal.example/soc-buyers-guide',
      path: '/soc-buyers-guide',
      title: 'SOC buyers guide',
      host: 'secopsjournal.example',
      registrable_domain: 'secopsjournal.example',
      domain_role: 'third_party',
      in_crawl: false,
      answers_shared: 3,
    },
  ];
}

const CITED_EXTRA_PAGES = new Set([AI_CITED_PAGE, '103', '108', '112', '113']);

/** Deterministic `PageAi` response for one page of the fixture crawl. */
export function pageAiOf(urlId: string, query: { compare?: 'none' | 'previous_period' | null } = {}): PageAi {
  const compared = query.compare === 'previous_period';
  const compareWindow = compared ? COMPARE_WINDOW : null;

  if (urlId === AI_NO_PROMPTS_PAGE || urlId === AI_NO_ANSWERS_PAGE) {
    return {
      state: urlId === AI_NO_PROMPTS_PAGE ? 'no_prompts' : 'no_answers',
      window: WINDOW,
      days: WINDOW_DAYS,
      compare_window: compareWindow,
      answers: 0,
      answers_citing: 0,
      previous_answers: compared ? 0 : null,
      previous_answers_citing: compared ? 0 : null,
      platforms: zeroPlatforms(compared),
      prompts: [],
      prompts_total: 0,
      trend: zeroTrend(),
      alongside: [],
      alongside_total: 0,
    };
  }

  if (!CITED_EXTRA_PAGES.has(urlId)) {
    return {
      state: 'ready',
      window: WINDOW,
      days: WINDOW_DAYS,
      compare_window: compareWindow,
      answers: 42,
      answers_citing: 0,
      previous_answers: compared ? 40 : null,
      previous_answers_citing: compared ? 0 : null,
      platforms: [
        {
          engine_code: 'chatgpt_web',
          label: ENGINE_FACTS.chatgpt_web.label,
          answers: 18,
          answers_citing: 0,
          previous_answers_citing: compared ? 0 : null,
        },
        {
          engine_code: 'gemini_web',
          label: ENGINE_FACTS.gemini_web.label,
          answers: 14,
          answers_citing: 0,
          previous_answers_citing: compared ? 0 : null,
        },
        {
          engine_code: 'google_ai_mode',
          label: ENGINE_FACTS.google_ai_mode.label,
          answers: 10,
          answers_citing: 0,
          previous_answers_citing: compared ? 0 : null,
        },
      ],
      prompts: [],
      prompts_total: 0,
      trend: DAILY_ANSWERS.map((answers, index) => ({
        date: isoDayOffset(WINDOW.from, index),
        answers,
        answers_citing: 0,
      })),
      alongside: [],
      alongside_total: 0,
    };
  }

  const prompts = citedPrompts();
  const alongside = buildAlongside(urlId);
  return {
    state: 'ready',
    window: WINDOW,
    days: WINDOW_DAYS,
    compare_window: compareWindow,
    answers: 42,
    answers_citing: 14,
    previous_answers: compared ? 40 : null,
    previous_answers_citing: compared ? 11 : null,
    platforms: [
      {
        engine_code: 'chatgpt_web',
        label: ENGINE_FACTS.chatgpt_web.label,
        answers: 18,
        answers_citing: 7,
        previous_answers_citing: compared ? 5 : null,
      },
      {
        engine_code: 'gemini_web',
        label: ENGINE_FACTS.gemini_web.label,
        answers: 14,
        answers_citing: 5,
        previous_answers_citing: compared ? 4 : null,
      },
      {
        engine_code: 'google_ai_mode',
        label: ENGINE_FACTS.google_ai_mode.label,
        answers: 10,
        answers_citing: 2,
        previous_answers_citing: compared ? 2 : null,
      },
    ],
    prompts,
    prompts_total: prompts.length,
    trend: citedTrend(),
    alongside,
    alongside_total: alongside.length,
  };
}
