'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { ConfirmPlan } from './import-model';
import { FormAlert } from '@/components/ui/form-alert';

export interface ConfirmStepProps {
  plan: ConfirmPlan;
  /** Keywords past the plan's limit; above 0 the import cannot go on. */
  overQuota: number;
}

/** Step 4: what Confirm will do, by the choices made. Pressing it writes in the background. */
export function ConfirmStep({ plan, overQuota }: ConfirmStepProps): ReactElement {
  const t = useTranslations('rankings.import');
  const lines = [
    { id: 'create', count: plan.create, text: t('confirmCreate', { count: plan.create }) },
    { id: 'merge', count: plan.merge, text: t('confirmMerge', { count: plan.merge }) },
    { id: 'unarchive', count: plan.unarchive, text: t('confirmUnarchive', { count: plan.unarchive }) },
    { id: 'skip', count: plan.skip, text: t('confirmSkip', { count: plan.skip }) },
  ].filter((line) => line.count > 0);
  return (
    <>
      {overQuota > 0 ? <FormAlert message={t('overQuotaReason')} /> : null}
      <p className="type-body text-foreground-secondary">{t('confirmIntro')}</p>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 type-body">
        {lines.map((line) => (
          <li key={line.id}>{line.text}</li>
        ))}
      </ul>
    </>
  );
}
