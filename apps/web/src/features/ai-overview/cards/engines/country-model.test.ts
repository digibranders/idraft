import { describe, expect, it } from 'vitest';

import {
  countryModel,
  isCountryMetric,
  MAX_COUNTRY_GROUPS,
  type CountryGroup,
  type CountryRead,
} from './country-model';
import { engineCells, promptRow } from './engines-fixtures';
import type { EngineCode, PromptSummaryRow } from '@/lib/api/types';

const ASKED: readonly EngineCode[] = ['chatgpt_web', 'gemini_web'];

/** A prompt with its mention counts on ChatGPT and Gemini, `[k, n]` each; a count left out is an engine with no cell. */
const prompt = (
  id: string,
  chatgpt: readonly [k: number, n: number] | null,
  gemini: readonly [k: number, n: number] | null,
  extra: { cited?: readonly [k: number, n: number]; shareOfVoice?: readonly [k: number, n: number] } = {},
): PromptSummaryRow =>
  promptRow(id, [
    ...(chatgpt === null
      ? []
      : [
          engineCells('chatgpt_web', {
            mentioned: [chatgpt[0], chatgpt[1], chatgpt[1]],
            ...(extra.cited === undefined ? {} : { cited: [extra.cited[0], extra.cited[1], extra.cited[1]] }),
            ...(extra.shareOfVoice === undefined
              ? {}
              : { shareOfVoice: [extra.shareOfVoice[0], extra.shareOfVoice[1], extra.shareOfVoice[1]] }),
          }),
        ]),
    ...(gemini === null ? [] : [engineCells('gemini_web', { mentioned: [gemini[0], gemini[1], gemini[1]] })]),
  ]);

const ready = (country: string, prompts: readonly PromptSummaryRow[]): CountryRead => ({
  country,
  prompts,
  failed: false,
});

const readyGroups = (groups: readonly CountryGroup[]): Extract<CountryGroup, { kind: 'ready' }>[] =>
  groups.flatMap((group) => (group.kind === 'ready' ? [group] : []));

const filler = (count: number): PromptSummaryRow[] =>
  Array.from({ length: count }, (_, index) => prompt(`p${String(index)}`, [1, 5], [1, 5]));

describe('countryModel', () => {
  it('shows the countries of the prompts by prompt count, at most 8, and counts the rest', () => {
    const reads = Array.from({ length: 10 }, (_, index) => ready(`C${String(index)}`, filler(index + 1)));
    const model = countryModel({
      countries: reads.map((read) => read.country),
      reads,
      asked: ASKED,
      metric: 'mention',
    });
    expect(model.kind).toBe('groups');
    if (model.kind !== 'groups') return;
    expect(MAX_COUNTRY_GROUPS).toBe(8);
    expect(model.groups.map((group) => group.country)).toEqual(['C9', 'C8', 'C7', 'C6', 'C5', 'C4', 'C3', 'C2']);
    expect(model.hidden).toBe(2);
    expect(model.countries).toBe(10);
  });

  it('breaks a tie of prompt counts by the country code so the order does not move', () => {
    const reads = [ready('IN', filler(2)), ready('DE', filler(2)), ready('FR', filler(3))];
    const model = countryModel({ countries: ['IN', 'DE', 'FR'], reads, asked: ASKED, metric: 'mention' });
    expect(model.kind === 'groups' && model.groups.map((group) => group.country)).toEqual(['FR', 'DE', 'IN']);
  });

  it('makes a group of one row for each asked engine, in order, with the counts behind the rate', () => {
    const reads = [ready('DE', [prompt('p1', [3, 8], [2, 5]), prompt('p2', [1, 4], [0, 6])]), ready('IN', filler(1))];
    const model = countryModel({ countries: ['DE', 'IN'], reads, asked: ASKED, metric: 'mention' });
    if (model.kind !== 'groups') throw new Error('Two countries must make groups');
    const [germany] = readyGroups(model.groups);
    expect(germany?.prompts).toBe(2);
    expect(germany?.rows.map((row) => row.engineCode)).toEqual(['chatgpt_web', 'gemini_web']);
    expect(germany?.rows[0]).toMatchObject({ state: 'ok', answers: 12, successes: 4, prompts: 2 });
    // The mean of the prompts' own rates, each prompt once: (3/8 + 1/4) / 2
    expect(germany?.rows[0]?.value).toBeCloseTo((3 / 8 + 1 / 4) / 2, 12);
  });

  it('never turns a thin or an unknown row into 0', () => {
    const reads = [
      ready('DE', [prompt('p1', [1, 3], null)]),
      ready('IN', [promptRow('p2', [engineCells('chatgpt_web', { mentioned: [0, 0, 5] })])]),
    ];
    const model = countryModel({ countries: ['DE', 'IN'], reads, asked: ASKED, metric: 'mention' });
    if (model.kind !== 'groups') throw new Error('Two countries must make groups');
    const rows = readyGroups(model.groups).flatMap((group) => group.rows);
    const germanyChatgpt = readyGroups(model.groups).find((group) => group.country === 'DE')?.rows[0];
    const indiaChatgpt = readyGroups(model.groups).find((group) => group.country === 'IN')?.rows[0];
    // 3 valid answers: its answers, no rate
    expect(germanyChatgpt).toMatchObject({ state: 'insufficient', value: null, answers: 3 });
    // 5 answers and none valid
    expect(indiaChatgpt).toMatchObject({ state: 'none', value: null, reason: 'noneValid' });
    // No cell at all for Gemini
    expect(rows.filter((row) => row.state === 'none' && row.reason === 'noAnswers').length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.state !== 'ok').every((row) => row.value === null)).toBe(true);
  });

  it('is the too few countries state for fewer than 2 countries', () => {
    expect(
      countryModel({ countries: ['DE'], reads: [ready('DE', filler(3))], asked: ASKED, metric: 'mention' }),
    ).toEqual({
      kind: 'tooFewCountries',
      countries: 1,
    });
    expect(countryModel({ countries: [], reads: [], asked: ASKED, metric: 'mention' }).kind).toBe('tooFewCountries');
  });

  it('reads the metric of the option: mention, citation or share of voice', () => {
    const prompts = [prompt('p1', [2, 8], [1, 4], { cited: [4, 8], shareOfVoice: [6, 8] })];
    const reads = [ready('DE', prompts), ready('IN', prompts)];
    const rateOf = (metric: 'mention' | 'citation' | 'share_of_voice'): number | null => {
      const model = countryModel({ countries: ['DE', 'IN'], reads, asked: ASKED, metric });
      return model.kind === 'groups' ? (readyGroups(model.groups)[0]?.rows[0]?.value ?? null) : null;
    };
    expect(rateOf('mention')).toBeCloseTo(0.25, 12);
    expect(rateOf('citation')).toBeCloseTo(0.5, 12);
    expect(rateOf('share_of_voice')).toBeCloseTo(0.75, 12);
  });

  it('lists a failed country after the others, never cuts it, and does not count it as hidden', () => {
    const reads: CountryRead[] = [
      { country: 'ES', prompts: null, failed: true },
      ...Array.from({ length: 9 }, (_, index) => ready(`C${String(index)}`, filler(index + 1))),
    ];
    const model = countryModel({
      countries: reads.map((read) => read.country),
      reads,
      asked: ASKED,
      metric: 'mention',
    });
    if (model.kind !== 'groups') throw new Error('Ten countries must make groups');
    expect(model.groups).toHaveLength(MAX_COUNTRY_GROUPS + 1);
    expect(model.groups.at(-1)).toEqual({ kind: 'failed', country: 'ES' });
    expect(model.hidden).toBe(1);
  });

  it('keeps a country with no prompt in this scope as a group of unknown rows, last, and skips a read that has not answered', () => {
    const reads: CountryRead[] = [
      ready('DE', filler(2)),
      ready('FR', []),
      { country: 'IN', prompts: null, failed: false },
    ];
    const model = countryModel({ countries: ['DE', 'FR', 'IN'], reads, asked: ASKED, metric: 'mention' });
    if (model.kind !== 'groups') throw new Error('Three countries must make groups');
    expect(model.groups.map((group) => group.country)).toEqual(['DE', 'FR']);
    const france = readyGroups(model.groups)[1];
    expect(france?.prompts).toBe(0);
    expect(france?.rows.every((row) => row.state === 'none' && row.value === null)).toBe(true);
  });

  it('knows the three metrics and nothing else', () => {
    expect(['mention', 'citation', 'share_of_voice'].every(isCountryMetric)).toBe(true);
    expect(isCountryMetric('rank')).toBe(false);
  });
});
