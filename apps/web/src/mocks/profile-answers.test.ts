import { describe, expect, it } from 'vitest';

import { webAddress } from './answer-builder';
import { EVENTUS_DEFINITION } from './ai-prompt-definition';
import { EVENTUS_WORLD } from './ai-prompt-world';
import { profileAnswer, unit, type EngineSlot } from './profile-answers';
import { DAY_MS, runInstants } from './prompt-fixtures';
import type { Answer } from './answer-builder';

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const world = EVENTUS_WORLD;
const definition = EVENTUS_DEFINITION;
const ENGINES: readonly EngineSlot[] = [
  { code: 'chatgpt_web', place: 0 },
  { code: 'gemini_web', place: 1 },
];
const DAYS = runInstants(NOW).map((at) => Math.floor(at / DAY_MS));

interface Case {
  index: number;
  key: string;
  slot: EngineSlot;
  engine: EngineSlot['code'];
  day: number;
  answer: Answer;
}

const CASES: Case[] = definition.prompts.flatMap((prompt, index) =>
  ENGINES.flatMap((slot) =>
    DAYS.map((day) => ({
      index,
      key: prompt.key,
      slot,
      engine: slot.code,
      day,
      answer: profileAnswer(world, index, slot, day),
    })),
  ),
);
const VALID = CASES.filter((found) => found.answer.facts.is_valid);
const WITH_TEXT = CASES.filter((found) => found.answer.answer_text !== null);

const rate = (cases: readonly Case[], test: (answer: Answer) => boolean): number =>
  cases.length === 0 ? 0 : cases.filter((found) => test(found.answer)).length / cases.length;
const validOf = (key: string, engine: EngineSlot['code']): Case[] =>
  VALID.filter((found) => found.key === key && found.engine === engine);

const ALIASES = new Map<string, string[]>([
  [world.brandId, definition.brand.aliases],
  ...definition.competitors.map((competitor): [string, string[]] => [
    world.entityIdOf(competitor.key),
    competitor.aliases,
  ]),
]);

describe('the hash behind the answers', () => {
  it('gives the same number for the same parts and a number in [0, 1)', () => {
    expect(unit(1, 2, 3)).toBe(unit(1, 2, 3));
    expect(unit(1, 2, 3)).not.toBe(unit(1, 2, 4));
    expect(unit(1, 2, 3)).not.toBe(unit(3, 2, 1));
    for (let n = 0; n < 500; n += 1) {
      const value = unit(n, n * 7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is spread evenly enough to stand for chance', () => {
    const draws = Array.from({ length: 4000 }, (_, n) => unit(9, n));
    const below = draws.filter((value) => value < 0.25).length / draws.length;
    expect(below).toBeGreaterThan(0.22);
    expect(below).toBeLessThan(0.28);
  });
});

describe('profile answers', () => {
  it('has an answer for every prompt on both engines for every run day', () => {
    expect(DAYS.length).toBeGreaterThanOrEqual(25);
    expect(CASES).toHaveLength(72 * 2 * DAYS.length);
  });

  it('is the same answer every time it is asked for', () => {
    const again = CASES.slice(0, 300).map((found) => profileAnswer(world, found.index, found.slot, found.day));
    expect(again).toEqual(CASES.slice(0, 300).map((found) => found.answer));
  });

  it('is not valid for about three answers in a hundred, and then holds no mention, source or outcome', () => {
    const invalid = CASES.filter((found) => !found.answer.facts.is_valid);
    const share = invalid.length / CASES.length;
    expect(share).toBeGreaterThan(0.015);
    expect(share).toBeLessThan(0.05);
    for (const { answer } of invalid) {
      expect(answer.facts.outcome).toBeNull();
      expect(answer.mentions).toEqual([]);
      expect(answer.citations).toEqual([]);
    }
    const errors = invalid.filter((found) => found.answer.status === 'error');
    expect(new Set(errors.map((found) => found.answer.error_code))).toEqual(new Set(['50000', 'schema_mismatch']));
    expect(new Set(invalid.map((found) => found.answer.status))).toEqual(new Set(['error', 'refused', 'empty']));
  });

  it('cuts some answers off, keeps them valid and ends them with an ellipsis', () => {
    const partial = CASES.filter((found) => found.answer.status === 'partial');
    expect(partial.length / CASES.length).toBeGreaterThan(0.008);
    expect(partial.length / CASES.length).toBeLessThan(0.04);
    for (const { answer } of partial) {
      expect(answer.facts.is_valid).toBe(true);
      expect(answer.answer_text?.endsWith('...')).toBe(true);
    }
  });

  it('writes mentions at UTF-16 offsets that cut out a name or an alias of the entity', () => {
    for (const { answer } of WITH_TEXT) {
      const text = answer.answer_text ?? '';
      for (const mention of answer.mentions) {
        expect(mention.evidence_spans.length).toBe(mention.mention_count);
        expect(mention.first_char_offset).toBe(mention.evidence_spans[0]?.[0]);
        for (const [start, end] of mention.evidence_spans) {
          expect(ALIASES.get(mention.entity_id)).toContain(text.slice(start, end));
        }
      }
    }
  });

  it('puts an emoji before some names, so a viewer that counts characters is wrong', () => {
    const astral = (text: string): boolean => [...text].some((char) => (char.codePointAt(0) ?? 0) > 0xffff);
    const shifted = WITH_TEXT.filter((found) =>
      found.answer.mentions.some((mention) =>
        astral((found.answer.answer_text ?? '').slice(0, mention.first_char_offset)),
      ),
    );
    expect(shifted.length).toBeGreaterThan(0);
  });

  it('numbers only the accepted own and competitor mentions, in the order the text names them', () => {
    let uncertain = 0;
    for (const { answer } of VALID) {
      const counted = answer.mentions.filter((mention) => mention.mention_order !== null);
      expect(counted.map((mention) => mention.mention_order)).toEqual(counted.map((_, place) => place + 1));
      expect([...counted].sort((a, b) => a.first_char_offset - b.first_char_offset)).toEqual(counted);
      for (const mention of answer.mentions) {
        const numbered = mention.mention_status === 'accepted';
        expect(mention.mention_order !== null).toBe(numbered);
        if (!numbered) {
          uncertain += 1;
          expect(mention.role).toBe('competitor');
          expect(mention.confidence).toBeLessThan(0.5);
        }
      }
    }
    expect(uncertain).toBeGreaterThan(0);
  });

  it('keeps the facts true to the mentions and the sources', () => {
    for (const { answer } of VALID) {
      const counted = answer.mentions.filter((mention) => mention.mention_order !== null);
      const own = counted.filter((mention) => mention.role === 'own');
      const ownCited = answer.citations.filter((citation) => citation.domain_role === 'own');
      const { facts } = answer;
      expect(facts.own_mentioned).toBe(own.length > 0);
      expect(facts.own_mention_order).toBe(own[0]?.mention_order ?? null);
      expect(facts.tracked_entities_mentioned).toBe(counted.length);
      expect(facts.competitor_mentions).toEqual(
        counted.filter((mention) => mention.role === 'competitor').map((mention) => mention.entity_id),
      );
      expect(facts.own_domain_cited).toBe(ownCited.length > 0);
      expect(facts.own_citation_count).toBe(ownCited.length);
      expect(facts.total_citation_count).toBe(answer.citations.length);
      expect(facts.outcome).toBe(
        facts.own_mentioned
          ? facts.own_domain_cited
            ? 'mentioned_and_cited'
            : 'mentioned_only'
          : facts.own_domain_cited
            ? 'cited_only'
            : 'neither',
      );
    }
    const outcomes = new Set(VALID.map((found) => found.answer.facts.outcome));
    expect(outcomes).toEqual(new Set(['mentioned_and_cited', 'mentioned_only', 'cited_only', 'neither']));
  });

  it('gives each source a canonical address, a role and an entity that agree', () => {
    const hosts = new Map<string, string>([
      ...definition.sources.map((source): [string, string] => [source.host, source.role]),
      ...definition.competitors.map((competitor): [string, string] => [competitor.domains[0] ?? '', 'competitor']),
    ]);
    for (const { answer } of VALID) {
      expect(answer.citations.length).toBeGreaterThan(0);
      answer.citations.forEach((citation, place) => {
        expect(citation.citation_index).toBe(place + 1);
        expect(webAddress(citation.url)).toBe(citation.url);
        expect(citation.url).not.toMatch(/utm_/);
        expect(hosts.get(citation.host)).toBe(citation.domain_role);
        if (citation.domain_role === 'third_party') expect(citation.role_entity_id).toBeNull();
        if (citation.domain_role === 'own') expect(citation.role_entity_id).toBe(world.brandId);
        if (citation.domain_role === 'competitor') expect(ALIASES.has(citation.role_entity_id ?? '')).toBe(true);
        if (citation.first_char_offset !== null) {
          const at = citation.first_char_offset;
          expect(answer.answer_text?.slice(at, at + citation.raw_url.length)).toBe(citation.raw_url);
        }
      });
      expect(new Set(answer.citations.map((citation) => citation.url)).size).toBe(answer.citations.length);
    }
  });

  it('tags the addresses ChatGPT gives with its referral tag, and no others', () => {
    for (const found of WITH_TEXT) {
      for (const citation of found.answer.citations) {
        if (found.engine === 'chatgpt_web') {
          expect(citation.referral_tag).toBe('chatgpt.com');
          expect(citation.raw_url).toBe(`${citation.url}?utm_source=chatgpt.com`);
        } else {
          expect(citation.referral_tag).toBeNull();
          expect(citation.raw_url).toBe(citation.url);
        }
      }
    }
    const kinds = new Set(
      WITH_TEXT.flatMap((found) => found.answer.citations.map((citation) => citation.citation_kind)),
    );
    expect([...kinds].sort()).toEqual(['inline', 'source_list']);
  });

  it('cites the own page that fits the topic of the prompt', () => {
    const own = validOf('p40', 'chatgpt_web').flatMap((found) =>
      found.answer.citations.filter((citation) => citation.domain_role === 'own'),
    );
    expect(own.length).toBeGreaterThan(0);
    for (const citation of own) expect(citation.url.startsWith('https://eventussecurity.com/compliance/')).toBe(true);
  });

  it('has a link to check the answer by only when it is an http or https address', () => {
    const links = CASES.map((found) => found.answer.check_url);
    expect(links.some((link) => link === null)).toBe(true);
    for (const link of links) if (link !== null) expect(webAddress(link)).toBe(link);
  });

  it('follows the profile: a prompt the brand wins, a tail where it is absent, and engines that disagree', () => {
    const mentioned = (answer: Answer): boolean => answer.facts.own_mentioned;
    const cited = (answer: Answer): boolean => answer.facts.own_domain_cited;
    expect(rate(validOf('p07', 'chatgpt_web'), mentioned)).toBeGreaterThan(0.7);
    expect(rate(validOf('p07', 'gemini_web'), mentioned)).toBeGreaterThan(0.7);
    expect(rate(validOf('p07', 'chatgpt_web'), cited)).toBeGreaterThan(0.4);
    expect(rate(validOf('p11', 'chatgpt_web'), mentioned)).toBeLessThan(0.3);
    expect(rate(validOf('p20', 'gemini_web'), mentioned)).toBeLessThan(0.3);
    // p14 and p10 are the two prompts the engines split on
    expect(rate(validOf('p14', 'chatgpt_web'), mentioned)).toBeGreaterThan(
      rate(validOf('p14', 'gemini_web'), mentioned) + 0.3,
    );
    expect(rate(validOf('p10', 'gemini_web'), mentioned)).toBeGreaterThan(
      rate(validOf('p10', 'chatgpt_web'), mentioned) + 0.3,
    );
    // A branded prompt names the brand first, nearly always
    const branded = validOf('p67', 'gemini_web');
    expect(rate(branded, mentioned)).toBeGreaterThan(0.85);
    expect(
      branded.filter((found) => found.answer.facts.own_mention_order === 1).length / branded.length,
    ).toBeGreaterThan(0.6);
  });

  it('names competitors the profile lists, and no one else', () => {
    const profile = definition.prompts.find((prompt) => prompt.key === 'p70')?.profile.chatgpt_web;
    const allowed = new Set((profile?.competitors ?? []).map(([key]) => world.entityIdOf(key)));
    const named = validOf('p70', 'chatgpt_web').flatMap((found) =>
      found.answer.mentions.filter((mention) => mention.role === 'competitor'),
    );
    expect(named.length).toBeGreaterThan(0);
    for (const mention of named) expect(allowed).toContain(mention.entity_id);
  });

  it('reports one model change inside the history on one engine only', () => {
    const change = definition.model_change;
    const changeDay = Date.parse(change.effective_date) / DAY_MS;
    expect(DAYS.some((day) => day < changeDay) && DAYS.some((day) => day >= changeDay)).toBe(true);
    const models = (engine: EngineSlot['code'], before: boolean): Set<string | null> =>
      new Set(
        VALID.filter((found) => found.engine === engine && found.day < changeDay === before).map(
          (found) => found.answer.model_reported,
        ),
      );
    const first = definition.engines.find((engine) => engine.engine_code === change.engine_code)?.model;
    expect(models(change.engine_code, true)).toEqual(new Set([first]));
    expect(models(change.engine_code, false)).toEqual(new Set([change.model]));
    expect(models('gemini_web', true)).toEqual(models('gemini_web', false));
    // The new model names the brand less, as the file says
    const before = validOf('p07', 'chatgpt_web').filter((found) => found.day < changeDay);
    const after = validOf('p07', 'chatgpt_web').filter((found) => found.day >= changeDay);
    expect(before.length).toBeGreaterThan(3);
    expect(after.length).toBeGreaterThan(3);
  });
});
