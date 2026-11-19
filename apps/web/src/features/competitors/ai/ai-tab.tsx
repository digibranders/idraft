'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { SectionFrame } from '../comparison/section-frame';
import { TrackedSetGate } from '../tabs/tracked-set-gate';

/**
 * The AI tab (plan section 3.12). T2 holds the frame: the tracked set's states and the section the share of voice
 * charts of T6 fill, which reads the series through `useCompetitors().reads.series`.
 */
export function AiTab(): ReactElement {
  const t = useTranslations('competitors.sections');
  return (
    <div data-slot="ai-tab" className="flex flex-col gap-5">
      <TrackedSetGate>
        <SectionFrame title={t('trend')} />
      </TrackedSetGate>
    </div>
  );
}
