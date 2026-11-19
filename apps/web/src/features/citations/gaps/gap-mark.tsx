'use client';

import { Check, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { markTone } from './gap-model';
import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import type { CitationGapRow } from '@/lib/citations/board-queries';
import { EMPTY_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface GapMarkProps {
  state: CitationGapRow['you']['total']['state'];
  own: boolean;
  /** Your mark on a prompt (or an engine) a selected competitor wins. */
  lost: boolean;
  /** One sentence per engine (`markLines`); empty for a brand with no read, which has no tooltip. */
  tip: string;
}

/**
 * Whether a brand is cited for a prompt (C 589 to 606): a check when an answer in scope cites it, a minus when none
 * does (a mention without a link is a minus), n/a with no answers. Screen readers hear "Cited" or "Not cited".
 */
export function GapMark({ state, own, lost, tip }: GapMarkProps): ReactElement {
  const t = useTranslations('citations.marks');
  const cited = state === 'cited';
  return (
    <Tooltip content={tip} disabled={tip === ''}>
      <span className={cn('inline-flex size-6 items-center justify-center', markTone(state, { own, lost }))}>
        {state === 'none' ? (
          <span className="type-table">{EMPTY_VALUE}</span>
        ) : (
          <>
            <Icon icon={cited ? Check : Minus} />
            <span className="sr-only">{cited ? t('cited') : t('notCited')}</span>
          </>
        )}
      </span>
    </Tooltip>
  );
}
