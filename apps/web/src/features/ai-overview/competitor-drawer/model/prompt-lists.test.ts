import { describe, expect, it } from 'vitest';

import { freshView, promptList, SHOWN, type PromptGroup } from './prompt-lists';
import type { CompetitorLead, Lead, PromptLead } from '../../cards/competitors/model/lead-rule';

const HUBSPOT = { entityId: 'e2', name: 'HubSpot', role: 'competitor' as const, colorIndex: 2, addedAt: null };

function prompt(n: number, lead: Lead, own: number, rival: number, answers = 8): PromptLead {
  return {
    promptId: `p${String(n)}`,
    text: `Prompt ${String(n)}`,
    lead,
    own,
    rival,
    answers,
    absent: rival > 0 && own === 0,
  };
}

function leadOf(prompts: PromptLead[]): CompetitorLead {
  const count = (kind: Lead): number => prompts.filter((entry) => entry.lead === kind).length;
  return {
    entity: HUBSPOT,
    they: count('they'),
    you: count('you'),
    close: count('close'),
    compared: prompts.length,
    prompts,
  };
}

const PRICING: PromptGroup = { key: 'g1', name: 'Pricing' };
const ONBOARDING: PromptGroup = { key: 'g2', name: 'Onboarding' };
const GROUPS = new Map<string, readonly PromptGroup[]>([
  ['p1', [PRICING]],
  ['p2', [PRICING]],
  ['p3', [ONBOARDING]],
  ['p4', [ONBOARDING, PRICING]],
]);

const LEAD = leadOf([
  prompt(1, 'they', 0, 6),
  prompt(2, 'they', 2, 6),
  prompt(3, 'they', 1, 3),
  prompt(4, 'you', 6, 1),
  prompt(5, 'close', 3, 4),
]);

describe('promptList', () => {
  it('counts the three kinds and lists the chosen one, the largest difference first', () => {
    const list = promptList(LEAD, freshView(), GROUPS, true);
    expect(list.counts).toEqual({ they: 3, you: 1, close: 1 });
    expect(list.rows.map((row) => row.promptId)).toEqual(['p1', 'p2', 'p3']);
    expect(list.total).toBe(3);
  });

  it('sorts the equal ones by answers, the most first', () => {
    const lead = leadOf([prompt(1, 'close', 3, 4, 8), prompt(2, 'close', 3, 3, 12)]);
    expect(promptList(lead, freshView('close'), GROUPS, true).rows.map((row) => row.promptId)).toEqual(['p2', 'p1']);
  });

  it('narrows to the prompts where you are absent, and offers the chip only under They lead', () => {
    const narrowed = promptList(LEAD, { lead: 'they', absent: true, group: null }, GROUPS, true);
    expect(narrowed.absentCount).toBe(1);
    expect(narrowed.rows.map((row) => row.promptId)).toEqual(['p1']);
    expect(promptList(LEAD, { lead: 'you', absent: true, group: null }, GROUPS, true).absentCount).toBe(0);
    // The narrowing that no longer applies is dropped, so the list is never empty behind a hidden chip
    expect(promptList(LEAD, { lead: 'you', absent: true, group: null }, GROUPS, true).view.absent).toBe(false);
  });

  it('lists the groups by prompts, a prompt in two groups counting in both, and narrows to one', () => {
    const list = promptList(LEAD, freshView(), GROUPS, true);
    expect(list.groups).toEqual([
      { ...PRICING, count: 2 },
      { ...ONBOARDING, count: 1 },
    ]);
    const narrowed = promptList(LEAD, { lead: 'they', absent: false, group: 'g2' }, GROUPS, true);
    expect(narrowed.rows.map((row) => row.promptId)).toEqual(['p3']);
    expect(narrowed.total).toBe(1);
  });

  it('has no strip and no narrowing when the page is one group, and drops a group the list no longer holds', () => {
    const one = promptList(LEAD, { lead: 'they', absent: false, group: 'g1' }, GROUPS, false);
    expect(one.groups).toEqual([]);
    expect(one.view.group).toBeNull();
    expect(promptList(LEAD, { lead: 'you', absent: false, group: 'g9' }, GROUPS, true).view.group).toBeNull();
  });

  it('gives a row its first group as the badge and shows ten at most, keeping the total', () => {
    const many = leadOf(Array.from({ length: 12 }, (_, index) => prompt(index + 10, 'they', 0, 4 + index)));
    const list = promptList(many, freshView(), new Map(), true);
    expect(list.rows).toHaveLength(SHOWN);
    expect(list.total).toBe(12);
    expect(promptList(LEAD, freshView(), GROUPS, true).rows[0]?.groupName).toBe('Pricing');
    expect(promptList(LEAD, freshView(), new Map(), true).rows[0]?.groupName).toBeNull();
  });
});
