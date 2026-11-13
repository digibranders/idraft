import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { registrableOf } from './citations-model';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import {
  answerOf,
  DAY_MS,
  ENGINE_CODES,
  FIXTURE_PROMPTS,
  observationIdOf,
  runInstants,
  type Answer,
} from '../prompt-fixtures';
import type { Schemas } from '@/lib/api/types';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { mockBrowser } from '@/test/mock-api';

/**
 * The answer is read through shapes declared against the generated types: a change to `AnswerCompare` breaks this
 * file at compile time, and `.strict()` makes an extra member fail the parse as a missing one does.
 */
const SIDE: z.ZodType<Schemas['CompareSide']> = z
  .object({
    observation_id: z.string(),
    observed_at: z.string(),
    own_mentioned: z.boolean(),
    own_domain_cited: z.boolean(),
  })
  .strict();
const ENTITY: z.ZodType<Schemas['CompareEntity']> = z
  .object({ entity_id: z.string(), name: z.string(), role: z.enum(['own', 'competitor', 'watch']) })
  .strict();
const SOURCE: z.ZodType<Schemas['CompareSource']> = z
  .object({
    registrable_domain: z.string(),
    host: z.string(),
    domain_role: z.enum(['own', 'competitor', 'third_party']),
    title: z.string().nullable(),
  })
  .strict();
const COMPARE: z.ZodType<Schemas['AnswerCompare']> = z
  .object({
    prompt_id: z.string(),
    engine_code: z.enum(['chatgpt_web', 'gemini_web', 'google_ai_mode']),
    latest: SIDE,
    baseline: SIDE,
    entities: z.object({ gained: z.array(ENTITY), lost: z.array(ENTITY), kept: z.array(ENTITY) }).strict(),
    sources: z.object({ gained: z.array(SOURCE), lost: z.array(SOURCE), kept_count: z.number() }).strict(),
  })
  .strict();
const RESPONSE: z.ZodType<Schemas['AnswerCompareResponse']> = z.object({ data: COMPARE }).strict();

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const COMPARE_OF = (id: string): string => `${W}/projects/${fynix.project_id}/ai/observations/${id}/compare`;
const PROMPTS = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
const ENGINES = ['chatgpt_web', 'gemini_web'] as const;
/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const FLAGGED = ['unresolved_redirect', 'engine_internal'];

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The runs the fixtures keep, as days since 1970, newest first. */
const days = (): number[] => runInstants(NOW).map((at) => Math.floor(at / DAY_MS));

interface Pair {
  id: string;
  latest: Answer;
  baseline: Answer;
  baselineId: string;
  prompt: (typeof PROMPTS)[number];
  engine: (typeof ENGINES)[number];
}

const answerAt = (prompt: (typeof PROMPTS)[number], engine: (typeof ENGINES)[number], day: number): Answer =>
  answerOf(prompt.index ?? 0, prompt.language_code, engine, day);
const idAt = (prompt: (typeof PROMPTS)[number], engine: (typeof ENGINES)[number], day: number): string =>
  observationIdOf(day, prompt.index ?? 0, ENGINE_CODES.indexOf(engine));

/**
 * What D1 says, worked out here and not by the handler: the newest earlier answer of the same prompt and engine
 * whose facts are valid and name the own brand.
 */
function pairOf(prompt: (typeof PROMPTS)[number], engine: (typeof ENGINES)[number], from: number): Pair | null {
  const all = days();
  const day = all[from];
  if (day === undefined) return null;
  const earlier = all.slice(from + 1).find((candidate) => {
    const facts = answerAt(prompt, engine, candidate).facts;
    return facts.is_valid && facts.own_mentioned;
  });
  if (earlier === undefined) return null;
  return {
    id: idAt(prompt, engine, day),
    latest: answerAt(prompt, engine, day),
    baseline: answerAt(prompt, engine, earlier),
    baselineId: idAt(prompt, engine, earlier),
    prompt,
    engine,
  };
}

/** D2 for entities: the accepted mentions of a tracked role, by entity id. */
const entityMap = (answer: Answer): Map<string, Schemas['CompareEntity']> =>
  new Map(
    answer.mentions
      .filter((mention) => mention.mention_status === 'accepted' && mention.role !== 'untracked')
      .map((mention) => [
        mention.entity_id,
        { entity_id: mention.entity_id, name: mention.name, role: mention.role as Schemas['CompareEntity']['role'] },
      ]),
  );
/** D2 for sources: the first citation of each registrable domain, flagged citations left out. */
const sourceMap = (answer: Answer): Map<string, Schemas['CompareSource']> => {
  const found = new Map<string, Schemas['CompareSource']>();
  for (const citation of answer.citations) {
    if (citation.flags.some((flag) => FLAGGED.includes(flag))) continue;
    const domain = registrableOf(citation.host);
    if (!found.has(domain)) {
      found.set(domain, {
        registrable_domain: domain,
        host: citation.host,
        domain_role: citation.domain_role,
        title: citation.title,
      });
    }
  }
  return found;
};
const minus = <T>(a: Map<string, T>, b: Map<string, T>): T[] => [...a].filter(([key]) => !b.has(key)).map(([, v]) => v);

const everyPair = (): Pair[] =>
  PROMPTS.flatMap((prompt) =>
    ENGINES.flatMap((engine) => {
      const pair = pairOf(prompt, engine, 0);
      return pair === null ? [] : [pair];
    }),
  );

describe('the compare route of the answer', () => {
  it('has the shape the schema says, and a changed member fails the parse', async () => {
    const [pair] = everyPair();
    expect(pair).toBeDefined();
    const answer = await mockBrowser('viewer').call('GET', COMPARE_OF(pair?.id ?? ''));
    expect(answer.status).toBe(200);
    const parsed = RESPONSE.parse(answer.body);
    expect(parsed.data.prompt_id).toBe(pair?.prompt.prompt_id);
    expect(parsed.data.engine_code).toBe(pair?.engine);
    expect(RESPONSE.safeParse({ data: { ...parsed.data, extra: 1 } }).success).toBe(false);
    expect(RESPONSE.safeParse({ data: { ...parsed.data, sources: { gained: [], lost: [] } } }).success).toBe(false);
  });

  it('compares with the newest earlier valid answer of the same prompt and engine that named the own brand', async () => {
    const viewer = mockBrowser('viewer');
    const pairs = everyPair();
    // Not vacuous: some pair skips an answer that did not name the brand
    expect(pairs.some((pair) => pair.baselineId !== idAt(pair.prompt, pair.engine, days()[1] ?? 0))).toBe(true);
    for (const pair of pairs) {
      const answer = await viewer.call('GET', COMPARE_OF(pair.id));
      const { data } = RESPONSE.parse(answer.body);
      expect(data.latest.observation_id).toBe(pair.id);
      expect(data.baseline.observation_id).toBe(pair.baselineId);
      expect(Date.parse(data.baseline.observed_at)).toBeLessThan(Date.parse(data.latest.observed_at));
      expect(data.latest.own_mentioned).toBe(pair.latest.facts.own_mentioned);
      expect(data.baseline.own_mentioned).toBe(true);
      expect(data.baseline.own_domain_cited).toBe(pair.baseline.facts.own_domain_cited);
    }
  });

  it('lists the entities gained, lost and kept, and the sources gained and lost, as sets', async () => {
    const viewer = mockBrowser('viewer');
    let gained = 0;
    let lost = 0;
    for (const pair of everyPair()) {
      const { data } = RESPONSE.parse((await viewer.call('GET', COMPARE_OF(pair.id))).body);
      const now = entityMap(pair.latest);
      const before = entityMap(pair.baseline);
      const byId = (a: { entity_id: string }, b: { entity_id: string }): number =>
        a.entity_id.localeCompare(b.entity_id);
      expect([...data.entities.gained].sort(byId)).toEqual(minus(now, before).sort(byId));
      expect([...data.entities.lost].sort(byId)).toEqual(minus(before, now).sort(byId));
      expect([...data.entities.kept].sort(byId)).toEqual(
        [...now]
          .filter(([id]) => before.has(id))
          .map(([, v]) => v)
          .sort(byId),
      );
      const sourcesNow = sourceMap(pair.latest);
      const sourcesBefore = sourceMap(pair.baseline);
      const byDomain = (a: { registrable_domain: string }, b: { registrable_domain: string }): number =>
        a.registrable_domain.localeCompare(b.registrable_domain);
      expect([...data.sources.gained].sort(byDomain)).toEqual(minus(sourcesNow, sourcesBefore).sort(byDomain));
      expect([...data.sources.lost].sort(byDomain)).toEqual(minus(sourcesBefore, sourcesNow).sort(byDomain));
      expect(data.sources.kept_count).toBe([...sourcesNow].filter(([domain]) => sourcesBefore.has(domain)).length);
      gained += data.entities.gained.length + data.sources.gained.length;
      lost += data.entities.lost.length + data.sources.lost.length;
    }
    // Not vacuous: the fixtures do change from one answer to the next
    expect(gained).toBeGreaterThan(0);
    expect(lost).toBeGreaterThan(0);
  });

  it('is stable: gained and lost come sorted by name and by domain', async () => {
    const viewer = mockBrowser('viewer');
    for (const pair of everyPair()) {
      const { data } = RESPONSE.parse((await viewer.call('GET', COMPARE_OF(pair.id))).body);
      for (const list of [data.entities.gained, data.entities.lost, data.entities.kept]) {
        const names = list.map((entity) => entity.name);
        expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      }
      for (const list of [data.sources.gained, data.sources.lost]) {
        const domains = list.map((source) => source.registrable_domain);
        expect(domains).toEqual([...domains].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      }
    }
  });

  it('leaves a flagged citation out of the sources', async () => {
    const viewer = mockBrowser('viewer');
    let flaggedSeen = 0;
    for (const prompt of PROMPTS) {
      for (const engine of ENGINES) {
        for (const [from] of days().entries()) {
          const pair = pairOf(prompt, engine, from);
          if (pair === null) continue;
          if (!pair.latest.citations.some((citation) => citation.flags.some((flag) => FLAGGED.includes(flag))))
            continue;
          flaggedSeen += 1;
          const { data } = RESPONSE.parse((await viewer.call('GET', COMPARE_OF(pair.id))).body);
          const hosts = [...data.sources.gained, ...data.sources.lost].map((source) => source.host);
          expect(hosts).not.toContain('example.org');
        }
      }
    }
    expect(flaggedSeen).toBeGreaterThan(0);
  });

  it('answers 404 no_baseline for the oldest answer, which has no earlier one', async () => {
    const oldest = days().at(-1) ?? 0;
    const [prompt] = PROMPTS;
    if (prompt === undefined) throw new Error('The fixture prompts are missing');
    const answer = await mockBrowser('viewer').call('GET', COMPARE_OF(idAt(prompt, 'chatgpt_web', oldest)));
    expect(answer.status).toBe(404);
    expect(answer.code).toBe('no_baseline');
    expect(answer.body).toMatchObject({ title: 'No earlier answer to compare', status: 404 });
  });

  it('answers 404 not_found for an answer the project does not have, and 422 for an id that is no 64 bit integer', async () => {
    const viewer = mockBrowser('viewer');
    expect((await viewer.call('GET', COMPARE_OF('99999999999'))).code).toBe('not_found');
    const none = await viewer.call('GET', COMPARE_OF('0'));
    expect(none.status).toBe(422);
    const big = await viewer.call('GET', COMPARE_OF(String(2n ** 63n)));
    expect(big.status).toBe(422);
    const text = await viewer.call('GET', COMPARE_OF('abc'));
    expect(text.status).toBe(422);
  });

  it("answers 404 for a project that is not the answer's, and 401 without a session", async () => {
    const [pair] = everyPair();
    const other = `${W}/projects/${cleanstart.project_id}/ai/observations/${pair?.id ?? ''}/compare`;
    expect((await mockBrowser('viewer').call('GET', other)).code).toBe('not_found');
    const anonymous = await fetch(`${TEST_API_ORIGIN}${COMPARE_OF(pair?.id ?? '')}`);
    expect(anonymous.status).toBe(401);
  });

  it('is open to a viewer, who has data:read and no raw:read', async () => {
    const [pair] = everyPair();
    expect((await mockBrowser('viewer').call('GET', COMPARE_OF(pair?.id ?? ''))).status).toBe(200);
  });

  it('does not take the observed_at hint as a parameter that could fail the read', async () => {
    const [pair] = everyPair();
    const answer = await mockBrowser('viewer').call(
      'GET',
      `${COMPARE_OF(pair?.id ?? '')}?observed_at=2026-11-12T02:00:00Z`,
    );
    expect(answer.status).toBe(200);
  });
});
