import { describe, expect, it } from 'vitest';

import {
  citingCompetitorRows,
  citingCompetitorsCount,
  insightWindows,
  isUnknown,
  normalizeText,
  openLines,
  untrackedCount,
  untrackedKeywords,
} from './insights-model';

describe('insightWindows', () => {
  it('reads the month from its first day and the recent window as 28 days ending today', () => {
    const { month, recent } = insightWindows('2026-11-24');
    expect(month).toEqual({ from: '2026-11-01', to: '2026-11-24' });
    expect(recent).toEqual({ from: '2026-10-28', to: '2026-11-24' });
  });
});

describe('normalizeText', () => {
  it('ignores case, extra spaces and a closing question mark', () => {
    expect(normalizeText('  Best  CRM for startups ? ')).toBe('best crm for startups');
  });
});

describe('untrackedCount', () => {
  const none = { moreKeywords: false, morePrompts: false };

  it('counts the keywords no prompt has as its text, once each', () => {
    const keywords = ['best crm', 'Best CRM', 'crm pricing', 'crm demo'];
    const prompts = ['What is CRM pricing?'];
    expect(untrackedCount(keywords, ['crm pricing?', ...prompts], none)).toEqual({ count: 2, atLeast: false });
  });

  it('is a floor when the keywords were cut, and a floor of 0 (unknown) when the prompts were', () => {
    expect(untrackedCount(['a'], [], { moreKeywords: true, morePrompts: false })).toEqual({ count: 1, atLeast: true });
    expect(untrackedCount(['a'], [], { moreKeywords: false, morePrompts: true })).toEqual({ count: 0, atLeast: true });
  });
});

describe('citingCompetitorsCount', () => {
  const competitors = new Set(['c1', 'c2']);

  it('counts the domains whose most named tracked brand is a competitor', () => {
    const rows = [{ cited_with: { entity_id: 'c1' } }, { cited_with: { entity_id: 'own' } }, { cited_with: null }, {}];
    expect(citingCompetitorsCount(rows, competitors, false)).toEqual({ count: 1, atLeast: false });
    expect(citingCompetitorsCount(rows, competitors, true).atLeast).toBe(true);
  });
});

describe('openLines', () => {
  it('keeps the lines with a count, in the box order', () => {
    expect(
      openLines({
        untracked: { count: 0 },
        gaps: { count: 2 },
        citingCompetitors: undefined,
        newDomains: { count: 1 },
      }),
    ).toEqual(['gaps', 'newDomains']);
  });
});

describe('isUnknown', () => {
  it('is true only for a floor of zero', () => {
    expect(isUnknown({ count: 0, atLeast: true })).toBe(true);
    expect(isUnknown({ count: 0, atLeast: false })).toBe(false);
    expect(isUnknown({ count: 3, atLeast: true })).toBe(false);
    expect(isUnknown(undefined)).toBe(false);
  });
});

describe('untrackedKeywords', () => {
  const row = (text: string, volume: number | null = null) => ({ text, volume, cited: false });

  it('keeps the first of each normalized text, with its volume, and drops the keywords a prompt has', () => {
    const rows = untrackedKeywords([row('Best CRM', 90), row('best  crm', 5), row('crm pricing')], ['crm pricing?'], {
      morePrompts: false,
    });
    expect(rows).toEqual([row('Best CRM', 90)]);
  });

  it('lists nothing when the prompts were cut, as they could hide a match', () => {
    expect(untrackedKeywords([row('a')], [], { morePrompts: true })).toEqual([]);
  });
});

describe('citingCompetitorRows', () => {
  it('keeps the domains named with a tracked competitor, in order', () => {
    const rows = [
      { id: 1, cited_with: { entity_id: 'c1' } },
      { id: 2, cited_with: null },
      { id: 3 },
      { id: 4, cited_with: { entity_id: 'x' } },
      { id: 5, cited_with: { entity_id: 'c1' } },
    ];
    expect(citingCompetitorRows(rows, new Set(['c1'])).map((r) => r.id)).toEqual([1, 5]);
  });
});
