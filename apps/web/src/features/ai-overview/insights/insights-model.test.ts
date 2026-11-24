import { describe, expect, it } from 'vitest';

import { citingCompetitorsCount, insightWindows, normalizeText, openLines, untrackedCount } from './insights-model';

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

  it('is a floor when the keywords were cut, and unknown when the prompts were', () => {
    expect(untrackedCount(['a'], [], { moreKeywords: true, morePrompts: false })).toEqual({ count: 1, atLeast: true });
    expect(untrackedCount(['a'], [], { moreKeywords: false, morePrompts: true })).toBeNull();
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
