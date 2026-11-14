'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { InsufficientPill } from '@/components/app/metric/insufficient-pill';

export interface SmallSampleMarkerProps {
  /** Valid answers behind the value, fewer than `MIN_OBSERVATIONS`. */
  answers: number;
  /** `text`: the answers in quiet text; `cell`: the hatched `InsufficientPill`. */
  form: 'text' | 'cell';
  /** Cell only: `false` inside a DataTable cell, which carries the tip itself (the InsufficientPill rule). */
  tip?: boolean | undefined;
}

/**
 * Rule R2 in words: a rate over too few answers says how many there are, never a percent. The point form on a
 * canvas is `smallSamplePoint` in `lib/charts/small-sample.ts`.
 */
export function SmallSampleMarker({ answers, form, tip }: SmallSampleMarkerProps): ReactElement {
  const t = useTranslations('common.insufficient');
  if (form === 'cell') return <InsufficientPill answers={answers} {...(tip === undefined ? {} : { tip })} />;
  return <span className="type-meta text-foreground-tertiary">{t('answers', { count: answers })}</span>;
}
