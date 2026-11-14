import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EMPTY_VALUE, formatInteger, formatSampleCount } from '@/lib/format';

export type SampleNoun = 'observations' | 'answers' | 'checks' | 'prompts' | 'keywords';

export interface SampleCountProps {
  /** The part, such as the answers that name the brand. Unknown is `null`, never 0. */
  k: number | null;
  /** The whole it is counted in. */
  n: number | null;
  noun: SampleNoun;
  /** `k-of-n`: "612 of 1,296 obs". `n-only`: "250 prompts". Default `k-of-n`. */
  form?: 'k-of-n' | 'n-only' | undefined;
}

/**
 * The size of the sample behind a value (23-application-patterns.md section 8.3): `type-meta num`, with the noun
 * always present. "obs" is drawn short and read in full. An unknown count is `n/a`, never 0.
 */
export function SampleCount({ k, n, noun, form = 'k-of-n' }: SampleCountProps): ReactElement {
  const t = useTranslations('common.sampleCount');
  const count = form === 'n-only' ? formatInteger(n) : formatSampleCount(k, n);
  if (count === EMPTY_VALUE || n === null) {
    return (
      <span data-slot="sample-count" className="type-meta">
        {EMPTY_VALUE}
      </span>
    );
  }
  const unit = t('unit', { noun, count: n });
  const spoken = t('unitSpoken', { noun, count: n });
  return (
    <span data-slot="sample-count" className="num type-meta">
      {count}{' '}
      {unit === spoken ? (
        unit
      ) : (
        <>
          <span aria-hidden="true">{unit}</span>
          <span className="sr-only">{spoken}</span>
        </>
      )}
    </span>
  );
}
