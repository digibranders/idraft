'use client';

import { useTranslations } from 'next-intl';

/**
 * The two hints every `MultiSelect` gives assistive technology, in one wording for every field of chips (10-forms.md
 * section 6.4): how to reach the chosen values, and how to remove a focused one. The field's `chipsLabel` names
 * what the values are, so the hints do not repeat it. Spread them into the field: `<MultiSelect {...hints} />`.
 */
export function useMultiSelectHints(): { chipsHint: (count: number) => string; chipHint: string } {
  const t = useTranslations('common.multiSelect');
  return { chipsHint: (count) => t('chipsHint', { count }), chipHint: t('chipHint') };
}
