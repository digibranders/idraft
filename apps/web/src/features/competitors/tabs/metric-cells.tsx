'use client';

import type { ReactElement } from 'react';

import { changeOf, type Cell } from '../model/competitor-model';
import { Delta } from '@/components/app/metric/delta';
import { formatPercent } from '@/lib/format';

/** A rate as a percentage, or the empty mark when it is unknown (never a zero). */
export function RateCell({ cell }: { cell: Cell }): ReactElement {
  return <span className="type-body tabular-nums">{formatPercent(cell.value)}</span>;
}

/** The change since the comparison period, in points; nothing to say when the comparison is off or unknown. */
export function ChangeCell({ cell }: { cell: Cell }): ReactElement {
  return (
    <Delta
      size="sm"
      tip={false}
      input={{ value: changeOf(cell), unit: 'points', polarity: 'higher_is_better', isDetectable: null }}
    />
  );
}
