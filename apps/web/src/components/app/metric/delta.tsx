'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { formatMetricDelta, type ChangeTone, type MetricDeltaInput } from '@/lib/format';
import { cn } from '@/lib/utils';

/** `paired` is the API's own test; `interim` is the unpaired one used while the API sends no `is_detectable`. */
export type DeltaTest = 'paired' | 'interim';

export interface DeltaTip {
  /** "Previous 29.0%". */
  previousText?: string | undefined;
  /** "95% interval -1.1 to +4.6 pts", made by the caller: no formatter for a points interval exists. */
  intervalText?: string | undefined;
  /** "paired, 243 prompts". */
  method?: string | undefined;
}

export interface DeltaProps {
  input: MetricDeltaInput;
  /** `md` reads as body strong (a strip); `sm` as meta. */
  size?: 'sm' | 'md' | undefined;
  /** `interim` while the API sends no `is_detectable` (parity spec decision D-2). Default `paired`. */
  test?: DeltaTest | undefined;
  /** `false`: the cell or strip item that holds the delta carries the tooltip, where the keyboard reaches it. */
  tip?: DeltaTip | false | undefined;
}

/** The only tone map: colour by `formatMetricDelta`'s tone, never by the sign of the value (23 section 8.5). */
const TONE = {
  positive: cn('text-positive-text'),
  negative: cn('text-negative-text'),
  neutral: cn('text-foreground-secondary'),
} as const satisfies Record<ChangeTone, string>;
const SIZE = { sm: cn('type-meta'), md: cn('type-body-strong') } as const;
/** Joins the sentences of one tooltip, which carry no full stop of their own. */
export const SENTENCE_BREAK = '. ';

/** A change with nothing to compare against has no value: it is left out, never shown as 0. */
export function hasDeltaComparison(input: MetricDeltaInput): boolean {
  return input.value !== null && Number.isFinite(input.value);
}

/**
 * The tooltip text of a delta (23 section 8.5): the previous value, then what the detectability test found, then
 * the interim label. Empty when there is nothing to say, in which case no tooltip and no tab stop are drawn.
 */
export function useDeltaTip(input: MetricDeltaInput, test: DeltaTest, tip: DeltaTip | false | undefined): string {
  const t = useTranslations('common.delta');
  if (tip === false || !hasDeltaComparison(input)) return '';
  const { isDetectable } = input;
  const parts: string[] = [];
  if (tip?.previousText) parts.push(tip.previousText);
  if (isDetectable === true) {
    parts.push(t('detectableTip', { hasMethod: tip?.method ? 'true' : 'false', method: tip?.method ?? '' }));
  } else if (isDetectable === false) {
    parts.push(
      t('withinTip', { hasInterval: tip?.intervalText ? 'true' : 'false', interval: tip?.intervalText ?? '' }),
    );
  }
  if (test === 'interim' && isDetectable !== null) parts.push(t('interimTip'));
  return parts.join(SENTENCE_BREAK);
}

/**
 * The value and its spoken form, for a `Delta` or a `DeltaCell` to put in its own box: the sign and size are
 * drawn and hidden from assistive technology, which reads the change in words with what the test found.
 */
export function DeltaValue({
  input,
  test = 'paired',
}: {
  input: MetricDeltaInput;
  test?: DeltaTest | undefined;
}): ReactElement {
  const t = useTranslations('common.delta');
  const display = formatMetricDelta(input);
  const spoken = [display.label];
  if (input.isDetectable !== null) {
    spoken.push(input.isDetectable ? t('detectable') : t('withinVariation'));
    if (test === 'interim') spoken.push(t('interim'));
  }
  return (
    <>
      <span aria-hidden="true" className={TONE[display.tone]}>
        {display.text}
      </span>
      <span className="sr-only">{spoken.join(', ')}</span>
    </>
  );
}

/**
 * A change between two periods (25 section 9.4, 23 section 8.5): coloured only when it is detectable, signed
 * points without an arrow. It renders nothing without a comparison, so a strip leaves its slot out.
 */
export function Delta({ input, size = 'md', test = 'paired', tip }: DeltaProps): ReactElement | null {
  const text = useDeltaTip(input, test, tip);
  if (!hasDeltaComparison(input)) return null;
  const tipped = text !== '';
  return (
    <Tooltip content={text} disabled={!tipped}>
      <span
        // A delta with a tooltip is a tab stop that opens it (20 section 6.2 rule 6: a tooltip on an element
        // nothing focuses reaches no keyboard user); the lint rule cannot see why
        {...(tipped ? { tabIndex: 0 } : {})}
        className={cn('num', SIZE[size], tipped && 'rounded-xs outline-none focus-visible:focus-ring')}
      >
        <DeltaValue input={input} test={test} />
      </span>
    </Tooltip>
  );
}
