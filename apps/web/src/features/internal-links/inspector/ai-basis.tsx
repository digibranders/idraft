'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { formatBusinessDate } from '@/lib/format';
import type { PageAi } from '@/lib/internal-links/types';

/** Printed dates for the AI tab cards, and optional compared period dates. */
export function AiPeriod({ ai }: { ai: PageAi }): ReactElement {
  const t = useTranslations('pages.drawer.ai.basis');
  return (
    <p className="type-meta text-foreground-tertiary">
      <span>{t('period', { start: formatBusinessDate(ai.window.from), end: formatBusinessDate(ai.window.to) })}</span>
      {ai.compare_window === null ? null : (
        <span>
          {` · ${t('compared', { start: formatBusinessDate(ai.compare_window.from), end: formatBusinessDate(ai.compare_window.to) })}`}
        </span>
      )}
    </p>
  );
}

/** Counting basis note explaining why the cards and the strip can differ. */
export function AiBasisNote(): ReactElement {
  const t = useTranslations('pages.drawer.ai.basis');
  return <p className="type-meta text-foreground-tertiary">{t('note')}</p>;
}
