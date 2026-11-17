import type { CompetitorLead, Lead, PromptLead } from '../../cards/competitors/model/lead-rule';

/**
 * The Prompts tab of the competitor drawer (OV-DRW-20 to OV-DRW-23): the prompts of one kind of lead, narrowed by the
 * "You are absent" chip and by one group, the largest difference first. The leads are the competitor gap card's own
 * (`leadsOf`), so a count in the card and the list behind it are the same prompts (R12).
 */

/** The rows the list draws before it says "Showing 10 of 23". */
export const SHOWN = 10;
/** The groups the strip lists. */
const STRIP_GROUPS = 5;

export const LEAD_KINDS: readonly Lead[] = ['they', 'you', 'close'];

/** The view a person narrowed the list to. */
export interface PromptView {
  lead: Lead;
  /** Only under `they`: the prompts where the competitor is mentioned and you never. */
  absent: boolean;
  /** A group key, or `null` for every group. */
  group: string | null;
}

export const freshView = (lead: Lead = 'they'): PromptView => ({ lead, absent: false, group: null });

/** A group a prompt belongs to. A prompt in two groups counts in both. */
export interface PromptGroup {
  key: string;
  name: string;
}

export interface GroupCount extends PromptGroup {
  count: number;
}

export interface PromptRow extends PromptLead {
  /** The first group of the prompt, for its badge; `null` for a prompt with none. */
  groupName: string | null;
  difference: number;
}

export interface PromptList {
  counts: Record<Lead, number>;
  /** The prompts the chip would narrow to; 0 hides the chip. */
  absentCount: number;
  /** Up to five groups, most prompts first; empty when the strip is not shown. */
  groups: GroupCount[];
  /** The view after the narrowings that no longer apply are dropped. */
  view: PromptView;
  rows: PromptRow[];
  /** All rows after narrowing; `rows` is the first `SHOWN`. */
  total: number;
}

/**
 * `groupsByPrompt` maps a prompt id to its groups. `groupsShown` is true when the page scope is All groups: with one
 * group chosen the strip and the narrowing are left out (the page is already one group).
 */
export function promptList(
  competitor: CompetitorLead,
  requested: PromptView,
  groupsByPrompt: ReadonlyMap<string, readonly PromptGroup[]>,
  groupsShown: boolean,
): PromptList {
  const counts: Record<Lead, number> = { they: competitor.they, you: competitor.you, close: competitor.close };
  const ofKind = competitor.prompts.filter((prompt) => prompt.lead === requested.lead);
  const absentCount = requested.lead === 'they' ? ofKind.filter((prompt) => prompt.absent).length : 0;
  // A narrowing the data no longer supports is dropped, so the list never goes empty behind a hidden control
  const absent = requested.absent && absentCount > 0;
  const narrowed = absent ? ofKind.filter((prompt) => prompt.absent) : ofKind;

  const held = new Map<string, GroupCount>();
  if (groupsShown) {
    for (const prompt of narrowed) {
      for (const group of groupsByPrompt.get(prompt.promptId) ?? []) {
        held.set(group.key, { ...group, count: (held.get(group.key)?.count ?? 0) + 1 });
      }
    }
  }
  const groups = [...held.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, STRIP_GROUPS);
  const group = groupsShown && requested.group !== null && held.has(requested.group) ? requested.group : null;

  const listed =
    group === null
      ? narrowed
      : narrowed.filter((prompt) => groupsByPrompt.get(prompt.promptId)?.some((candidate) => candidate.key === group));
  const rows = listed
    .map((prompt): PromptRow => ({
      ...prompt,
      groupName: groupsByPrompt.get(prompt.promptId)?.[0]?.name ?? null,
      difference: Math.abs(prompt.rival - prompt.own),
    }))
    .sort((a, b) =>
      requested.lead === 'close'
        ? b.answers - a.answers || a.text.localeCompare(b.text)
        : b.difference - a.difference || b.answers - a.answers || a.text.localeCompare(b.text),
    );
  return {
    counts,
    absentCount,
    groups,
    view: { lead: requested.lead, absent, group },
    rows: rows.slice(0, SHOWN),
    total: rows.length,
  };
}
