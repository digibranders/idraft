import { sourcesMeta, type MetaOptions } from './source-fixtures';
import type {
  DomainRole,
  EngineCode,
  EngineRoleUnits,
  SourcePagePage,
  SourcePageRow,
  SourcesMeta,
} from '@/lib/citations/types';

/**
 * Builders of the own pages read and of the role split by engine, for the tests of CH-08 and CH-16. Typed by the
 * generated schema, like `source-fixtures.ts`. Not a test file.
 */

export interface PageRowOptions {
  url: string;
  urlId: number;
  units: number;
  title?: string | null;
  /** The host of the URL; default the host of `url`. */
  host?: string;
  domain?: string;
  answers?: number;
  prompts?: number;
  /** Units per engine. */
  engines?: readonly (readonly [EngineCode, number])[];
  role?: DomainRole;
  firstSeenAt?: string;
}

export function pageRow({
  url,
  urlId,
  units,
  title = null,
  host,
  domain = 'fynix.com',
  answers = units,
  prompts = 10,
  engines = [['chatgpt_web', units]],
  role = 'own',
  firstSeenAt = '2026-10-17T09:00:00Z',
}: PageRowOptions): SourcePageRow {
  return {
    url,
    url_id: urlId,
    title,
    host: host ?? domain,
    registrable_domain: domain,
    domain_role: role,
    role_entity_id: null,
    citation_units: units,
    observations: answers,
    prompts,
    engines: engines.map(([engine_code, citation_units]) => ({ engine_code, citation_units })),
    first_seen_at: firstSeenAt,
    last_seen_at: '2026-11-11T09:00:00Z',
    source_share: { numerator: units, denominator: 1000, n_observations: 100, value: units / 1000 },
  };
}

export function pagePage(
  rows: readonly SourcePageRow[],
  meta: SourcesMeta = sourcesMeta(),
  total: number = rows.length,
): SourcePagePage {
  return { data: [...rows], meta, page: { limit: 50, offset: 0, total } };
}

/** `[units, citing answers]` of a role on one engine. */
export type RoleCell = readonly [units: number, answers: number];

export interface EngineSplit {
  engine: EngineCode;
  own: RoleCell;
  competitor: RoleCell;
  thirdParty: RoleCell;
}

const roleAnswers = ([citation_units, answers_citing]: RoleCell): {
  citation_units: number;
  answers_citing: number;
} => ({
  citation_units,
  answers_citing,
});

/** The `by_role_by_engine` block of a read, one entry per engine given. */
export function roleBlock(splits: readonly EngineSplit[]): EngineRoleUnits[] {
  return splits.map(({ engine, own, competitor, thirdParty }) => ({
    engine_code: engine,
    own: roleAnswers(own),
    competitor: roleAnswers(competitor),
    third_party: roleAnswers(thirdParty),
  }));
}

/** Meta of a read with the role split by engine; the totals are those of the split unless `units` says otherwise. */
export function metaWithSplit(splits: readonly EngineSplit[], options: MetaOptions = {}): SourcesMeta {
  const sum = (pick: (split: EngineSplit) => RoleCell): number => splits.reduce((n, split) => n + pick(split)[0], 0);
  const byRole = {
    own: sum((s) => s.own),
    competitor: sum((s) => s.competitor),
    third_party: sum((s) => s.thirdParty),
  };
  const units = byRole.own + byRole.competitor + byRole.third_party;
  return {
    ...sourcesMeta({ units, byRole, engines: splits.map((split) => split.engine), ...options }),
    by_role_by_engine: roleBlock(splits),
  };
}
