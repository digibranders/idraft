'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import type { InspectorTarget, InspectorType } from './placement';
import { announce } from '@/lib/a11y/announcer';
import { formatInteger } from '@/lib/format/number';

export type StepDirection = 'next' | 'previous';

/** What the hook needs of `useInspector()`; `UseInspectorResult` satisfies it (lib may not import components). */
export interface SteppableInspector {
  target: InspectorTarget | null;
  step: (direction: StepDirection, orderedIds: readonly string[]) => void;
}

/** The same shape as `InspectorNavigation` of `inspector-header.tsx`. */
export interface StepNavigation {
  onPrevious: () => void;
  onNext: () => void;
  atFirst: boolean;
  atLast: boolean;
}

export interface UseInspectorSteppingOptions {
  inspector: SteppableInspector;
  /** Only an open record of this type is stepped (an id of another type never matches by accident). */
  type: InspectorType;
  /**
   * The table's current row order: `DataTable onRowOrderChange`, or a narrower list (a topic's prompts).
   * Keep it referentially stable (state, or memoised): a new array each render redoes an O(n) `indexOf` each time.
   */
  order: readonly string[];
  /** "Domain": spoken first after a step. */
  typeLabel: string;
  /** "domain": for "Last domain in this list". */
  typeNoun: string;
  /** Runs the step, or asks first (unsaved changes). Default: runs it. */
  guard?: ((run: () => void) => void) | undefined;
}

export interface InspectorStepping {
  /** "3 of 13"; null when the open record is not in `order`, so a wrong "N of M" is never shown. */
  positionText: string | null;
  navigation: StepNavigation | null;
  /** For `Inspector onStep`; undefined with `navigation` null, so J and K are off. */
  onStep: ((direction: StepDirection) => void) | undefined;
}

/**
 * Previous and Next through the order a list shows (SC-22), for any table. It binds no keys: `Inspector`
 * already listens for J and K when it is given `onStep`, and a second listener would step twice. The ends do
 * not wrap; a step past one says so and leaves the URL alone.
 */
export function useInspectorStepping({
  inspector,
  type,
  order,
  typeLabel,
  typeNoun,
  guard,
}: UseInspectorSteppingOptions): InspectorStepping {
  const t = useTranslations('common.inspectorStepping');
  const tInspector = useTranslations('inspector');
  const { target } = inspector;
  const openId = target !== null && target.type === type ? target.id : null;
  // One pass per change of list or record, never one per step or per render
  const index = useMemo(() => (openId === null ? -1 : order.indexOf(openId)), [openId, order]);
  if (index === -1) return { positionText: null, navigation: null, onStep: undefined };

  const count = order.length;
  const atFirst = index === 0;
  const atLast = index === count - 1;
  const step = (direction: StepDirection): void => {
    if (direction === 'next' ? atLast : atFirst) {
      announce(tInspector(direction === 'next' ? 'lastInList' : 'firstInList', { type: typeNoun }), {
        key: 'inspector-step',
      });
      return;
    }
    const run = (): void => {
      inspector.step(direction, order);
      announce(
        t('announce', {
          type: typeLabel,
          index: formatInteger(index + (direction === 'next' ? 2 : 0)),
          count: formatInteger(count),
        }),
        { key: 'inspector-step' },
      );
    };
    if (guard === undefined) run();
    else guard(run);
  };
  return {
    positionText: t('position', { index: formatInteger(index + 1), count: formatInteger(count) }),
    navigation: { onPrevious: () => step('previous'), onNext: () => step('next'), atFirst, atLast },
    onStep: step,
  };
}
