import { describe, expect, it } from 'vitest';

import {
  countriesForEngines,
  countText,
  fitsEngine,
  collectTopicTerms,
  hasAnswers,
  matchesTopics,
  parseTab,
  parseWindow,
  PROMPT_TEXT_MAX,
  promptKeyOf,
  readPromptLines,
  topicTermsOf,
  WINDOW_DAYS,
  windowRange,
} from './prompt-model';
import type { MetricCell, ProjectEngine, Prompt, PromptsSummary } from '@/lib/api/types';
import type { Country } from '@/lib/locations/countries';

/** Characters built from code points: the editing tools turn typed escapes into literal characters. */
const TAB = String.fromCharCode(9);
const BELL = String.fromCharCode(7);
const NBSP = String.fromCharCode(0xa0);
const E_ACUTE = String.fromCharCode(0xe9);
const COMBINING_ACUTE = String.fromCharCode(0x301);
const ZWJ = String.fromCharCode(0x200d);
const GRINNING = String.fromCodePoint(0x1f600);
const CAFE = `Caf${E_ACUTE} near me?`;

const country = (location_id: number, country_iso: string, name: string): Country => ({
  location_id,
  country_iso,
  name,
  location_type: 'Country',
  parent_id: null,
  supports: ['serp'],
});
const GERMANY = country(2276, 'DE', 'Germany');
const INDIA = country(2356, 'IN', 'India');
const US = country(2840, 'US', 'United States');

const engine = (code: ProjectEngine['engine']['engine_code'], max: number, locations: number[]): ProjectEngine => ({
  engine: {
    engine_code: code,
    label: code,
    observation_class: 'consumer_ui',
    vendor: 'openai',
    exposes_citations: true,
    exposes_fanout: false,
    max_prompt_chars: max,
  },
  is_configured: true,
  is_enabled: true,
  location_ids: locations,
  replicates: 1,
  provider_code: 'dataforseo',
  active_prompts: 0,
  estimated_monthly_cost_usd: '0.000000',
});

describe('the window', () => {
  it('reads 7, 28 and 90 days from the URL and falls back to 28', () => {
    expect([parseWindow('7'), parseWindow('90'), parseWindow('28'), parseWindow('5'), parseWindow(null)]).toEqual([
      7, 90, 28, 28, 28,
    ]);
  });

  it('is the last days in the time zone of the project, today included', () => {
    // 23:30 UTC on 1 November is already 2 November in Kolkata
    const late = new Date('2026-11-01T23:30:00Z');
    expect(windowRange(28, late, 'Asia/Kolkata')).toEqual({ from: '2026-10-06', to: '2026-11-02' });
    expect(windowRange(7, late, 'America/New_York')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });

  it('never asks for more days than the API takes, the 90 days across a clock change included', () => {
    const MAX_DAYS = 92;
    const DAY = 86_400_000;
    for (const days of WINDOW_DAYS) {
      const { from, to } = windowRange(days, new Date('2026-11-12T12:00:00Z'), 'America/New_York');
      expect((Date.parse(to) - Date.parse(from)) / DAY + 1).toBe(days);
      expect(days).toBeLessThanOrEqual(MAX_DAYS);
    }
  });
});

describe('the tabs', () => {
  it('opens on Topics unless the URL says Prompts', () => {
    expect([parseTab('prompts'), parseTab('topics'), parseTab('panels'), parseTab(null)]).toEqual([
      'prompts',
      'topics',
      'topics',
      'topics',
    ]);
  });
});

describe('the topics of a prompt', () => {
  it('are its terms of a topic vocabulary, and no other', () => {
    const term = (term_id: string, vocabulary_kind: string): Prompt['terms'][number] => ({
      term_id,
      name: term_id,
      path: term_id,
      vocabulary_kind,
    });
    const prompt = { terms: [term('t1', 'topic'), term('t2', 'persona'), term('t3', 'topic')] } as Prompt;
    expect(topicTermsOf(prompt).map((item) => item.term_id)).toEqual(['t1', 't3']);
  });
});

describe('the topic filter', () => {
  const term = (term_id: string, path: string, vocabulary_kind = 'topic'): Prompt['terms'][number] => ({
    term_id,
    name: path.split('/').at(-1) ?? path,
    path,
    vocabulary_kind,
  });
  const SEO = term('seo', 'seo');
  const TECHNICAL = term('technical', 'seo/technical-seo');
  const CRAWL = term('crawl', 'seo/technical-seo/crawling');
  // Shares a prefix with `seo` as text, but is not below it
  const AUDIT = term('audit', 'seo-audit');
  const PAID = term('paid', 'paid-search');
  const carrying = (...terms: Prompt['terms']): Prompt => ({ terms }) as Prompt;

  it('matches a prompt that carries the chosen term, or any term below it by path', () => {
    expect(matchesTopics(carrying(SEO), [SEO])).toBe(true);
    expect(matchesTopics(carrying(TECHNICAL), [SEO])).toBe(true);
    expect(matchesTopics(carrying(CRAWL), [SEO])).toBe(true);
    expect(matchesTopics(carrying(CRAWL), [TECHNICAL])).toBe(true);
  });

  it('does not match a parent, a sibling, or a term whose path only starts with the same letters', () => {
    expect(matchesTopics(carrying(SEO), [TECHNICAL])).toBe(false);
    expect(matchesTopics(carrying(AUDIT), [SEO])).toBe(false);
    expect(matchesTopics(carrying(PAID), [SEO])).toBe(false);
    expect(matchesTopics(carrying(), [SEO])).toBe(false);
  });

  it('matches any of several chosen topics, and every prompt when none is chosen', () => {
    expect(matchesTopics(carrying(PAID), [SEO, PAID])).toBe(true);
    expect(matchesTopics(carrying(CRAWL), [PAID, SEO])).toBe(true);
    expect(matchesTopics(carrying(AUDIT), [PAID, SEO])).toBe(false);
    expect(matchesTopics(carrying(), [])).toBe(true);
  });

  it('looks at topic terms only: another vocabulary with the same path is no topic', () => {
    expect(matchesTopics(carrying(term('persona', 'seo/technical-seo', 'persona')), [SEO])).toBe(false);
  });

  it('collects each topic term the prompts carry once, by id', () => {
    const terms = collectTopicTerms([carrying(SEO, TECHNICAL), carrying(TECHNICAL, term('p', 'x', 'persona'))]);
    expect([...terms.keys()]).toEqual(['seo', 'technical']);
  });
});

const cell = (parts: Partial<MetricCell> = {}): MetricCell => ({
  value: null,
  numerator: 0,
  denominator: 0,
  n_observations: 0,
  ...parts,
});

describe('a count cell', () => {
  it('reads 4 of 8 on a prompt, where numerator and denominator count the valid answers', () => {
    expect(countText(cell({ value: 0.5, numerator: 4, denominator: 8, n_observations: 9, pooled: null }))).toBe(
      '4 of 8',
    );
    expect(countText(cell({ value: 0, numerator: 0, denominator: 3, n_observations: 3 }))).toBe('0 of 3');
  });

  it('reads the answers behind a topic cell, never its sum of rates over its prompts', () => {
    // Two prompts: one rated 1 of 2 answers, one rated 2 of 3; the numerator sums the rates, 1/2 + 2/3
    const topic = cell({
      value: 0.5833,
      numerator: 1.1666,
      denominator: 2,
      n_observations: 6,
      pooled: { successes: 3, trials: 5 },
    });
    expect(countText(topic)).toBe('3 of 5');
  });

  it('is nothing for a fractional numerator without pooled answers: that is no count, and is not rounded into one', () => {
    expect(countText(cell({ value: 0.58, numerator: 3.5, denominator: 6, n_observations: 7 }))).toBeNull();
  });

  it('is nothing where no valid answer counts, whatever else the cell holds', () => {
    expect(countText(cell({ n_observations: 2 }))).toBeNull();
    expect(countText(cell({ n_observations: 2, pooled: { successes: 0, trials: 0 } }))).toBeNull();
    expect(countText(undefined)).toBeNull();
  });
});

describe('whether a window has answers', () => {
  const summary = (n: number): PromptsSummary => {
    const engineRow = {
      engine_code: 'chatgpt_web',
      mentioned: cell({ n_observations: n }),
      cited: cell({ n_observations: n }),
      outcomes: {
        mentioned_and_cited: cell({ n_observations: n }),
        mentioned_only: cell({ n_observations: n }),
        cited_only: cell({ n_observations: n }),
        neither: cell({ n_observations: n }),
      },
      share_of_voice: cell({ n_observations: n }),
    };
    return {
      window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
      include_branded: false,
      engine_codes: ['chatgpt_web'],
      entities: [],
      entity_config_versions: [],
      metric_context: {} as PromptsSummary['metric_context'],
      topics: [],
      prompts: [
        { prompt_id: 'p1', text: 'Which agency?', is_branded: false, topic_term_ids: [], engines: [engineRow] },
      ],
    };
  };

  it('is false until a prompt has an answer on an engine, valid or not', () => {
    expect(hasAnswers(summary(0))).toBe(false);
    expect(hasAnswers(summary(1))).toBe(true);
    expect(hasAnswers({ ...summary(1), prompts: [] })).toBe(false);
  });
});

describe('a pasted list', () => {
  it('is one prompt per line, trimmed and composed, with blank lines left out and repeats named', () => {
    const text = `  Which agency?  \n\nWhich agency?\n${CAFE}\r\n${CAFE}\n`;
    expect(readPromptLines(text)).toEqual({
      lines: [
        { text: 'Which agency?', line: 1 },
        { text: CAFE, line: 4 },
      ],
      repeats: [
        { line: 3, first: 1 },
        { line: 5, first: 4 },
      ],
    });
  });

  it('composes a line to NFC, so the same word typed with a combining accent repeats', () => {
    const decomposed = `Cafe${COMBINING_ACUTE} near me?`;
    expect(readPromptLines(`${CAFE}\n${decomposed}`)).toEqual({
      lines: [{ text: CAFE, line: 1 }],
      repeats: [{ line: 2, first: 1 }],
    });
  });

  it('puts one space where a line has a tab or any other run of white space', () => {
    const text = `best${TAB}CRM  for${TAB}${TAB}small${NBSP}teams\n${TAB}tab at the start${TAB}`;
    expect(readPromptLines(text).lines).toEqual([
      { text: 'best CRM for small teams', line: 1 },
      { text: 'tab at the start', line: 2 },
    ]);
  });

  it('drops other control characters without leaving a gap, and leaves a joiner for the API to refuse', () => {
    const lines = readPromptLines(`best${BELL} CRM\nfamily${ZWJ}tools\n${BELL}\n`).lines;
    expect(lines).toEqual([
      { text: 'best CRM', line: 1 },
      { text: `family${ZWJ}tools`, line: 2 },
    ]);
  });

  it('drops invisible format characters pasted from the web, and keeps an emoji joined by a joiner whole', () => {
    const invisible = [0x200b, 0xad, 0x200e, 0x200f, 0xfeff, 0x2060].map((point) => String.fromCodePoint(point));
    const pasted = `best${invisible.join('')} CRM${invisible[4]}`;
    const family = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map((point) => String.fromCodePoint(point)).join('');
    const ZWNJ = String.fromCodePoint(0x200c);
    expect(readPromptLines(`${pasted}\nfamily ${family}\nnon${ZWNJ}joiner`).lines).toEqual([
      { text: 'best CRM', line: 1 },
      { text: `family ${family}`, line: 2 },
      { text: `non${ZWNJ}joiner`, line: 3 },
    ]);
  });

  it('starts a new line at a lone carriage return, a line separator and a paragraph separator', () => {
    const CR = String.fromCodePoint(13);
    const LS = String.fromCodePoint(0x2028);
    const PS = String.fromCodePoint(0x2029);
    expect(readPromptLines(`one${CR}two${LS}three${PS}four\r\nfive\nsix`).lines).toEqual([
      { text: 'one', line: 1 },
      { text: 'two', line: 2 },
      { text: 'three', line: 3 },
      { text: 'four', line: 4 },
      { text: 'five', line: 5 },
      { text: 'six', line: 6 },
    ]);
  });

  it('takes a line of the longest length the API accepts, counted in characters', () => {
    const [line] = readPromptLines(GRINNING.repeat(PROMPT_TEXT_MAX)).lines;
    expect([...(line?.text ?? '')]).toHaveLength(PROMPT_TEXT_MAX);
    expect(PROMPT_TEXT_MAX).toBe(2000);
  });

  it('keys a prompt as the API finds duplicates: text, language and country', () => {
    expect(promptKeyOf(' Which agency? ', 'en', 'DE')).toBe(promptKeyOf('Which agency?', 'en', 'DE'));
    expect(promptKeyOf(CAFE, 'en', 'DE')).toBe(promptKeyOf(`Cafe${COMBINING_ACUTE} near me?`, 'en', 'DE'));
    expect(promptKeyOf('Which agency?', 'en', 'DE')).not.toBe(promptKeyOf('Which agency?', 'de', 'DE'));
    expect(promptKeyOf('Which agency?', 'en', 'DE')).not.toBe(promptKeyOf('Which agency?', 'en', 'IN'));
  });
});

describe('engines', () => {
  it('counts the length of a prompt in characters, as the API does, against the limit of each engine', () => {
    const aiMode = engine('google_ai_mode', 700, [2276]);
    expect(fitsEngine(GRINNING.repeat(700), aiMode)).toBe(true);
    expect(fitsEngine('x'.repeat(701), aiMode)).toBe(false);
  });

  it('offers the countries every enabled engine runs in, or every country when none is on', () => {
    const all = [GERMANY, INDIA, US];
    expect(countriesForEngines([], all)).toEqual(all);
    expect(
      countriesForEngines([engine('chatgpt_web', 2000, [2276, 2356]), engine('gemini_web', 2000, [2356, 2840])], all),
    ).toEqual([INDIA]);
  });
});
