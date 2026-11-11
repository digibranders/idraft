import { describe, expect, it } from 'vitest';

import { MOCK_ENTITY_IDS } from './entity-fixtures';
import { MOCK_PROJECTS } from './fixtures';
import {
  answerOf,
  DAY_MS,
  ENGINE_CODES,
  FIXTURE_PROMPTS,
  observationIdOf,
  parseObservationId,
  runInstants,
  webAddress,
  type Answer,
} from './prompt-fixtures';

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const PROMPTS = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
const PRODUCT_NAME = 'Fynix Audit';

interface Case {
  index: number;
  engine: (typeof ENGINE_CODES)[number];
  day: number;
  answer: Answer;
}

/** Every answer of the fixture prompts on the two engines Fynix has, over the 92 days of history. */
const CASES: Case[] = runInstants(NOW).flatMap((at) =>
  PROMPTS.flatMap((prompt) =>
    (['chatgpt_web', 'gemini_web'] as const).flatMap((engine) => {
      const day = Math.floor(at / DAY_MS);
      const index = prompt.index ?? -1;
      return index < 0 ? [] : [{ index, engine, day, answer: answerOf(index, prompt.language_code, engine, day) }];
    }),
  ),
);
const WITH_TEXT = CASES.filter((found) => found.answer.answer_text !== null);
/** The answers that count: complete and cut off ones, not a refusal. */
const VALID = CASES.filter((found) => found.answer.facts.is_valid);
const codePoints = (text: string): number => [...text].length;
/** The Devanagari block, U+0900 to U+097F, written as code points so this file stays ASCII. */
const DEVANAGARI = new RegExp(`[${String.fromCodePoint(0x900)}-${String.fromCodePoint(0x97f)}]`, 'u');
const isHindi = (text: string): boolean => DEVANAGARI.test(text);
const hasAstral = (text: string): boolean => [...text].some((char) => (char.codePointAt(0) ?? 0) > 0xffff);

describe('run instants', () => {
  it('are the Monday and Thursday runs at 02:00 UTC of the last 92 days, newest first', () => {
    const runs = runInstants(NOW);
    expect(new Date(runs[0] ?? 0).toISOString()).toBe('2026-11-12T02:00:00.000Z');
    expect(runs.every((at) => [1, 4].includes(new Date(at).getUTCDay()) && at % DAY_MS === 2 * 3_600_000)).toBe(true);
    expect(runs).toEqual([...runs].sort((a, b) => b - a));
    expect(runs.every((at) => NOW - at < 92 * DAY_MS && at <= NOW)).toBe(true);
    // Before the Thursday run of the day, the Monday run is the newest
    expect(new Date(runInstants(Date.parse('2026-11-12T01:00:00Z'))[0] ?? 0).toISOString()).toBe(
      '2026-11-09T02:00:00.000Z',
    );
  });
});

describe('observation ids', () => {
  it('carry the day, the prompt and the engine, and read back', () => {
    const id = observationIdOf(20_404, 7, 1);
    expect(id).toBe('204040071');
    expect(parseObservationId(id)).toEqual({ day: 20_404, index: 7, engine: 1 });
    expect(parseObservationId('9')).toBeNull();
    expect(parseObservationId('12ab34567')).toBeNull();
    expect(parseObservationId('0204040071')).toBeNull();
  });
});

describe('web addresses', () => {
  it('are http or https only, as the API gives a check link', () => {
    expect(webAddress('https://chatgpt.com/?q=a')).toBe('https://chatgpt.com/?q=a');
    expect(webAddress('HTTP://example.org/')).toBe('HTTP://example.org/');
    expect(webAddress('javascript:void(0)')).toBeNull();
    expect(webAddress('data:text/html,x')).toBeNull();
    expect(webAddress('not a url')).toBeNull();
    expect(webAddress(7)).toBeNull();
  });
});

describe('answer fixtures', () => {
  it('has every status, and an answer that is not valid has no outcome, no mention and no source', () => {
    expect(new Set(CASES.map((found) => found.answer.status))).toEqual(
      new Set(['complete', 'partial', 'empty', 'refused', 'error']),
    );
    for (const { answer } of CASES) {
      const valid = answer.status === 'complete' || answer.status === 'partial';
      expect(answer.facts.is_valid).toBe(valid);
      if (valid) continue;
      expect(answer.facts.outcome).toBeNull();
      expect(answer.mentions).toEqual([]);
      expect(answer.citations).toEqual([]);
    }
    const failed = CASES.find((found) => found.answer.status === 'error')?.answer;
    expect(failed).toMatchObject({ answer_text: null, error_code: 'provider_error', model_reported: null });
    const refused = CASES.find((found) => found.answer.status === 'refused')?.answer;
    expect(refused?.answer_text).not.toBeNull();
    expect(CASES.find((found) => found.answer.status === 'empty')?.answer.answer_text).toBeNull();
  });

  it('is the same answer every time it is asked for', () => {
    const first = CASES.slice(0, 40).map((found) => found.answer);
    const again = CASES.slice(0, 40).map((found) =>
      answerOf(found.index, PROMPTS[found.index]?.language_code ?? 'en', found.engine, found.day),
    );
    expect(again).toEqual(first);
  });

  it('has an answer in Hindi, an answer with an emoji, and an emoji before a mention', () => {
    expect(WITH_TEXT.some((found) => isHindi(found.answer.answer_text ?? ''))).toBe(true);
    expect(WITH_TEXT.some((found) => hasAstral(found.answer.answer_text ?? ''))).toBe(true);
    const shifted = WITH_TEXT.filter((found) =>
      found.answer.mentions.some((mention) => {
        const start = mention.evidence_spans[0]?.[0] ?? 0;
        const before = (found.answer.answer_text ?? '').slice(0, start);
        return hasAstral(before);
      }),
    );
    expect(shifted.length).toBeGreaterThan(0);
    // The Hindi prompt is asked in Hindi and answered in it
    const hindi = PROMPTS.find((prompt) => prompt.language_code === 'hi');
    expect(hindi).toBeDefined();
    expect(
      VALID.filter((found) => found.index === hindi?.index).every((found) => isHindi(found.answer.answer_text ?? '')),
    ).toBe(true);
  });

  it('gives each mention evidence spans in UTF-16 units that cut out its own words', () => {
    for (const { answer } of WITH_TEXT) {
      const text = answer.answer_text ?? '';
      for (const mention of answer.mentions) {
        expect(mention.evidence_spans.length).toBe(mention.mention_count);
        expect(mention.first_char_offset).toBe(mention.evidence_spans[0]?.[0]);
        for (const [start, end] of mention.evidence_spans) {
          const cut = text.slice(start, end);
          expect(cut).toBe(mention.match_method === 'via_product' ? PRODUCT_NAME : mention.name);
        }
      }
    }
  });

  it('numbers only the accepted own and competitor mentions, in the order the text names them', () => {
    let kinds = new Set<string>();
    for (const { answer } of WITH_TEXT) {
      const counted = answer.mentions.filter((mention) => mention.mention_order !== null);
      expect(counted.map((mention) => mention.mention_order)).toEqual(counted.map((_, place) => place + 1));
      const byOffset = [...counted].sort((a, b) => a.first_char_offset - b.first_char_offset);
      expect(byOffset).toEqual(counted);
      for (const mention of answer.mentions) {
        const numbered =
          mention.mention_status === 'accepted' &&
          (mention.role === 'own' || mention.role === 'competitor') &&
          mention.name !== PRODUCT_NAME;
        expect(mention.mention_order !== null).toBe(numbered);
        if (!numbered) kinds = new Set([...kinds, `${mention.role}:${mention.mention_status}:${mention.name}`]);
      }
      // The API lists the numbered mentions first, the others after them
      const orders = answer.mentions.map((mention) => mention.mention_order);
      expect(orders).toEqual([...orders].sort((a, b) => (a ?? Infinity) - (b ?? Infinity)));
    }
    // An uncertain competitor, a watched publication and a product all turn up
    expect(kinds).toContain('competitor:uncertain:Northlight SEO');
    expect(kinds).toContain('watch:accepted:SEO Weekly');
    expect(kinds).toContain(`own:accepted:${PRODUCT_NAME}`);
  });

  it('keeps the facts true to the mentions and the sources', () => {
    for (const { answer } of VALID) {
      const counted = answer.mentions.filter((mention) => mention.mention_order !== null);
      const own = counted.filter((mention) => mention.role === 'own');
      const competitors = counted.filter((mention) => mention.role === 'competitor');
      const ownCited = answer.citations.filter((citation) => citation.domain_role === 'own');
      const { facts } = answer;
      expect(facts.own_mentioned).toBe(own.length > 0);
      expect(facts.own_mention_order).toBe(own[0]?.mention_order ?? null);
      expect(facts.tracked_entities_mentioned).toBe(counted.length);
      expect(facts.competitor_mentions).toEqual(competitors.map((mention) => mention.entity_id));
      expect(facts.own_domain_cited).toBe(ownCited.length > 0);
      expect(facts.own_citation_count).toBe(ownCited.length);
      expect(facts.total_citation_count).toBe(answer.citations.length);
      expect(facts.competitor_cited).toEqual([
        ...new Set(
          answer.citations.flatMap((citation) =>
            citation.domain_role === 'competitor' && citation.role_entity_id !== null ? [citation.role_entity_id] : [],
          ),
        ),
      ]);
      const mentioned = facts.own_mentioned;
      const cited = facts.own_domain_cited;
      expect(facts.outcome).toBe(
        mentioned ? (cited ? 'mentioned_and_cited' : 'mentioned_only') : cited ? 'cited_only' : 'neither',
      );
      const text = answer.answer_text ?? '';
      const first = [...text.slice(0, own[0]?.first_char_offset ?? 0)].length;
      expect(facts.own_prominence).toBe(
        own[0] === undefined ? null : Math.round((1 - first / codePoints(text)) * 10_000) / 10_000,
      );
    }
    const outcomes = new Set(VALID.map((found) => found.answer.facts.outcome));
    expect(outcomes).toEqual(new Set(['mentioned_and_cited', 'mentioned_only', 'cited_only', 'neither']));
  });

  it('gives each source its canonical address, apart from the address the provider gave', () => {
    const kinds = new Set<string>();
    let differs = false;
    let notAWebAddress = false;
    for (const { answer } of WITH_TEXT) {
      answer.citations.forEach((citation, place) => {
        expect(citation.citation_index).toBe(place + 1);
        expect(webAddress(citation.url)).toBe(citation.url);
        expect(citation.url).not.toMatch(/utm_|gclid/);
        expect(citation.url).toContain(citation.host);
        kinds.add(citation.citation_kind);
        if (citation.raw_url !== citation.url) differs = true;
        if (webAddress(citation.raw_url) === null) notAWebAddress = true;
        if (citation.first_char_offset !== null) {
          const at = citation.first_char_offset;
          expect(answer.answer_text?.slice(at, at + citation.raw_url.length)).toBe(citation.raw_url);
        }
        if (citation.domain_role === 'third_party') expect(citation.role_entity_id).toBeNull();
        else expect(citation.role_entity_id).not.toBeNull();
      });
    }
    expect(differs).toBe(true);
    // The provider's own string is evidence, not a link: the API checks no scheme on it
    expect(notAWebAddress).toBe(true);
    expect(kinds).toContain('source_list');
    expect(kinds).toContain('inline');
    expect(kinds).toContain('product_card');
    const own = WITH_TEXT.flatMap((found) => found.answer.citations).find((citation) => citation.domain_role === 'own');
    expect(own?.role_entity_id).toBe(MOCK_ENTITY_IDS.fynix);
  });

  it('has a link to check the answer by only when the provider gave an http or https address', () => {
    const links = CASES.map((found) => found.answer.check_url);
    expect(links.some((link) => link !== null)).toBe(true);
    expect(links.some((link) => link === null)).toBe(true);
    for (const link of links) if (link !== null) expect(webAddress(link)).toBe(link);
  });

  it('marks a cut off answer partial and keeps it valid', () => {
    const partial = CASES.filter((found) => found.answer.status === 'partial');
    expect(partial.length).toBeGreaterThan(0);
    for (const { answer } of partial) {
      expect(answer.facts.is_valid).toBe(true);
      expect(answer.answer_text?.endsWith('...')).toBe(true);
    }
  });
});
