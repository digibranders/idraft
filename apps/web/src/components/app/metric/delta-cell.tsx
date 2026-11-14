'use client';

import { GitCommitVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { DeltaValue, hasDeltaComparison, SENTENCE_BREAK, useDeltaTip, type DeltaProps } from './delta';
import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import { EMPTY_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface DeltaCellProps extends Omit<DeltaProps, 'size'> {
  /** A prompt version, extractor, model or panel starts between the periods: its icon and this text. */
  boundaryText?: string | null | undefined;
}

/**
 * The change column of a table (25 section 9.4): right aligned in the table type, with a version boundary marker
 * (07-icons.md section 6) when the periods straddle one. A table cell needs a value, so no comparison reads
 * `n/a`, never 0. The cell carries its own tooltip as a tab stop unless `tip` is `false`, as the table's own
 * cell tooltip does; the boundary text then stays in hidden text.
 */
export function DeltaCell({ input, test = 'paired', tip, boundaryText = null }: DeltaCellProps): ReactElement {
  const t = useTranslations('common.delta');
  const own = useDeltaTip(input, test, tip);
  if (!hasDeltaComparison(input)) {
    return <span className="flex justify-end num type-table text-foreground-tertiary">{EMPTY_VALUE}</span>;
  }
  const boundary = boundaryText ? t('boundary', { text: boundaryText }) : null;
  const text = [own, tip === false ? null : boundary].filter(Boolean).join(SENTENCE_BREAK);
  const tipped = text !== '';
  return (
    <Tooltip content={text} disabled={!tipped}>
      <span
        // A cell with a tooltip is a tab stop that opens it (20 section 6.2 rule 6); the lint rule cannot see why
        {...(tipped ? { tabIndex: 0 } : {})}
        className={cn(
          'flex items-center justify-end gap-1 num type-table',
          tipped && 'rounded-xs outline-none focus-visible:focus-ring-inset',
        )}
      >
        {boundary === null ? null : (
          <>
            <Icon icon={GitCommitVertical} size="xs" className="text-foreground-muted" />
            {tip === false ? <span className="sr-only">{boundary}</span> : null}
          </>
        )}
        <DeltaValue input={input} test={test} />
      </span>
    </Tooltip>
  );
}
