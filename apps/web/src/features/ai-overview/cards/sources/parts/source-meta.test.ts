import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { engineNames, footnoteLines, metaLine } from './source-meta';
import messages from '../../../../../../messages/en.json';
import type { Say } from '../../../numbers/number-model';
import { sourcesMeta } from '../model/source-fixtures';
import { formatList } from '@/lib/format';

const translate = createTranslator({ locale: 'en', messages, namespace: 'aiOverview.sources.common' });
const say: Say = (key, values) => translate(key as never, values as never);
// Built from code points, so this file does not contain the characters it looks for: figure dash, en-dash, em-dash, bar
const DASHES = new RegExp(`[${String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015)}]| - `);

describe('engineNames', () => {
  it('names the engines in the order of the catalog, whatever order the read had them in', () => {
    expect(engineNames(['google_ai_mode', 'chatgpt_web'])).toEqual(['ChatGPT', 'AI Mode']);
  });
});

describe('metaLine', () => {
  it('is the window, the citation units in the answers, the engines named and the branded choice', () => {
    const line = metaLine(sourcesMeta({ units: 18420, answers: 6210, engines: ['chatgpt_web', 'gemini_web'] }), say);
    expect(line).toBe(
      `Oct 16 to Nov 12, 2026, 18,420 citation units in 6,210 answers, ${formatList(['ChatGPT', 'Gemini'])}, branded prompts left out`,
    );
  });

  it('says branded prompts are included when the read counted them', () => {
    expect(metaLine(sourcesMeta({ includeBranded: true }), say)).toContain('branded prompts included');
  });

  it('uses the singular for one unit in one answer', () => {
    expect(metaLine(sourcesMeta({ units: 1, answers: 1 }), say)).toContain('1 citation unit in 1 answer,');
  });
});

describe('footnoteLines', () => {
  it('says the units are pooled over the engines named, which flagged citations are left out and the minimum', () => {
    const lines = footnoteLines(sourcesMeta({ engines: ['chatgpt_web', 'gemini_web'] }), say, 2);
    expect(lines).toEqual([
      `Citation units are pooled over ${formatList(['ChatGPT', 'Gemini'])}. The split by engine is in the tooltip of each row and in the Table view.`,
      'Citations flagged as unresolved redirects or engine-internal links are left out.',
      'Domains with fewer than 2 citation units are not listed.',
    ]);
  });

  it('has no dash in any line', () => {
    for (const line of [metaLine(sourcesMeta(), say), ...footnoteLines(sourcesMeta(), say, 2)]) {
      expect(DASHES.test(line)).toBe(false);
      // eslint-disable-next-line no-control-regex -- the test is for characters beyond ASCII
      expect(/[^\x00-\x7F]/.test(line)).toBe(false);
    }
  });
});
