'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { withMarkers, type MarkedPiece, type MarkerAnchor } from './answer-markers';
import type { AnswerSegment } from './answer-segments';
import { CitationMarker } from '@/components/app/evidence/citation-marker';
import { EvidenceHighlight, type EntityColorIndex } from '@/components/app/evidence/evidence-highlight';
import type { ObservationAnswer } from './prompt-queries';

/** A mention as the answer read gives it (its spans are lists of numbers, which `answerSegments` reads warily). */
type AnswerMention = ObservationAnswer['mentions'][number];

/** An entity's color as the mark draws it: 1 to 6, or `null` past the sixth (and for a color not read yet). */
export const entityColorOf = (value: number | null | undefined): EntityColorIndex | null =>
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
  /** The entities whose marks are turned off: their mentions are plain text, as the words the answer wrote. */
  hidden?: ReadonlySet<string> | undefined;
  /** Where the citation markers go (`markerAnchors`); none without them. Needs `onCitation`. */
  markers?: readonly MarkerAnchor[] | undefined;
  /** The name of a citation's marker: "Citation 2: g2.com". */
  citationLabel?: ((index: number) => string) | undefined;
  /** The citation whose marker is drawn solid, until another is used. */
  activeCitation?: number | null | undefined;
  onCitation?: ((index: number) => void) | undefined;
}

/**
 * An answer's text with the own brand and the tracked competitors marked at their evidence spans, as the answer
 * viewer shows it and the Latest tab shows its excerpt. A competitor is not drawn in the style of "no color" and then
 * recolored: until the colors are read it is plain text. With `markers` the viewer's citation buttons stand after the
 * addresses the answer cites; an entity in `hidden` is plain text too.
 */
export function MarkedAnswer({
  segments,
  colors,
  colorsPending,
  lang,
  className,
  suffix,
  hidden,
  markers,
  citationLabel,
  activeCitation,
  onCitation,
}: MarkedAnswerProps): ReactElement {
  const t = useTranslations('prompts.answer');
  const pieces: readonly MarkedPiece<AnswerMention>[] =
    markers === undefined || markers.length === 0 ? segments : withMarkers(segments, markers);
  return (
    <p lang={lang} className={className}>
      {pieces.map((piece) => {
        if (piece.kind === 'marker') {
          return (
            <CitationMarker
              key={`marker ${String(piece.start)} ${String(piece.citationIndex)}`}
              index={piece.citationIndex}
              label={citationLabel?.(piece.citationIndex) ?? String(piece.citationIndex)}
              active={piece.citationIndex === activeCitation}
              onActivate={(index) => onCitation?.(index)}
            />
          );
        }
        if (
          piece.kind === 'text' ||
          hidden?.has(piece.mention.entity_id) === true ||
          (colorsPending && piece.mention.role !== 'own')
        ) {
          return <span key={piece.start}>{piece.text}</span>;
        }
        return (
          <EvidenceHighlight
            key={piece.start}
            entity={{
              name: piece.mention.name,
              own: piece.mention.role === 'own',
              colorIndex: entityColorOf(colors.get(piece.mention.entity_id)),
            }}
            matchLabel={t(`matchLabels.${piece.mention.role}`)}
            confidence={piece.mention.confidence}
            certainty={piece.mention.mention_status === 'accepted' ? 'certain' : 'uncertain'}
          >
            {piece.text}
          </EvidenceHighlight>
        );
      })}
      {suffix}
    </p>
  );
}
