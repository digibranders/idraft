import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { cardMeta, type MetaInput, type MetaWords } from './card-meta';
import messages from '../../../../../messages/en.json';

const t = createTranslator({ locale: 'en', messages, namespace: 'aiOverview.engines.common' });
const words: MetaWords = (key, values) => t(key, values);

const INPUT: MetaInput = {
  range: { from: '2026-10-16', to: '2026-11-12' },
  prompts: 250,
  answers: 1800,
  branded: 'excluded',
};
// Built from code points, so this file does not contain the characters it looks for: figure dash, en-dash, em-dash, bar
const DASHES = new RegExp(`[${String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015)}]| - `);

describe('cardMeta', () => {
  it('meta is window, prompts, answers and the branded choice', () => {
    expect(cardMeta(INPUT, words)).toBe(
      'Oct 16 to Nov 12, 2026 · 250 prompts, 1,800 valid answers · branded prompts left out',
    );
  });

  it('branded excluded says branded prompts are left out, and the other two choices say theirs', () => {
    expect(cardMeta(INPUT, words)).toContain('branded prompts left out');
    expect(cardMeta({ ...INPUT, branded: 'included' }, words)).toContain('branded prompts included');
    expect(cardMeta({ ...INPUT, branded: 'only' }, words)).toContain('branded prompts only');
  });

  it('a prompt weighted figure says each prompt counts once', () => {
    expect(cardMeta({ ...INPUT, promptWeighted: true }, words)).toContain('each prompt counts once');
    expect(cardMeta(INPUT, words)).not.toContain('each prompt counts once');
  });

  it('leaves out what is not known, never writing 0 for it, and says 1 prompt in the singular', () => {
    expect(cardMeta({ ...INPUT, prompts: null, answers: null }, words)).toBe(
      'Oct 16 to Nov 12, 2026 · branded prompts left out',
    );
    expect(cardMeta({ ...INPUT, prompts: 1, answers: null }, words)).toBe(
      'Oct 16 to Nov 12, 2026 · 1 prompt · branded prompts left out',
    );
  });

  it('writes at most two middle dots, as the design system allows', () => {
    const line = cardMeta({ ...INPUT, promptWeighted: true }, words);
    expect(line.split('·')).toHaveLength(3);
  });

  it('no string contains a dash', () => {
    for (const branded of ['excluded', 'included', 'only'] as const) {
      expect(cardMeta({ ...INPUT, branded, promptWeighted: true }, words)).not.toMatch(DASHES);
    }
  });
});
