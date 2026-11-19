import { NO_FLAGS, registrableOf, unitsOf, type CitedAnswer } from './handlers/citations-model';
import { ENGINE_CODES, ENGINE_FACTS } from './prompt-fixtures';
import { cellEntityIds } from './prompt-summary';
import { shiftIsoDate } from './serp-views';
import type { EngineCode, EntityCells, PromptsSummary, Schemas, SummaryEntity, WeekCells } from '@/lib/api/types';

/**
 * The arithmetic of the competitors reads (docs/ai-visibility/contracts/c5-competitors.md and c8-metrics.md), as the
 * API does it (backend `api/ai/competitors.py` and `metrics.py`): every figure is a cell of the prompts summary
 * relabelled, so it equals the Topics and Prompts number (R12); the reads the summary has no cell for (citation
 * share, lost prompts, top sources) come from the answers of the same scope. Pure: no MSW, no Response. The routes
 * (./handlers/competitors.ts) validate, read the summary and answer.
 */

type AiMetricValue = Schemas['AiMetricValue'];
type MetricCell = Schemas['MetricCell'];
type MetricWindow = Schemas['MetricWindow'];
type AiFilters = Schemas['AiFilters'];
type EntityRef = Schemas['EntityRef'];

/** The fewest valid answers a prompt needs on an engine to be judged (the CH-05 floor of the Overview). */
export const MIN_ANSWERS = 4;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The engine of a summary's code: a code outside the three cannot reach here (the routes refuse it). */
export function engineOf(code: string): EngineCode {
  const found = ENGINE_CODES.find((candidate) => candidate === code);
  if (found === undefined) throw new Error(`Unknown engine code ${code} in a competitors read`);
  return found;
}

// The top competitor

export interface TopCandidate {
  entity_id: string;
  name: string;
  /** The share of voice numerator and the mention rate numerator on the engine. */
  sov: number;
  mention: number;
}

/** Ties are compared at 9 decimals, as the API does. */
const nine = (value: number): number => Math.round(value * 1e9);

/**
 * The competitor with the most share of voice on an engine; ties go to the larger mention numerator, then the name
 * (case-folded), then the id. None when no competitor was named: the product never names one that was never named.
 */
export function topCompetitorId(candidates: readonly TopCandidate[]): string | null {
  const [top] = [...candidates].sort(
    (a, b) =>
      nine(b.sov) - nine(a.sov) ||
      nine(b.mention) - nine(a.mention) ||
      byText(a.name.toLowerCase(), b.name.toLowerCase()) ||
      byText(a.entity_id, b.entity_id),
  );
  return top !== undefined && nine(top.sov) > 0 ? top.entity_id : null;
}

// Values

/** What every value of a response says about its scope. */
export interface Basis {
  window: MetricWindow;
  filters: AiFilters;
}

const SOV_METHOD =
  "The entity's share of the tracked entities each answer names, summed over the answers that name one.";
const MENTION_METHOD = 'Valid answers that name the entity, prompt weighted.';
const NOT_CLASSIFIED = 'Not classified yet: no answer carries a recommendation label.';

/** The members every value of an entity on an engine shares. */
const labelled = (
  basis: Basis,
  engine: EngineCode,
  entityId: string,
): Omit<AiMetricValue, 'metric' | 'value' | 'numerator' | 'denominator' | 'n_observations' | 'method'> => ({
  window: basis.window,
  filters: basis.filters,
  observation_class: ENGINE_FACTS[engine].observation_class,
  engine_code: engine,
  entity_id: entityId,
  is_estimate: false,
  method_version: 1,
  unit: 'ratio',
});

/** `previous` of a value: left out without compare, null when the engine had no answer there. */
const previousOf = (previous: MetricCell | null | undefined): Pick<AiMetricValue, 'previous'> =>
  previous === undefined ? {} : { previous };

/** `ai.mention_rate` of an entity on an engine, from its `mentioned` cell: prompt weighted, with `pooled` answers. */
export function mentionValue(basis: Basis, engine: EngineCode, entityId: string, cells: EntityCells): AiMetricValue {
  const cell = cells.mentioned;
  return {
    metric: 'ai.mention_rate',
    value: cell.value,
    numerator: cell.numerator,
    denominator: cell.denominator,
    n_observations: cell.n_observations,
    n_prompts: cell.denominator,
    aggregation: 'prompt_weighted',
    method: MENTION_METHOD,
    ...labelled(basis, engine, entityId),
    ...(cell.pooled == null ? {} : { pooled: cell.pooled }),
    ...previousOf(cells.previous === undefined ? undefined : (cells.previous?.mentioned ?? null)),
  };
}

/** `ai.share_of_voice` of an entity on an engine, from its `share_of_voice` cell: observation weighted. */
export function shareValue(basis: Basis, engine: EngineCode, entityId: string, cells: EntityCells): AiMetricValue {
  const cell = cells.share_of_voice;
  return {
    metric: 'ai.share_of_voice',
    value: cell.value,
    numerator: cell.numerator,
    denominator: cell.denominator,
    n_observations: cell.n_observations,
    aggregation: 'observation_weighted',
    method: SOV_METHOD,
    ...labelled(basis, engine, entityId),
    ...previousOf(cells.previous === undefined ? undefined : (cells.previous?.share_of_voice ?? null)),
  };
}

/** `ai.recommendation_rate`: suppressed `not_classified` for every entity, as nothing classifies a recommendation yet. */
export const recommendationValue = (
  basis: Basis,
  engine: EngineCode,
  entityId: string,
  validAnswers: number,
): AiMetricValue => ({
  metric: 'ai.recommendation_rate',
  value: null,
  numerator: null,
  denominator: null,
  n_observations: validAnswers,
  method: NOT_CLASSIFIED,
  suppressed_reason: 'not_classified',
  ...labelled(basis, engine, entityId),
});

// Answers: citation units, lost prompts and sources

/** The answers of one engine. */
const onEngine = (answers: readonly CitedAnswer[], engine: EngineCode): CitedAnswer[] =>
  answers.filter((answer) => answer.engine === engine);

export interface EngineUnits {
  /** Every citation unit of the engine, whatever its role. */
  all: number;
  /** The units cited with an entity as the role entity. */
  byEntity: ReadonlyMap<string, number>;
  /** The engine's valid answers. */
  valid: number;
}

/** The citation units of the valid answers of an engine (flag default: engine internal and unresolved redirects left out). */
export function unitsOfEngine(answers: readonly CitedAnswer[], engine: EngineCode): EngineUnits {
  const byEntity = new Map<string, number>();
  let all = 0;
  const valid = onEngine(answers, engine).filter((answer) => answer.valid);
  for (const answer of valid) {
    for (const unit of unitsOf(answer, NO_FLAGS)) {
      all += 1;
      if (unit.role_entity_id !== null) byEntity.set(unit.role_entity_id, (byEntity.get(unit.role_entity_id) ?? 0) + 1);
    }
  }
  return { all, byEntity, valid: valid.length };
}

/** `ai.citation_share`: the entity's units over all the engine's units; its observations are the engine's valid answers. */
export function citationValue(basis: Basis, engine: EngineCode, entityId: string, units: EngineUnits): AiMetricValue {
  const own = units.byEntity.get(entityId) ?? 0;
  return {
    metric: 'ai.citation_share',
    value: units.all === 0 ? null : own / units.all,
    numerator: own,
    denominator: units.all,
    n_observations: units.valid,
    aggregation: 'observation_weighted',
    method:
      "The entity's citation units over all citation units of the engine; each unit is a distinct canonical URL of an answer.",
    ...labelled(basis, engine, entityId),
  };
}

export interface LostInput {
  /** The answers of the scope, valid or not. */
  answers: readonly CitedAnswer[];
  prompts: ReadonlyMap<string, { text: string; importance: number }>;
  ownIds: ReadonlySet<string>;
  limit: number;
}

export interface LostBlock {
  prompts: Schemas['LostPrompt'][];
  total: number;
  withMinAnswers: number;
  clearTotal: number;
}

/**
 * The prompts a competitor wins on an engine (c5, "Lost prompts"): named in at least one valid answer that does not
 * name the own brand (`total`, before the cap); of the prompts with 4 or more valid answers (`withMinAnswers`), those
 * where it is named and the own brand is named in none (`clearTotal`, never above `withMinAnswers`).
 * shortcut: "named" is the fixtures' accepted mentions of the answer; the API reads its fact tables, which hold the
 * same answers.
 */
export function lostPromptsOf(competitorId: string, engine: EngineCode, input: LostInput): LostBlock {
  const byPrompt = new Map<string, CitedAnswer[]>();
  for (const answer of onEngine(input.answers, engine)) {
    byPrompt.set(answer.promptId, [...(byPrompt.get(answer.promptId) ?? []), answer]);
  }
  const lost: Schemas['LostPrompt'][] = [];
  let withMinAnswers = 0;
  let clearTotal = 0;
  const ownNamed = (answer: CitedAnswer): boolean => answer.named.some((id) => input.ownIds.has(id));
  for (const [promptId, all] of byPrompt) {
    const prompt = input.prompts.get(promptId);
    if (prompt === undefined) continue;
    const valid = all.filter((answer) => answer.valid);
    const losing = valid.filter((answer) => answer.named.includes(competitorId) && !ownNamed(answer));
    const judged = valid.length >= MIN_ANSWERS;
    if (judged) withMinAnswers += 1;
    if (judged && losing.length > 0 && !valid.some(ownNamed)) clearTotal += 1;
    if (losing.length === 0) continue;
    lost.push({
      prompt_id: promptId,
      text: prompt.text,
      importance: prompt.importance,
      lost: {
        numerator: losing.length,
        denominator: valid.length,
        n_observations: all.length,
        value: losing.length / valid.length,
        pooled: null,
      },
    });
  }
  lost.sort(
    (a, b) =>
      b.importance - a.importance ||
      b.lost.numerator - a.lost.numerator ||
      byText(a.text, b.text) ||
      byText(a.prompt_id, b.prompt_id),
  );
  return { prompts: lost.slice(0, input.limit), total: lost.length, withMinAnswers, clearTotal };
}

/** The registrable domains cited with an entity as the role entity, by citation units, then domain, at most `limit`. */
export function topSourcesOf(
  entityId: string,
  answers: readonly CitedAnswer[],
  limit: number,
): Schemas['CompetitorSource'][] {
  const domains = new Map<string, { units: number; answers: Set<string> }>();
  for (const answer of answers.filter((candidate) => candidate.valid)) {
    for (const unit of unitsOf(answer, NO_FLAGS)) {
      if (unit.role_entity_id !== entityId) continue;
      const domain = registrableOf(unit.host);
      const found = domains.get(domain) ?? { units: 0, answers: new Set<string>() };
      found.units += 1;
      found.answers.add(answer.id);
      domains.set(domain, found);
    }
  }
  return [...domains]
    .map(([registrable_domain, found]) => ({
      registrable_domain,
      citation_units: found.units,
      answers: found.answers.size,
    }))
    .sort((a, b) => b.citation_units - a.citation_units || byText(a.registrable_domain, b.registrable_domain))
    .slice(0, limit);
}

// The entity configuration

export interface EntityConfig {
  versions: number[];
  /** Left out of a response when the window holds one version. */
  changes: Schemas['AiEntityConfigChange'][] | null;
}

/**
 * The versions of the entity set the window holds and the project day each first derived an answer (c8 C-21). Version
 * 1 starts on `first`, the project's first answer day (it can precede the window); each boundary day after it starts
 * the next version, one version for a day. A version belongs to the window when it was in force on one of its days.
 * No version when nothing was ever answered.
 */
export function entityConfigOf(input: {
  window: Pick<MetricWindow, 'from' | 'to'>;
  first: string | null;
  boundaries: readonly string[];
}): EntityConfig {
  const first = input.first;
  if (first === null) return { versions: [], changes: null };
  const days = [...new Set(input.boundaries.filter((day) => day > first))].sort();
  const all = [first, ...days].map((from, place) => ({ version: place + 1, from }));
  const inWindow = all.filter((entry, place) => {
    const next = all[place + 1];
    return entry.from <= input.window.to && (next === undefined || next.from > input.window.from);
  });
  return {
    versions: inWindow.map((entry) => entry.version),
    changes: inWindow.length > 1 ? inWindow : null,
  };
}

// The rows

export interface CompetitorsInput {
  summary: PromptsSummary;
  basis: Basis;
  /** The entity reference of each tracked entity of the summary. */
  refs: ReadonlyMap<string, EntityRef>;
  /** The answers of the scope, valid or not. */
  answers: readonly CitedAnswer[];
  prompts: LostInput['prompts'];
  /** `null` for every tracked entity. */
  entityIds: ReadonlySet<string> | null;
  /** `lost_limit` with `include=lost_prompts`, else `null`. */
  lost: number | null;
  /** `sources_limit` with `include=top_sources`, else `null`. */
  sources: number | null;
}

/** The tracked set of the summary in the order of its rows: the own entities first, then the competitors, at most 20. */
export const rowIdsOf = (entities: readonly SummaryEntity[]): string[] => cellEntityIds(entities);

/** The engine rows of the summary's total row: the figures every competitor read relabels. */
function totalEngines(summary: PromptsSummary): NonNullable<PromptsSummary['total']>['engines'] {
  if (summary.total == null) throw new Error('The competitors read needs the summary with include=total');
  return summary.total.engines;
}

function cellsOf(summary: PromptsSummary, engine: string, entityId: string): EntityCells {
  const cells = totalEngines(summary)
    .find((candidate) => candidate.engine_code === engine)
    ?.entities?.find((candidate) => candidate.entity_id === entityId);
  if (cells === undefined) throw new Error(`The summary has no cells of ${entityId} on ${engine}`);
  return cells;
}

const refOf = (refs: ReadonlyMap<string, EntityRef>, entityId: string): EntityRef => {
  const ref = refs.get(entityId);
  if (ref === undefined) throw new Error(`No entity reference for ${entityId}`);
  return ref;
};

/** `meta` of a competitors read: the summary's scope, and the entity configuration this read derives itself. */
export function metaOf(summary: PromptsSummary, config: EntityConfig): Schemas['AiMetricMeta'] {
  return {
    window: summary.window,
    include_branded: summary.include_branded,
    branded_only: summary.branded_only,
    engine_codes: [...summary.engine_codes],
    entities: summary.entities,
    entity_config_versions: config.versions,
    ...(config.changes === null ? {} : { entity_config_changes: config.changes }),
    notes: [],
    ...(summary.compare_window == null ? {} : { compare_window: summary.compare_window }),
    ...(summary.previous_answers == null ? {} : { previous_answers: summary.previous_answers }),
  };
}

/** The rows of `ai/competitors`. */
export function competitorRows(input: CompetitorsInput): Schemas['AiCompetitor'][] {
  const { summary, basis } = input;
  const ids = rowIdsOf(summary.entities);
  const own = new Set(summary.entities.filter((entity) => entity.role === 'own').map((entity) => entity.entity_id));
  const nameOf = new Map(summary.entities.map((entity) => [entity.entity_id, entity.name]));
  const engines = summary.engine_codes.map(engineOf);
  const units = new Map(engines.map((engine) => [engine, unitsOfEngine(input.answers, engine)]));
  // The top flag is read over the whole tracked set, before `entity_ids` narrows the rows
  const top = new Map(
    engines.map((engine) => [
      engine,
      topCompetitorId(
        ids
          .filter((id) => !own.has(id))
          .map((id) => {
            const cells = cellsOf(summary, engine, id);
            return {
              entity_id: id,
              name: nameOf.get(id) ?? '',
              sov: cells.share_of_voice.numerator,
              mention: cells.mentioned.numerator,
            };
          }),
      ),
    ]),
  );
  const lostInput =
    input.lost === null ? null : { answers: input.answers, prompts: input.prompts, ownIds: own, limit: input.lost };
  return ids
    .filter((id) => input.entityIds === null || input.entityIds.has(id))
    .map((id) => ({
      entity: refOf(input.refs, id),
      by_engine: engines.map((engine): Schemas['AiCompetitorEngine'] => {
        const cells = cellsOf(summary, engine, id);
        const engineUnits = units.get(engine) ?? { all: 0, byEntity: new Map<string, number>(), valid: 0 };
        const lost = !own.has(id) && lostInput !== null ? lostPromptsOf(id, engine, lostInput) : null;
        return {
          engine_code: engine,
          mention_rate: mentionValue(basis, engine, id, cells),
          recommendation_rate: recommendationValue(basis, engine, id, engineUnits.valid),
          citation_share: citationValue(basis, engine, id, engineUnits),
          share_of_voice: shareValue(basis, engine, id, cells),
          is_top_competitor: top.get(engine) === id,
          ...(lost === null
            ? {}
            : {
                lost_prompts: lost.prompts,
                lost_prompts_total: lost.total,
                lost_prompts_with_min_answers: lost.withMinAnswers,
                lost_prompts_clear_total: lost.clearTotal,
              }),
        };
      }),
      ...(input.sources === null ? {} : { top_sources: topSourcesOf(id, input.answers, input.sources) }),
    }));
}

/** The rows of `overview/competitors`: the AI half, the same values as `ai/competitors`. */
export function overviewRows(
  summary: PromptsSummary,
  basis: Basis,
  refs: ReadonlyMap<string, EntityRef>,
): Schemas['OverviewCompetitorRow'][] {
  const engines = summary.engine_codes.map(engineOf);
  return rowIdsOf(summary.entities).map((id) => ({
    entity: refOf(refs, id),
    ai: engines.map((engine) => {
      const cells = cellsOf(summary, engine, id);
      return {
        engine_code: engine,
        share_of_voice: shareValue(basis, engine, id, cells),
        mention_rate: mentionValue(basis, engine, id, cells),
      };
    }),
  }));
}

// The series

export type SeriesMetric = 'ai.share_of_voice' | 'ai.mention_rate';

const SERIES_METRICS: readonly string[] = ['ai.share_of_voice', 'ai.mention_rate'];
export const isSeriesMetric = (key: string): key is SeriesMetric => SERIES_METRICS.includes(key);

/**
 * One weekly point of an entity: the cells of its entry in the week's `entities` (which the summary pools as the week
 * is), the prompts that answered in the week itself, and whether the week is cut by a window bound or holds `today`.
 */
export function pointOf(
  week: WeekCells,
  entityId: string,
  metric: SeriesMetric,
  range: Pick<MetricWindow, 'from' | 'to'>,
  today: string,
): Schemas['AiMetricPoint'] {
  const cells = week.entities?.find((candidate) => candidate.entity_id === entityId);
  if (cells === undefined) throw new Error(`The week of ${week.week_start} has no cells of ${entityId}`);
  const cell = metric === 'ai.share_of_voice' ? cells.share_of_voice : cells.mentioned;
  const sunday = shiftIsoDate(week.week_start, 6);
  return {
    t: week.week_start,
    value: cell.value,
    numerator: cell.numerator,
    denominator: cell.denominator,
    n_observations: cell.n_observations,
    n_prompts: week.prompts,
    is_partial: week.week_start < range.from || sunday > range.to || (week.week_start <= today && today <= sunday),
    is_pooled: week.is_pooled,
    ...(week.pool == null ? {} : { pool: week.pool }),
    ...(metric === 'ai.mention_rate' && cell.pooled != null ? { pooled: cell.pooled } : {}),
  };
}

/** One series per engine, and within an engine one per listed entity in the summary's cell order (own first). */
export function seriesOf(
  summary: PromptsSummary,
  basis: Basis,
  metric: SeriesMetric,
  listed: ReadonlySet<string>,
  today: string,
): Schemas['AiMetricSeries'][] {
  const share = metric === 'ai.share_of_voice';
  const ids = rowIdsOf(summary.entities).filter((id) => listed.has(id));
  return summary.engine_codes.flatMap((code) => {
    const weeks = totalEngines(summary).find((candidate) => candidate.engine_code === code)?.series;
    if (weeks == null) throw new Error(`The summary has no series on ${code}; ask it for include=series`);
    return ids.map((id): Schemas['AiMetricSeries'] => ({
      metric,
      unit: 'ratio',
      aggregation: share ? 'observation_weighted' : 'prompt_weighted',
      engine_code: code,
      entity_id: id,
      window: basis.window,
      filters: basis.filters,
      is_estimate: false,
      method: share ? SOV_METHOD : MENTION_METHOD,
      method_version: 1,
      granularity: 'week',
      points: weeks.map((week) => pointOf(week, id, metric, basis.window, today)),
    }));
  });
}
