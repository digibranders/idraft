import { describe, expect, it } from 'vitest';

import {
  formatKeySet,
  formatMore,
  MAX_ADDRESS_KEYS,
  MAX_ADDRESS_LENGTH,
  parseKeySet,
  parseMore,
} from './journey-codec';

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

  it('keeps a written address short, leaving out the deepest keys first', () => {
    const deep = `o:${Array.from({ length: 12 }, () => '9223372036854775807').join('.')}`;
    const keys = new Set(['o:1', ...Array.from({ length: 40 }, (_, index) => `${deep}${String(index)}`), 'o:2']);
    const written = formatKeySet(keys) ?? '';
    expect(written.length).toBeLessThanOrEqual(MAX_ADDRESS_LENGTH);
    expect(written.startsWith('o:1,')).toBe(true);
    expect(written.split(',')).toContain('o:2');
    expect(written.split(',').length).toBeLessThan(keys.size);
    expect(formatMore(new Map([[deep, 3]]))?.length).toBeLessThanOrEqual(MAX_ADDRESS_LENGTH);
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
