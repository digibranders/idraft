import { UNREAD, type TrackedEntity, type TrackedSet, type Unread } from './types';
import { hasEntities } from './entity-totals';
import type { PromptsSummary } from '@/lib/api/types';
import { rateState } from '@/lib/stats';

/**
 * Who leads each prompt, for the Competitor gap card (the competitor drawer reads the same counts, R12).
 *
 * The rule of the design preview is "a brand leads a prompt when it is mentioned in at least 2 more answers than the
 * other, over the platforms in scope, and the prompt has at least 4 valid answers". Pooling the answers of several
 * platforms to count them breaks R3, so the real rule is decided per platform and combined without pooling:
 *
 * - On one platform the preview's rule applies as it is: a prompt needs 4 valid answers on it, `LEAD_MARGIN` more
 *   answers that mention one brand than the other decide the lead, a smaller difference is "close".
 * - A platform where the prompt has fewer than 4 valid answers says nothing. A prompt with none such platform is not
 *   compared.
 * - On several platforms a brand leads the prompt when it leads on at least one comparable platform and the other
 *   brand leads on none. Leads on both sides, or none, make the prompt "close".
 *
 * Each prompt is counted once, whatever the number of platforms, so with one platform in scope the result equals the
 * preview's. This is an open point for the owner (OV-OPEN, the review of 2026-11-16).
 */
export const LEAD_MARGIN = 2;

export type Lead = 'they' | 'you' | 'close';

/** One prompt compared with one competitor. */
export interface PromptLead {
  promptId: string;
  text: string;
  lead: Lead;
  /** The answers that mention you and the competitor, added over the platforms that could be compared. */
  own: number;
  rival: number;
}

export interface CompetitorLead {
  entity: TrackedEntity;
  they: number;
  you: number;
  close: number;
  /** The prompts that could be compared: with at least 4 valid answers on a platform in scope. */
  compared: number;
  prompts: PromptLead[];
}

export interface LeadResult {
  status: 'read';
  /** The prompts with answers on the platforms in scope but too few on each to be compared. */
  tooFew: number;
  competitors: CompetitorLead[];
}

export type LeadRead = LeadResult | Unread;

const leadOn = (own: number, rival: number): Lead =>
  rival - own >= LEAD_MARGIN ? 'they' : own - rival >= LEAD_MARGIN ? 'you' : 'close';

export function leadsOf(summary: PromptsSummary, codes: readonly string[], set: TrackedSet): LeadRead {
  const competitors = set.entities.filter((entity) => entity.role === 'competitor');
  const rows = summary.prompts.map((prompt) => ({
    prompt,
    entries: prompt.engines.filter((entry) => codes.includes(entry.engine_code) && hasEntities(entry)),
  }));
  if (rows.every(({ entries }) => entries.length === 0)) return UNREAD;
  let tooFew = 0;
  const result: CompetitorLead[] = competitors.map((entity) => ({
    entity,
    they: 0,
    you: 0,
    close: 0,
    compared: 0,
    prompts: [],
  }));
  for (const { prompt, entries } of rows) {
    const comparable = entries.filter((entry) => rateState(entry.mentioned.denominator) === 'ok');
    if (comparable.length === 0) {
      if (entries.some((entry) => entry.mentioned.denominator > 0)) tooFew += 1;
      continue;
    }
    for (const lead of result) {
      const sides = comparable.map((entry) => {
        const rival =
          entry.entities?.find((cell) => cell.entity_id === lead.entity.entityId)?.mentioned.numerator ?? 0;
        return { own: entry.mentioned.numerator, rival };
      });
      const leads = sides.map((side) => leadOn(side.own, side.rival));
      const theyLead = leads.includes('they');
      const youLead = leads.includes('you');
      const kind: Lead = theyLead && !youLead ? 'they' : youLead && !theyLead ? 'you' : 'close';
      lead.compared += 1;
      lead[kind] += 1;
      lead.prompts.push({
        promptId: prompt.prompt_id,
        text: prompt.text,
        lead: kind,
        own: sides.reduce((total, side) => total + side.own, 0),
        rival: sides.reduce((total, side) => total + side.rival, 0),
      });
    }
  }
  return { status: 'read', tooFew, competitors: result };
}
