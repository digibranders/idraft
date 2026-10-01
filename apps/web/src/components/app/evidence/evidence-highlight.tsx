'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { formatDecimal } from '@/lib/format/number';
import { cn } from '@/lib/utils';

/** A project entity's color (`color_index`), mapped to `--chart-{n}`; the own brand is always 1. */
export type EntityColorIndex = 1 | 2 | 3 | 4 | 5 | 6;

/** The entity a mention belongs to, as a highlight needs it. */
export interface HighlightEntity {
  name: string;
  /** The own brand is highlighted in the accent tints instead of its chart color. */
  own: boolean;
  /** `null` past the sixth entity: `chart-other`, with a dashed edge. */
  colorIndex: EntityColorIndex | null;
}

export interface EvidenceHighlightProps {
  entity: HighlightEntity;
  /** How the span was matched, in words: "word boundary match". */
  matchLabel: string;
  /** From 0 to 1. */
  confidence: number;
  /** An uncertain mention is excluded from rates and drawn with a dashed edge and no fill. */
  certainty: 'certain' | 'uncertain';
  /** The product the mention came through, counted for its parent brand: "Sales Hub". */
  viaProduct?: string | undefined;
  /** The text of the span, as it stands in the answer. */
  children: string;
}

const FILL: Readonly<Record<EntityColorIndex | 'other', string>> = {
  1: cn('border-chart-1 bg-entity-1-highlight'),
  2: cn('border-chart-2 bg-entity-2-highlight'),
  3: cn('border-chart-3 bg-entity-3-highlight'),
  4: cn('border-chart-4 bg-entity-4-highlight'),
  5: cn('border-chart-5 bg-entity-5-highlight'),
  6: cn('border-chart-6 bg-entity-6-highlight'),
  other: cn('border-dashed border-chart-other bg-entity-other-highlight'),
};
const EDGE: Readonly<Record<EntityColorIndex | 'other', string>> = {
  1: cn('border-chart-1'),
  2: cn('border-chart-2'),
  3: cn('border-chart-3'),
  4: cn('border-chart-4'),
  5: cn('border-chart-5'),
  6: cn('border-chart-6'),
  other: cn('border-chart-other'),
};

/** The look of a mention: 23-application-patterns.md section 5.3. */
function markClass(entity: HighlightEntity, certainty: EvidenceHighlightProps['certainty']): string {
  // The own brand is always color 1, whatever its role row says
  const color = entity.own ? 1 : (entity.colorIndex ?? 'other');
  if (certainty === 'uncertain') return cn('border-l-2 border-dashed', EDGE[color]);
  if (entity.own) return cn('rounded-xs bg-primary-subtle type-inline-strong text-primary-text');
  return cn('border-l-2', FILL[color]);
}

/**
 * One entity mention in an answer: a `<mark>` in the entity's color, with what matched it and how sure the
 * match is in its name and its tooltip (inventory 15.13). It is not focusable; the same facts are in the
 * list of mentions beside the text. Search terms are never highlighted with it.
 */
export function EvidenceHighlight({
  entity,
  matchLabel,
  confidence,
  certainty,
  viaProduct,
  children,
}: EvidenceHighlightProps): ReactElement {
  const t = useTranslations('evidence.highlight');
  const name = viaProduct === undefined ? entity.name : t('viaProduct', { entity: entity.name, product: viaProduct });
  const summary = t('label', { entity: name, match: matchLabel, confidence: formatDecimal(confidence, 2) });
  const label = certainty === 'uncertain' ? `${summary}. ${t('uncertain')}` : summary;
  return (
    <Tooltip content={summary} detail={certainty === 'uncertain' ? t('uncertain') : undefined} purpose="label">
      <mark
        data-slot="evidence-highlight"
        aria-label={label}
        className={cn(
          'forced-mark bg-transparent box-decoration-clone px-0.5 text-foreground',
          markClass(entity, certainty),
        )}
      >
        {children}
      </mark>
    </Tooltip>
  );
}
