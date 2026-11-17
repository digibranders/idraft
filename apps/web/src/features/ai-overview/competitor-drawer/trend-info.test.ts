import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import messages from '../../../../messages/en.json';

const t = createTranslator({ locale: 'en', messages, namespace: 'aiOverview.competitorDrawer' });

describe('the info text of the competitor trend', () => {
  it('says what the glossary says for 28 days, Compare on and 8 weeks', () => {
    expect(t('trend.info.how', { days: 28, weeks: 8, compare: 'true' })).toBe(
      'One point for each weekly run. The 8 weeks are the previous 28 days and the current 28 days.',
    );
  });

  it('names only the current period when Compare is off', () => {
    expect(t('trend.info.how', { days: 28, weeks: 4, compare: 'false' })).toBe(
      'One point for each weekly run. The weeks are the current 28 days.',
    );
  });

  it('does not print a count of weeks before the weeks are read', () => {
    expect(t('trend.info.how', { days: 28, weeks: 0, compare: 'true' })).toBe(
      'One point for each weekly run. The weeks are the previous 28 days and the current 28 days.',
    );
  });
});
