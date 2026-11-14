import type { AnswerSegment } from './answer-segments';
import type { CitationOut } from '@/lib/api/types';

/** What a marker needs of a citation: the response's citations fit it, whatever else they carry. */
type Cited = Pick<CitationOut, 'citation_index' | 'first_char_offset' | 'raw_url' | 'url'>;

/** Where one citation's marker goes: a UTF-16 offset into `answer_text`, as a JavaScript string indexes it. */
export interface MarkerAnchor {
  offset: number;
  citationIndex: number;
}

/** A piece of the answer: plain text, a mention, or the marker of a citation between two of them. */
export type MarkedPiece<M extends { evidence_spans: readonly (readonly number[])[] }> =
  AnswerSegment<M> | { kind: 'marker'; start: number; citationIndex: number };

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * Where each citation's marker sits in the answer (D5 of the WP-26 plan): at the end of the address the provider
 * cited, one marker for the first place the API found it. `first_char_offset` is where the address starts (the API
 * converts its code points to UTF-16, `offsets_unit: 'utf16'`), so the marker is that offset plus the length of the
 * address found there: the raw one the provider sent, else the canonical one. Where neither is at the offset the
 * marker sits at the offset itself. A citation with no usable offset (none, outside the text, fractional) has no
 * marker and stays in the list alone. An anchor never falls between the two halves of one character past U+FFFF: it
 * moves past it. Anchors are in text order, and two at one offset keep the order of `citations`.
 */
export function markerAnchors(text: string, citations: readonly Cited[]): MarkerAnchor[] {
  const anchors: MarkerAnchor[] = [];
  for (const citation of citations) {
    const start = citation.first_char_offset;
    if (typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start > text.length) continue;
    const found = [citation.raw_url, citation.url].find((address) => address !== '' && text.startsWith(address, start));
    let offset = start + (found?.length ?? 0);
    if (
      offset < text.length &&
      isLowSurrogate(text.charCodeAt(offset)) &&
      isHighSurrogate(text.charCodeAt(offset - 1))
    ) {
      offset += 1;
    }
    anchors.push({ offset, citationIndex: citation.citation_index });
  }
  // Array.prototype.sort is stable, so equal offsets keep the order of the list
  return anchors.sort((a, b) => a.offset - b.offset);
}

/**
 * The segments of `answerSegments` with the markers between them. A text segment is cut where an anchor falls in it;
 * an anchor inside a mention moves to the end of the mention, so a mark is never split in two. The pieces that are not
 * markers still add up to the text, and each keeps its own `start`.
 */
export function withMarkers<M extends { evidence_spans: readonly (readonly number[])[] }>(
  segments: readonly AnswerSegment<M>[],
  anchors: readonly MarkerAnchor[],
): MarkedPiece<M>[] {
  if (anchors.length === 0) return [...segments];
  const pieces: MarkedPiece<M>[] = [];
  let next = 0;
  const marker = (anchor: MarkerAnchor): void => {
    pieces.push({ kind: 'marker', start: anchor.offset, citationIndex: anchor.citationIndex });
  };
  for (const segment of segments) {
    const end = segment.start + segment.text.length;
    // What lies at or before the start of the segment goes before it
    while (next < anchors.length && (anchors[next]?.offset ?? Infinity) <= segment.start) {
      const anchor = anchors[next];
      if (anchor !== undefined) marker(anchor);
      next += 1;
    }
    if (segment.kind === 'mention') {
      pieces.push(segment);
      while (next < anchors.length && (anchors[next]?.offset ?? Infinity) < end) {
        const anchor = anchors[next];
        if (anchor !== undefined) marker(anchor);
        next += 1;
      }
      continue;
    }
    let at = segment.start;
    while (next < anchors.length && (anchors[next]?.offset ?? Infinity) < end) {
      const anchor = anchors[next];
      if (anchor !== undefined) {
        const before = segment.text.slice(at - segment.start, anchor.offset - segment.start);
        if (before !== '') pieces.push({ kind: 'text', start: at, text: before });
        marker(anchor);
        at = anchor.offset;
      }
      next += 1;
    }
    if (at < end) pieces.push({ kind: 'text', start: at, text: segment.text.slice(at - segment.start) });
  }
  for (const anchor of anchors.slice(next)) marker(anchor);
  return pieces;
}
