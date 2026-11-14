'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { SectionFrame } from './section-frame';
import { TrackedSetGate } from '../tabs/tracked-set-gate';

/**
 * The Comparison tab (plan section 3.5). T2 holds the frame: the tracked set's states and the four titled sections in
 * their order, which the tasks after it fill (top competitor and channel summary: T3; by topic: T4; prompts we lose:
 * T5). Each reads what it needs through `useCompetitors().reads`.
 */
export function ComparisonTab(): ReactElement {
  const t = useTranslations('competitors.sections');
  return (
    <div data-slot="comparison-tab" className="flex flex-col gap-5">
      <TrackedSetGate>
        <SectionFrame title={t('top')} />
        <SectionFrame title={t('summary')} />
        <SectionFrame title={t('topics')} />
        <SectionFrame title={t('lost')} />
      </TrackedSetGate>
    </div>
  );
}
