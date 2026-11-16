import type { CompetitorLead, LeadRead } from '../../cards/competitors/model/lead-rule';

/**
 * The competitors in the order of the Competitor gap card: those that lead on most prompts first, then by name. A
 * competitor with no prompt that could be compared is not in the card, so it is not stepped to (OV-DRW-05).
 */
export function competitorOrder(read: LeadRead | null): CompetitorLead[] {
  if (read === null || read.status !== 'read') return [];
  return read.competitors
    .filter((lead) => lead.compared > 0)
    .sort((a, b) => b.they - a.they || a.entity.name.localeCompare(b.entity.name));
}
