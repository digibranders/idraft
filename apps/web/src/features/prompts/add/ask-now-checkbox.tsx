'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { AskNowState } from './add-model';
import { askCostText } from './plan-block';
import { Checkbox } from '@/components/ui/checkbox';
import { formatInteger } from '@/lib/format';

export interface AskNowCheckboxProps {
  ask: AskNowState;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Why asking is off; the plan block says it in words, and the box points at that block. */
  reason: string | null;
  /** The plan block's id. */
  blockId: string;
}

/** "Ask them now as well": the add is followed by one manual run for each 150 prompts, with its cost in the label. */
export function AskNowCheckbox({ ask, checked, onCheckedChange, reason, blockId }: AskNowCheckboxProps): ReactElement {
  const t = useTranslations('prompts.add');
  const plan = useTranslations('prompts.add.plan');
  const locale = useLocale();
  const cost = askCostText(ask, plan, locale);
  const label =
    ask.used === null || ask.limit === null
      ? t('askNowCheckedNoDay', { cost })
      : t('askNowChecked', {
          runs: ask.runs,
          limit: formatInteger(ask.limit),
          used: formatInteger(ask.used),
          cost,
        });
  return (
    <Checkbox
      checked={checked && reason === null}
      disabled={reason !== null}
      onCheckedChange={onCheckedChange}
      label={label}
      {...(reason === null ? {} : { 'aria-describedby': blockId })}
    />
  );
}
