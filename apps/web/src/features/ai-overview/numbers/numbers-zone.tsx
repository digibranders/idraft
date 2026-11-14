'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useOverview } from '../overview-context';
import { StripError } from '../states/strip-error';
import { stripLabel, type Say } from './number-model';
import { useNumberValues } from './use-number-values';
import { NumberStrip, useLayoutScreen } from '@/features/layouts';

export interface NumbersZoneProps {
  size?: 'md' | 'inline' | undefined;
}

/**
 * The numbers zone of the page: the strip of the layout's numbers, named by its window and its branded choice. When
 * the summary fails the strip says so with one Retry in place of numbers it cannot give; in customize mode the
 * strip stays (the numbers are being arranged, and say n/a), so the layout can still be changed. The screen has a
 * grid, which says it when the layout could not be read, so the strip does not.
 */
export function NumbersZone({ size = 'md' }: NumbersZoneProps = {}): ReactElement | null {
  const say = useTranslations('aiOverview.numbers') as Say;
  const { scope } = useOverview();
  const { mode } = useLayoutScreen();
  const { valueOf, status, error } = useNumberValues();
  if (error !== null && mode !== 'customize') return <StripError errorId={error.errorId} onRetry={error.retry} />;
  return (
    <NumberStrip size={size} label={stripLabel(say, scope.range, scope.branded)} valueOf={valueOf} status={status} />
  );
}
