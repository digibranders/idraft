'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import type { AnswerSegment } from './answer-segments';
import { EvidenceHighlight, type EntityColorIndex } from '@/components/app/evidence/evidence-highlight';
import type { ObservationAnswer } from './prompt-queries';

/** A mention as the answer read gives it (its spans are lists of numbers, which `answerSegments` reads warily). */
type AnswerMention = ObservationAnswer['mentions'][number];

const colorOf = (value: number | null | undefined): EntityColorIndex | null =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 ? value : null;

export interface MarkedAnswerProps {
  /** The answer cut at its mentions (`answerSegments`), or the start of it (`clipSegments`). */
  segments: readonly AnswerSegment<AnswerMention>[];
  /** The color of each entity of the project, by entity id. */
  colors: ReadonlyMap<string, number | null | undefined>;
  /** The colors are not read yet: the own brand is marked in its accent, the others wait for theirs. */
  colorsPending: boolean;
  lang?: string | undefined;
  className: string;
  /** After the last segment, inside the paragraph: the mark of an excerpt that stops short. */
  suffix?: ReactNode;
}

/**
 * An answer's text with the own brand and the tracked competitors marked at their evidence spans, as the answer
 * viewer shows it and the Latest tab shows its excerpt. A competitor is not drawn in the style of "no color" and then
 * recolored: until the colors are read it is plain text.
 */
export function MarkedAnswer({
  segments,
  colors,
  colorsPending,
  lang,
  className,
  suffix,
}: MarkedAnswerProps): ReactElement {
  const t = useTranslations('prompts.answer');
  return (
    <p lang={lang} className={className}>
      {segments.map((segment) =>
        segment.kind === 'text' || (colorsPending && segment.mention.role !== 'own') ? (
          <span key={segment.start}>{segment.text}</span>
        ) : (
          <EvidenceHighlight
            key={segment.start}
            entity={{
              name: segment.mention.name,
              own: segment.mention.role === 'own',
              colorIndex: colorOf(colors.get(segment.mention.entity_id)),
            }}
            matchLabel={t(`matchLabels.${segment.mention.role}`)}
            confidence={segment.mention.confidence}
            certainty={segment.mention.mention_status === 'accepted' ? 'certain' : 'uncertain'}
          >
            {segment.text}
          </EvidenceHighlight>
        ),
      )}
      {suffix}
    </p>
  );
}
