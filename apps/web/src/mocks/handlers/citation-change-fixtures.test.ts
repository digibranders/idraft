import { afterEach, describe, expect, it } from 'vitest';

import { FADED, FILLER_HOST, NEWCOMER, withChangeFixtures } from './citation-change-fixtures';
import {
  answersWithCitations,
  changesOf,
  countedAnswers,
  metaOf,
  NO_FLAGS,
  scopeOf,
  unitsOf,
  type CitedAnswer,
  type DomainRole,
  type ScopeInput,
} from './citations-model';
import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS } from '../fixtures';
import { DAY_MS, RUN_OFFSET_MS } from '../prompt-fixtures';
import { promptsOf } from '../prompts-state';
import type { CitationOut } from '@/lib/api/types';

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered and is the newest run. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const FRIDAY = Date.parse('2026-11-13T12:00:00Z');
const ANCHOR = Date.parse('2026-11-12T00:00:00Z') + RUN_OFFSET_MS;

const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (fynix === undefined || eventus === undefined) throw new Error('The fixture projects are missing');

afterEach(() => {
  setAiSeeded(false);
});

function cite(
  host: string,
  place: number,
  role: DomainRole = 'third_party',
  extra: Partial<CitationOut> = {},
): CitationOut {
  const url = `https://${host}/page-${String(place)}`;
  return {
    citation_index: place,
    url,
    raw_url: url,
    host,
    title: `Page ${String(place)}`,
    source_name: null,
    citation_kind: 'source_list',
    domain_role: role,
    role_entity_id: null,
    occurrences: 1,
    first_char_offset: null,
    answer_block_index: null,
    referral_tag: null,
    flags: [],
    ...extra,
  };
}

const filler = (place = 2, extra: Partial<CitationOut> = {}): CitationOut =>
  cite(FILLER_HOST, place, 'third_party', extra);

let nextId = 5000;
function answer(at: number, citations: CitationOut[], engine: CitedAnswer['engine'] = 'chatgpt_web'): CitedAnswer {
  nextId += 1;
  return { id: String(nextId), at, promptId: 'p1', engine, valid: true, citations, named: [] };
}

const hostsOf = (answers: readonly CitedAnswer[]): string[][] =>
  answers.map((one) => one.citations.map((citation) => citation.host));

describe('withChangeFixtures', () => {
  it('swaps the filler citation of the newest answers for the new domain', () => {
    const inside = answer(ANCHOR, [cite('guide.com', 1), filler()]);
    const edge = answer(ANCHOR - 4 * DAY_MS, [filler(1)]);
    const outside = answer(ANCHOR - 4 * DAY_MS - 1, [filler(1)]);
    const made = withChangeFixtures([inside, edge, outside], NOW);
    expect(hostsOf(made)).toEqual([['guide.com', NEWCOMER.host], [NEWCOMER.host], [FILLER_HOST]]);
  });

  it('swaps the filler citation of answers 60 to 80 days back for the lost domain', () => {
    const oldest = answer(ANCHOR - 80 * DAY_MS, [filler()]);
    const newest = answer(ANCHOR - 60 * DAY_MS - 1, [filler()]);
    const tooOld = answer(ANCHOR - 80 * DAY_MS - 1, [filler()]);
    const tooNew = answer(ANCHOR - 60 * DAY_MS, [filler()]);
    const made = withChangeFixtures([oldest, newest, tooOld, tooNew], NOW);
    expect(hostsOf(made)).toEqual([[FADED.host], [FADED.host], [FILLER_HOST], [FILLER_HOST]]);
  });

  it('leaves every other answer as it was', () => {
    const middle = answer(ANCHOR - 30 * DAY_MS, [cite('guide.com', 1), filler()]);
    const others = answer(ANCHOR, [
      cite('guide.com', 1),
      cite('rival.com', 2, 'competitor'),
      cite(FILLER_HOST, 3, 'competitor'),
    ]);
    const elsewhere = answer(ANCHOR - 70 * DAY_MS, [cite('other.example.com', 1)]);
    const made = withChangeFixtures([middle, others, elsewhere], NOW);
    expect(made).toEqual([middle, others, elsewhere]);
    // An answer with nothing to swap is the same object, not a copy
    expect(made.map((one, place) => one === [middle, others, elsewhere][place])).toEqual([true, true, true]);
  });

  it('keeps what a swapped citation was and says where it points now', () => {
    const tagged = filler(3, {
      raw_url: `https://${FILLER_HOST}/seo-digest?utm_source=newsletter`,
      referral_tag: 'newsletter',
      occurrences: 2,
      citation_kind: 'inline',
      flags: [],
    });
    const [swapped] = withChangeFixtures([answer(ANCHOR, [tagged])], NOW);
    expect(swapped?.citations).toEqual([
      {
        ...tagged,
        url: NEWCOMER.url,
        raw_url: NEWCOMER.url,
        host: NEWCOMER.host,
        title: NEWCOMER.title,
        source_name: NEWCOMER.source_name,
        domain_role: 'third_party',
        role_entity_id: null,
        flags: [],
      },
    ]);
  });

  it('keeps the units of every answer', () => {
    const world = [
      answer(ANCHOR, [cite('guide.com', 1), filler(2), cite('rival.com', 3, 'competitor')]),
      answer(ANCHOR - 3 * DAY_MS, [filler(1), cite('guide.com', 2)]),
      answer(ANCHOR - 70 * DAY_MS, [filler(1), cite('guide.com', 2)]),
      answer(ANCHOR - 30 * DAY_MS, [filler(1)]),
    ];
    const made = withChangeFixtures(world, NOW);
    expect(made.map((one) => unitsOf(one, NO_FLAGS).length)).toEqual(world.map((one) => unitsOf(one, NO_FLAGS).length));
  });

  it('changes no total', () => {
    const world = [
      answer(ANCHOR, [cite('guide.com', 1), filler(2), cite('rival.com', 3, 'competitor')], 'chatgpt_web'),
      answer(ANCHOR - 3 * DAY_MS, [filler(1), cite('own.com', 2, 'own')], 'gemini_web'),
      answer(ANCHOR - 70 * DAY_MS, [filler(1), cite('guide.com', 2)], 'chatgpt_web'),
    ];
    const prompt: ScopeInput['prompts'][number] = {
      prompt_id: 'p1',
      is_active: true,
      is_branded: false,
      country_iso: 'DE',
      term_ids: [],
    };
    const scope = scopeOf({
      now: NOW,
      timezone: 'UTC',
      from: '2026-08-01',
      to: '2026-11-12',
      engines: [],
      prompts: [prompt],
      promptId: null,
      termIds: null,
      country: null,
      roles: [],
      includeBranded: false,
      includeUnresolvedRedirects: false,
      includeEngineInternal: false,
    });
    const before = metaOf(world, scope);
    const after = metaOf(withChangeFixtures(world, NOW), scope);
    expect(before.citation_units).toBe(7);
    expect(after.citation_units).toBe(before.citation_units);
    expect(after.answers).toBe(before.answers);
    expect(after.answers_citing).toBe(before.answers_citing);
    expect(after.by_role).toEqual(before.by_role);
  });

  it('anchors on the newest run, not on the instant of the read', () => {
    // On Friday noon the newest run is still Thursday 02:00; four days before it is Sunday 02:00
    const sunday = answer(ANCHOR - 4 * DAY_MS, [filler()]);
    expect(hostsOf(withChangeFixtures([sunday], FRIDAY))).toEqual([[NEWCOMER.host]]);
    expect(hostsOf(withChangeFixtures([sunday], NOW))).toEqual([[NEWCOMER.host]]);
  });
});

describe('the mock world of Fynix', () => {
  /** The default window of the Citations page: the 28 project days ending today, in the project's zone. */
  const defaultScope = (): ReturnType<typeof scopeOf> =>
    scopeOf({
      now: NOW,
      timezone: fynix.timezone,
      from: null,
      to: null,
      engines: [],
      prompts: promptsOf(fynix.project_id).prompts,
      promptId: null,
      termIds: null,
      country: null,
      roles: [],
      includeBranded: false,
      includeUnresolvedRedirects: false,
      includeEngineInternal: false,
    });

  it('cites the new domain in the newest answers and the lost domain 60 to 80 days back', () => {
    const answers = answersWithCitations(fynix.project_id, NOW);
    const hostsAt = (from: number, to: number): Set<string> =>
      new Set(answers.filter((one) => one.at >= from && one.at < to).flatMap((one) => hostsOf([one]).flat()));
    expect(hostsAt(ANCHOR - 4 * DAY_MS, ANCHOR + 1).has(NEWCOMER.host)).toBe(true);
    expect(hostsAt(ANCHOR - 4 * DAY_MS, ANCHOR + 1).has(FILLER_HOST)).toBe(false);
    expect(hostsAt(ANCHOR - 80 * DAY_MS, ANCHOR - 60 * DAY_MS).has(FADED.host)).toBe(true);
    expect(hostsAt(ANCHOR - 80 * DAY_MS, ANCHOR - 60 * DAY_MS).has(FILLER_HOST)).toBe(false);
    // Between them the filler is still cited, so example.com keeps rows in the lists
    expect(hostsAt(ANCHOR - 56 * DAY_MS, ANCHOR - 5 * DAY_MS).has(FILLER_HOST)).toBe(true);
    // The fixtures never reach the answers of another project
    expect(answersWithCitations(eventus.project_id, NOW).flatMap((one) => hostsOf([one]).flat())).not.toContain(
      NEWCOMER.host,
    );
  });

  it('the default window has one new and one lost domain', () => {
    const answers = answersWithCitations(fynix.project_id, NOW);
    const scope = defaultScope();
    expect(countedAnswers(answers, scope).length).toBeGreaterThan(0);

    const added = changesOf('new', answers, scope, 2).rows;
    expect(added.map((row) => row.registrable_domain)).toEqual([NEWCOMER.host]);
    expect(added[0]?.previous_units).toBe(0);
    expect(added[0]?.current_units).toBeGreaterThanOrEqual(2);

    const lost = changesOf('lost', answers, scope, 2).rows;
    expect(lost.map((row) => row.registrable_domain)).toEqual([FADED.host]);
    expect(lost[0]?.current_units).toBe(0);
    expect(lost[0]?.previous_units).toBeGreaterThanOrEqual(2);

    // example.com is cited in every window in between, so it is neither
    expect([...added, ...lost].some((row) => row.registrable_domain === 'example.com')).toBe(false);
  });
});
