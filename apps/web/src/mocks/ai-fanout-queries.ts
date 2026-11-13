import type { EngineCode, Schemas } from '@/lib/api/types';

/**
 * The query rows of the fan-out mock: what the answers that issued queries searched for. The fixtures keep no list
 * of the queries an answer issued, so each answer is given one to three of the queries below, chosen from its id:
 * the same answer always issues the same queries, and the rows are the same on every read of a scope. Pure: answers
 * in, rows out. The route (handlers/ai-overview.ts) decides which answers count and pages the rows.
 *
 * shortcut: a fixed pool of queries, not text the engine wrote; replace it with the stored queries once the answer
 * fixtures keep them.
 */

type DomainRole = Schemas['FanoutCitedDomain']['domain_role'];
type FanoutQueryRow = Schemas['FanoutQueryRow'];
type FanoutCitedDomain = Schemas['FanoutCitedDomain'];

/** An answer that issued queries, with the domains its sources are on (one entry per domain and role). */
export interface FanoutAnswer {
  id: string;
  /** When it was asked, in milliseconds. */
  at: number;
  promptId: string;
  engine: EngineCode;
  cited: readonly {
    domain: string;
    role: DomainRole;
    entityId: string | null;
    /** Citation units of this domain in the answer. */
    units: number;
  }[];
}

/** The queries answers search for, spelled the way an engine writes them. */
const QUERY_POOL: readonly string[] = [
  'best SOC 2 compliance software for startups',
  'soc 2 audit cost 2026',
  'penetration testing providers comparison',
  'how long does ISO 27001 certification take',
  'vulnerability management tools for small teams',
  'managed detection and response pricing',
  'security awareness training platforms',
  'compliance automation alternatives',
  'compliance automation reviews',
  'best endpoint protection for remote teams',
  'cyber insurance requirements checklist',
  'HIPAA compliance software comparison',
  'zero trust network access vendors',
  'incident response retainer cost',
];

/** An answer issues 1 to `MOST_ISSUED` pool entries, `ISSUED_STEP` apart. */
const ISSUED_STEP = 5;
const MOST_ISSUED = 3;
const DOMAINS_PER_ROW = 5;
const HASH_START = 0x811c9dc5;
const HASH_PRIME = 0x01000193;

function hashOf(text: string): number {
  let hash = HASH_START;
  for (let place = 0; place < text.length; place += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(place), HASH_PRIME);
  }
  return hash >>> 0;
}

const normalized = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** The queries one answer issued. `ISSUED_STEP` is coprime with the pool size, so they never repeat within an answer. */
function queriesOf(answer: FanoutAnswer): string[] {
  const hash = hashOf(answer.id);
  const count = 1 + (hash % MOST_ISSUED);
  return Array.from({ length: count }, (_, place) => {
    const text = QUERY_POOL[(hash + place * ISSUED_STEP) % QUERY_POOL.length];
    if (text === undefined) throw new Error('The query pool has no entry at this place');
    return text;
  });
}

interface Group {
  text: string;
  engine: EngineCode;
  answers: FanoutAnswer[];
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The domains the answers cite, most units first (ties by name), at most 5. An association, not a link. */
function citedDomains(answers: readonly FanoutAnswer[]): FanoutCitedDomain[] {
  const units = new Map<string, FanoutCitedDomain>();
  for (const answer of answers) {
    for (const cited of answer.cited) {
      const key = `${cited.domain}|${cited.role}|${cited.entityId ?? ''}`;
      const found = units.get(key);
      units.set(key, {
        registrable_domain: cited.domain,
        domain_role: cited.role,
        role_entity_id: cited.entityId,
        citation_units: (found?.citation_units ?? 0) + cited.units,
      });
    }
  }
  return [...units.values()]
    .sort((a, b) => b.citation_units - a.citation_units || byText(a.registrable_domain, b.registrable_domain))
    .slice(0, DOMAINS_PER_ROW);
}

/**
 * One row per query and engine that at least `minSupport` answers issued, the most answers first, ties by text.
 * `observations` counts each answer once however often it lists the query.
 */
export function fanoutQueryRows(answers: readonly FanoutAnswer[], minSupport: number): FanoutQueryRow[] {
  const groups = new Map<string, Group>();
  for (const answer of answers) {
    for (const text of queriesOf(answer)) {
      const key = `${answer.engine}|${normalized(text)}`;
      const group = groups.get(key) ?? { text, engine: answer.engine, answers: [] };
      group.answers.push(answer);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .filter((group) => group.answers.length >= minSupport)
    .map((group): FanoutQueryRow => {
      const promptIds = [...new Set(group.answers.map((answer) => answer.promptId))].sort(byText);
      const times = group.answers.map((answer) => answer.at);
      return {
        query_text: group.text,
        normalized_text: normalized(group.text),
        engine_code: group.engine,
        observations: group.answers.length,
        prompts: promptIds.length,
        prompt_ids: promptIds,
        first_seen_at: new Date(Math.min(...times)).toISOString(),
        last_seen_at: new Date(Math.max(...times)).toISOString(),
        cited_domains: citedDomains(group.answers),
      };
    })
    .sort((a, b) => b.observations - a.observations || byText(a.normalized_text, b.normalized_text));
}
