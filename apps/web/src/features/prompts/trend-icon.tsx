'use client';

import type { ReactElement } from 'react';

import { useCompare } from './compare/use-compare';
import { DeltaIcon } from '@/components/app/metric/delta-icon';
import { deltaInput, type RateChange } from '@/lib/compare/change-model';

/** The tests and the colour-rule scan of the Prompts page find the icon by this slot. */
const SLOT = 'trend-icon';

export interface TrendIconProps {
  /** How the rate moved; `null` where it is not known. */
  change: RateChange | null;
}

/**
 * The change of a rate in a cell of the Prompts table as an icon (`DeltaIcon`). The figures are in the cell's tooltip,
 * which is what the keyboard reaches. Nothing is drawn while the comparison is off or the change is not known.
 */
export function TrendIcon({ change }: TrendIconProps): ReactElement | null {
  const { compare } = useCompare();
  if (!compare || change === null) return null;
  return <DeltaIcon input={deltaInput(change)} test="interim" slot={SLOT} />;
}
