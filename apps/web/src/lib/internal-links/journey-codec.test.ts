import { describe, expect, it } from 'vitest';

import { formatKeySet, formatMore, MAX_ADDRESS_KEYS, parseKeySet, parseMore } from './journey-codec';

describe('the journey in the address (spec 7.5)', () => {
  it('reads and writes a set of keys as a comma list', () => {
    expect([...parseKeySet('o:1.2,i:3, ,o:1.2')]).toEqual(['o:1.2', 'i:3']);
    expect(formatKeySet(new Set(['o:1.2', 'i:3']))).toBe('o:1.2,i:3');
    expect(formatKeySet(new Set())).toBeNull();
    expect([...parseKeySet(null)]).toEqual([]);
  });

  it('drops keys with characters a key never has, and keeps at most 300', () => {
    expect([...parseKeySet('o:1.2,<script>,o:9')]).toEqual(['o:1.2', 'o:9']);
    const many = Array.from({ length: MAX_ADDRESS_KEYS + 5 }, (_, index) => `o:${String(index)}`).join(',');
    expect(parseKeySet(many).size).toBe(MAX_ADDRESS_KEYS);
  });

  it('reads and writes the "+N more" counts as key*count pairs', () => {
    const more = parseMore('m:o|f*2,m:i|f|t1*1,bad*0,m:x*abc');
    expect([...more]).toEqual([
      ['m:o|f', 2],
      ['m:i|f|t1', 1],
    ]);
    expect(formatMore(more)).toBe('m:o|f*2,m:i|f|t1*1');
    expect(formatMore(new Map())).toBeNull();
  });
});
