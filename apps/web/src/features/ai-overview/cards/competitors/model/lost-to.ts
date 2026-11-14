import { engineRows, hasEntities } from './entity-totals';
import {
  UNREAD,
  type LostToRead,
  type LostToRow,
  type OpportunityKind,
  type OpportunityRead,
  type OpportunityRow,
  type TrackedEntity,
  type TrackedSet,
} from './types';
import type { EngineSummary, PromptsSummary } from '@/lib/api/types';
import { rateState } from '@/lib/stats';

/**
 * "Lost to a competitor" and the opportunity counts (WP-35 decisions D-3 and D-6). They read the prompt rows
 * (request shape `prompt-rows`): a prompt row carries cells, not per answer facts, so the rule is the prompt level
 * one of CH-05, not the per answer one of the server's `filter[opportunity]`; a drill count can be larger.
 */

const competitorsOf = (set: TrackedSet): TrackedEntity[] =>
  set.entities.filter((entity) => entity.role === 'competitor');

/** The valid answers of an engine entry of a prompt row: its Mentioned denominator. */
const validAnswers = (entry: EngineSummary): number => entry.mentioned.denominator;

/**
 * The competitors a prompt is lost to on one engine: named in at least one valid answer, while the own brand is
 * named in none, and the prompt has 4 or more valid answers (fewer is too thin to say it).
 */
function lostCompetitors(entry: EngineSummary, competitors: readonly TrackedEntity[]): string[] {
  if (rateState(validAnswers(entry)) !== 'ok' || entry.mentioned.numerator > 0 || !hasEntities(entry)) return [];
  return competitors
    .filter((competitor) =>
      entry.entities.some((cell) => cell.entity_id === competitor.entityId && cell.mentioned.numerator >= 1),
    )
    .map((competitor) => competitor.entityId);
}

/**
 * One row per competitor with the prompts it takes from the own brand on one engine. A prompt with 1 to 3 valid
 * answers is counted as too few and is never lost; one with none is out of scope. Sorted by prompts, then name;
 * a competitor with no lost prompt has no row. `unread` when no prompt row lists the engine with entity cells.
 */
export function lostToRows(summary: PromptsSummary, engineCode: string, set: TrackedSet): LostToRead {
  const entries = engineRows(summary, engineCode).filter(hasEntities);
  if (entries.length === 0) return UNREAD;
  const competitors = competitorsOf(set);
  const lost = new Map<string, number>();
  let enough = 0;
  let tooFew = 0;
  for (const entry of entries) {
    const answers = validAnswers(entry);
    if (answers === 0) continue;
    if (rateState(answers) === 'ok') enough += 1;
    else tooFew += 1;
    for (const entityId of lostCompetitors(entry, competitors)) lost.set(entityId, (lost.get(entityId) ?? 0) + 1);
  }
  const rows: LostToRow[] = competitors
    .flatMap((competitor) => {
      const prompts = lost.get(competitor.entityId) ?? 0;
      return prompts === 0 ? [] : [{ entityId: competitor.entityId, name: competitor.name, prompts }];
    })
    .sort((a, b) => b.prompts - a.prompts || a.name.localeCompare(b.name));
  return { status: 'read', engineCode, promptsWithEnoughAnswers: enough, promptsWithTooFewAnswers: tooFew, rows };
}

/** The fixed order of the conditions, for rows with the same count. */
const KIND_ORDER: readonly OpportunityKind[] = ['named_not_cited', 'cited_not_named', 'lost_to', 'nobody_named'];

/**
 * The opportunity rows over the engines in scope (c2 C-6): each counts the prompts, once however many engines or
 * competitors qualify, with at least one valid answer on those engines. `named_not_cited` and `cited_not_named`
 * read the outcome cells; `nobody_named` is a prompt with more valid answers than answers naming a tracked brand;
 * `lost_to` is the prompt level rule above, one row per competitor with at least one prompt. The three fixed
 * conditions stay at 0 (a real zero of a known total). `unread` when no prompt row lists an engine in scope.
 */
export function opportunityRows(
  summary: PromptsSummary,
  engineCodes: readonly string[],
  set: TrackedSet,
): OpportunityRead {
  const competitors = competitorsOf(set);
  const counts = { named_not_cited: 0, cited_not_named: 0, nobody_named: 0 };
  const lost = new Map<string, number>();
  let listed = false;
  let promptsInScope = 0;
  for (const prompt of summary.prompts) {
    const entries = prompt.engines.filter((entry) => engineCodes.includes(entry.engine_code));
    if (entries.length > 0) listed = true;
    const valid = entries.filter((entry) => validAnswers(entry) >= 1);
    if (valid.length === 0) continue;
    promptsInScope += 1;
    if (valid.some((entry) => entry.outcomes.mentioned_only.numerator >= 1)) counts.named_not_cited += 1;
    if (valid.some((entry) => entry.outcomes.cited_only.numerator >= 1)) counts.cited_not_named += 1;
    if (valid.some((entry) => validAnswers(entry) > entry.share_of_voice.denominator)) counts.nobody_named += 1;
    const lostHere = new Set(valid.flatMap((entry) => lostCompetitors(entry, competitors)));
    for (const entityId of lostHere) lost.set(entityId, (lost.get(entityId) ?? 0) + 1);
  }
  if (!listed) return UNREAD;
  const rows: OpportunityRow[] = [
    { kind: 'named_not_cited', entityId: null, name: null, prompts: counts.named_not_cited },
    { kind: 'cited_not_named', entityId: null, name: null, prompts: counts.cited_not_named },
    { kind: 'nobody_named', entityId: null, name: null, prompts: counts.nobody_named },
    ...competitors.flatMap((competitor): OpportunityRow[] => {
      const prompts = lost.get(competitor.entityId) ?? 0;
      return prompts === 0 ? [] : [{ kind: 'lost_to', entityId: competitor.entityId, name: competitor.name, prompts }];
    }),
  ];
  rows.sort(
    (a, b) =>
      b.prompts - a.prompts ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (a.name ?? '').localeCompare(b.name ?? ''),
  );
  return { status: 'read', promptsInScope, rows };
}
