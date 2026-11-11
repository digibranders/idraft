import { describe, expect, it } from 'vitest';

import {
  countriesForEngines,
  fitsEngine,
  parseTab,
  parseWindow,
  promptKeyOf,
  readPromptLines,
  topicTermsOf,
  windowRange,
} from './prompt-model';
import type { ProjectEngine, Prompt } from '@/lib/api/types';
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
