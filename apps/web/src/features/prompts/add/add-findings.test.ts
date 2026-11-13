import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { findingsOf } from './add-findings';
import { classifyLines } from './add-model';
import { promptKeyOf, readPromptLines } from '../prompt-model';
import type { EngineCode, Schemas } from '@/lib/api/types';
import messages from '../../../../messages/en.json';

const t = createTranslator({ locale: 'en', messages, namespace: 'prompts.add' });
const ENGINES = new Map<EngineCode, string>([['chatgpt_web', 'ChatGPT']]);
const BRAND = {
  entity: { canonical_name: 'Fynix' },
} as Schemas['PromptLint']['matched_aliases'][number];

const lintRow = (text: string, extra: Partial<Schemas['PromptLint']> = {}): Schemas['PromptLint'] => ({
  text,
  is_branded: false,
  matched_aliases: [],
  warnings: [],
  suggested_prompt_type: 'question',
  ...extra,
});
const branding: Schemas['LintWarning'] = {
  rule: 'contains_brand_alias',
  severity: 'warning',
  message: 'Names Fynix.',
  engine_code: null,
  span: null,
};

function findings(
  text: string,
  lint: readonly Schemas['PromptLint'][] | null,
  branded: 'auto' | 'always' | 'never' = 'auto',
  existing: readonly string[] = [],
): string[] {
  const read = readPromptLines(text);
  const lines = classifyLines({
    read,
    lint,
    existingKeys: new Set(existing.map((entry) => promptKeyOf(entry, 'en', 'DE'))),
    languageCode: 'en',
    countryIso: 'DE',
  });
  return findingsOf({ lines, lint, engineLabels: ENGINES, branded, t }).map(
    (finding) => `${finding.tone}: ${finding.text}`,
  );
}

describe('the findings under the field', () => {
  it('names a repeat, a tracked line and a line that cannot be added, errors first', () => {
    expect(findings(`Same?\nTracked?\nSame?\n${'x'.repeat(2100)}`, null, 'auto', ['Tracked?'])).toEqual([
      'error: Line 4 is longer than 2,000 characters and cannot be added.',
      'note: Line 2 is already tracked and is left out.',
      'note: Line 3 repeats line 1 and is left out.',
    ]);
  });

  it('notes a line that names the own brand, and warns when the person marked it not branded', () => {
    const row = lintRow('Is Fynix good?', { is_branded: true, matched_aliases: [BRAND], warnings: [branding] });
    expect(findings('Is Fynix good?', [row])).toEqual([
      'note: Line 1 names Fynix, so it counts as branded and stays out of the rates unless branded prompts are included.',
    ]);
    expect(findings('Is Fynix good?', [row], 'never')).toEqual([
      'warning: Line 1 names Fynix but is marked not branded. Its answers will count in the rates.',
    ]);
    expect(findings('Is Fynix good?', [row], 'always')).toHaveLength(1);
  });

  it('names a limit of an engine that is on and leaves out one that is off', () => {
    const limit = (engine: EngineCode): Schemas['LintWarning'] => ({
      rule: 'engine_limit',
      severity: 'warning',
      message: 'Too long.',
      engine_code: engine,
      span: null,
    });
    const row = lintRow('A long one?', { warnings: [limit('chatgpt_web'), limit('google_ai_mode')] });
    expect(findings('A long one?', [row])).toEqual(['warning: Line 1 is too long for ChatGPT, which skips it.']);
  });

  it('says nothing of the rules the check list words, such as the word count', () => {
    const row = lintRow('Short?', {
      warnings: [{ rule: 'word_count', severity: 'warning', message: 'Has 1 word.', engine_code: null, span: null }],
    });
    expect(findings('Short?', [row])).toEqual([]);
  });
});
