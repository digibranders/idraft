import { describe, expect, it } from 'vitest';

import { gscNote, reasonText, type ReasonWords } from './suggestions-format';

const words: ReasonWords = {
  clicks: (count) => `${count} clicks in 28 days`,
  rank: (rank, keyword, volume) => `ranks #${rank} for '${keyword}' (${volume} searches)`,
};

describe('suggestion reasons', () => {
  it('writes a click reason with grouped digits', () => {
    expect(reasonText({ kind: 'clicks', clicks: 1810, keyword: null, rank: null, volume: null }, words)).toBe(
      '1,810 clicks in 28 days',
    );
    expect(reasonText({ kind: 'clicks', clicks: 0, keyword: null, rank: null, volume: null }, words)).toBe(
      '0 clicks in 28 days',
    );
  });

  it('writes a rank reason with the keyword and its volume', () => {
    expect(reasonText({ kind: 'rank', clicks: null, rank: 5, keyword: 'soc vs mdr', volume: 2400 }, words)).toBe(
      "ranks #5 for 'soc vs mdr' (2,400 searches)",
    );
  });

  it('gives no sentence for a reason whose numbers are missing, never a made up zero', () => {
    expect(reasonText({ kind: 'clicks', clicks: null, keyword: null, rank: null, volume: null }, words)).toBeNull();
    expect(reasonText({ kind: 'rank', clicks: null, rank: null, keyword: 'x', volume: 10 }, words)).toBeNull();
    expect(reasonText({ kind: 'rank', clicks: null, rank: 3, keyword: null, volume: 10 }, words)).toBeNull();
    expect(reasonText({ kind: 'rank', clicks: null, rank: 3, keyword: 'x', volume: null }, words)).toBeNull();
  });

  it('says whether clicks were used by the search console state', () => {
    expect(gscNote('ok')).toBe('clicks_used');
    expect(gscNote('pending')).toBe('ranks_only_pending');
    expect(gscNote('not_connected')).toBe('ranks_only_not_connected');
  });
});
