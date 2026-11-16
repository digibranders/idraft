'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement } from 'react';

import type { AddedBrand } from './use-added-brands';
import { ListRow } from './list-popover';
import type { BrandRow, PinnedOwnBrand } from '../facts';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { EMPTY_VALUE, formatPercent, formatSampleCount } from '@/lib/format';

export interface BrandRowViewProps {
  row: BrandRow | PinnedOwnBrand;
  /** The brand was added from this list. */
  added: AddedBrand | undefined;
  /** The color of a competitor the project already follows: 2 to 6, `null` for the neutral one. */
  colorIndex: number | null;
  /** One prompt on one platform: the counts show beside the rate. */
  single: boolean;
  /** What the rate rests on, as the row's tooltip. */
  tip: string | undefined;
  /** Add is off: the project follows as many brands as the summary has cells for. */
  limitReached: boolean;
  /** How many brands the project follows, for the words of the limit. */
  trackedCount: number;
  onAdd: (name: string) => void;
}

/**
 * One brand of the list: place, colour, name, then the share as a whole percent. The own brand carries a `You` badge and
 * a fill. A brand nobody tracks says `Not a competitor` and has an Add button; one added in this list says `Added`.
 */
export function BrandRowView({
  row,
  added,
  colorIndex,
  single,
  tip,
  limitReached,
  trackedCount,
  onAdd,
}: BrandRowViewProps): ReactElement {
  const t = useTranslations('prompts.lists.brands');
  const tracked = row.tracked || added !== undefined;
  const canAdd = !row.own && !tracked;
  return (
    <ListRow
      place={row.place}
      own={row.own}
      tip={tip}
      main={
        <span className="flex min-w-0 items-center gap-2">
          {row.own ? (
            <EntitySwatch own colorIndex={null} />
          ) : tracked ? (
            <EntitySwatch own={false} colorIndex={added === undefined ? colorIndex : added.colorIndex} />
          ) : null}
          <span className="truncate type-body text-foreground">{row.name}</span>
          {row.own ? <Badge className="shrink-0">{t('you')}</Badge> : null}
          {canAdd ? (
            <Tooltip content={t('notCompetitorTip')}>
              <span className="shrink-0 type-meta">{t('notCompetitor')}</span>
            </Tooltip>
          ) : null}
          {added === undefined ? null : <AddedTag focus={added.fresh} label={t('added')} />}
        </span>
      }
      value={
        <span className="flex items-center gap-2 whitespace-nowrap">
          {canAdd ? (
            <Tooltip content={limitReached ? t('addLimitTip', { count: trackedCount }) : t('addTip')}>
              <Button
                size="sm"
                className="h-6"
                aria-label={t('addLabel', { name: row.name })}
                disabled={limitReached}
                focusableWhenDisabled
                onClick={() => onAdd(row.name)}
              >
                {t('add')}
              </Button>
            </Tooltip>
          ) : null}
          <span className="num type-body-strong text-foreground">
            {row.rate === null ? EMPTY_VALUE : formatPercent(row.rate, { decimals: 0 })}
          </span>
          {single && row.counts !== null ? (
            <span className="num type-meta">{formatSampleCount(row.counts.k, row.counts.n)}</span>
          ) : null}
        </span>
      }
    />
  );
}

/** "Added" in muted text; focus goes to it when it replaces the button that had it. */
function AddedTag({ label, focus }: { label: string; focus: boolean }): ReactElement {
  const node = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // Only when the row flips: a later render of the same row leaves focus where the person put it
    if (focus) node.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, []);
  return (
    <span ref={node} tabIndex={-1} className="shrink-0 type-meta outline-none">
      {label}
    </span>
  );
}
