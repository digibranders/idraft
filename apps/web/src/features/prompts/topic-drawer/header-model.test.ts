import { describe, expect, it } from 'vitest';

import { scopeParts } from './header-model';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells.test-fixtures';

describe('scopeParts', () => {
  const two = [projectEngine('chatgpt_web'), projectEngine('gemini_web')];

  it('says the scope as engines, country and branded choice', () => {
    expect(scopeParts({ engines: two, country: 'DE', includeBranded: false })).toEqual({
      engines: 2,
      country: 'DE',
      branded: false,
      brandedOnly: false,
    });
    expect(scopeParts({ engines: two, country: null, includeBranded: true })).toEqual({
      engines: 2,
      country: null,
      branded: true,
      brandedOnly: false,
    });
    expect(scopeParts({ engines: two, country: null, includeBranded: true, brandedOnly: true })).toMatchObject({
      branded: true,
      brandedOnly: true,
    });
  });

  it('names a single engine instead of counting it', () => {
    expect(scopeParts({ engines: [projectEngine('gemini_web')], country: null, includeBranded: false }).engines).toBe(
      'Gemini',
    );
  });
});
