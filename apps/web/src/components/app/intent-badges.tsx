'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EMPTY_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The five search intents in the fixed order that lines the badges up from row to row (I, C, T, N, L). */
export const INTENT_ORDER = ['informational', 'commercial', 'transactional', 'navigational', 'local'] as const;
export type IntentName = (typeof INTENT_ORDER)[number];

/** The letter and the chart tones of each intent, the same as the design preview. */
const LOOK: Readonly<Record<IntentName, { letter: string; tone: string }>> = {
  informational: { letter: 'I', tone: 'border-chart-1/40 bg-chart-1/10 text-chart-1' },
  commercial: { letter: 'C', tone: 'border-chart-2/40 bg-chart-2/10 text-chart-2' },
  transactional: { letter: 'T', tone: 'border-chart-3/40 bg-chart-3/10 text-chart-3' },
  navigational: { letter: 'N', tone: 'border-chart-6/40 bg-chart-6/10 text-chart-6' },
  local: { letter: 'L', tone: 'border-chart-4/40 bg-chart-4/10 text-chart-4' },
};

export interface IntentBadgesProps {
  /** The intents of the row; any name outside the five (such as `unknown`) is left out. */
  intents: readonly string[];
}

/**
 * Search intent as small letter badges, one per intent, so a row with several intents shows several. Each badge is
 * named by the intent ("Informational intent"); the words and what the searcher wants are the cell's tooltip
 * (`intentTip`, from the `intentBadges` messages), because a table cell is what holds the focus. With no intent it shows a muted `n/a`.
 */
export function IntentBadges({ intents }: Readonly<IntentBadgesProps>): ReactElement {
  const t = useTranslations('intentBadges');
  const known = INTENT_ORDER.filter((name) => intents.includes(name));
  if (known.length === 0) return <span className="text-foreground-tertiary">{EMPTY_VALUE}</span>;
  return (
    <span role="list" className="inline-flex items-center gap-1">
      {known.map((name) => (
        <span
          key={name}
          role="listitem"
          aria-label={t('badge', { intent: t(`names.${name}`) })}
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-sm border type-label',
            LOOK[name].tone,
          )}
        >
          <span aria-hidden="true">{LOOK[name].letter}</span>
        </span>
      ))}
    </span>
  );
}

/** The lines of a cell's tooltip for `intents`: each name with who searches like that. Empty for none. */
export function intentTip(
  text: (part: 'names' | 'tips', name: IntentName) => string,
  intents: readonly string[],
): string {
  return INTENT_ORDER.filter((name) => intents.includes(name))
    .map((name) => `${text('names', name)}: ${text('tips', name)}`)
    .join(' ');
}
