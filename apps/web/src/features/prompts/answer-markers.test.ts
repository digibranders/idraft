import { describe, expect, it } from 'vitest';

import { answerSegments } from './answer-segments';
import { markerAnchors, withMarkers, type MarkerAnchor, type MarkedPiece } from './answer-markers';

const ROCKET = String.fromCodePoint(0x1f680);

/** A citation as the markers need it. */
const cite = (
  index: number,
  firstCharOffset: number | null,
  rawUrl: string,
  url = rawUrl,
): Parameters<typeof markerAnchors>[1][number] => ({
  citation_index: index,
  first_char_offset: firstCharOffset,
  raw_url: rawUrl,
  url,
});

const URL_A = 'https://a.example/page';

describe('markerAnchors', () => {
  it('puts the anchor after the cited address, which the offset points at the start of', () => {
    const text = `See [the page](${URL_A}) for more.`;
    const at = text.indexOf(URL_A);
    expect(markerAnchors(text, [cite(1, at, URL_A)])).toEqual([{ offset: at + URL_A.length, citationIndex: 1 }]);
  });

  it('reads the canonical address where the raw one is not at the offset', () => {
    const raw = `${URL_A}?utm_source=chatgpt.com`;
    const text = `See ${URL_A} now.`;
    const at = text.indexOf(URL_A);
    expect(markerAnchors(text, [cite(1, at, raw, URL_A)])).toEqual([{ offset: at + URL_A.length, citationIndex: 1 }]);
  });

  it('puts the anchor at the offset itself where neither address is there', () => {
    expect(markerAnchors('Some text here.', [cite(1, 5, URL_A)])).toEqual([{ offset: 5, citationIndex: 1 }]);
  });

  it('counts in UTF-16 units: an emoji before the address shifts the anchor by two, as the offset already does', () => {
    const text = `${ROCKET} ${URL_A} end`;
    // The API's offset is in UTF-16 units: the rocket takes two
    const at = text.indexOf(URL_A);
    expect(at).toBe(3);
    const [anchor] = markerAnchors(text, [cite(1, at, URL_A)]);
    expect(anchor?.offset).toBe(3 + URL_A.length);
    expect(text.slice(0, anchor?.offset)).toBe(`${ROCKET} ${URL_A}`);
    // A viewer that counted code points would have put it two units short
    expect([...text.slice(0, anchor?.offset)].length).toBe(2 + URL_A.length);
  });

  it('gives no anchor to a citation without an offset', () => {
    expect(markerAnchors('Text.', [cite(1, null, URL_A)])).toEqual([]);
  });

  it('ignores an offset outside the text, a negative, a fractional and a missing one', () => {
    const text = 'Short.';
    expect(
      markerAnchors(text, [
        cite(1, 99, URL_A),
        cite(2, -1, URL_A),
        cite(3, 1.5, URL_A),
        cite(4, Number.NaN, URL_A),
        cite(5, text.length + 1, URL_A),
      ]),
    ).toEqual([]);
  });

  it('allows an anchor at the very end of the text, and never one past it', () => {
    const text = `Go to ${URL_A}`;
    expect(markerAnchors(text, [cite(1, text.indexOf(URL_A), URL_A)])).toEqual([
      { offset: text.length, citationIndex: 1 },
    ]);
    // An address longer than what is left is not found at the offset: the anchor stays inside the text
    const [anchor] = markerAnchors(text, [cite(1, text.length - 3, URL_A)]);
    expect(anchor?.offset).toBeLessThanOrEqual(text.length);
  });

  it('never leaves an anchor between the two halves of one character', () => {
    const text = `${ROCKET}x`;
    expect(markerAnchors(text, [cite(1, 1, URL_A)])).toEqual([{ offset: 2, citationIndex: 1 }]);
  });

  it('anchors two citations at one offset both, in the order of the list', () => {
    const text = `${URL_A} and more`;
    const anchors = markerAnchors(text, [cite(2, 0, URL_A), cite(1, 0, URL_A)]);
    expect(anchors.map((anchor) => anchor.citationIndex)).toEqual([2, 1]);
    expect(anchors[0]?.offset).toBe(anchors[1]?.offset);
  });

  it('orders the anchors by their place in the text, whatever the order of the list', () => {
    const text = `${URL_A} then https://b.example/x`;
    const anchors = markerAnchors(text, [
      cite(1, text.indexOf('https://b.example/x'), 'https://b.example/x'),
      cite(2, 0, URL_A),
    ]);
    expect(anchors.map((anchor) => anchor.citationIndex)).toEqual([2, 1]);
  });
});

const spelled = (pieces: readonly MarkedPiece<{ evidence_spans: readonly (readonly number[])[] }>[]): string =>
  pieces.map((piece) => (piece.kind === 'marker' ? `[${String(piece.citationIndex)}]` : piece.text)).join('');
const textOf = (pieces: readonly MarkedPiece<{ evidence_spans: readonly (readonly number[])[] }>[]): string =>
  pieces.flatMap((piece) => (piece.kind === 'marker' ? [] : [piece.text])).join('');

describe('withMarkers', () => {
  const mention = { name: 'Fynix', evidence_spans: [[0, 5]] as const };
  const anchor = (offset: number, citationIndex: number): MarkerAnchor => ({ offset, citationIndex });

  it('splits a plain segment at the anchor, and the pieces still add up to the text', () => {
    const text = 'Plain text, no marks.';
    const pieces = withMarkers(answerSegments(text, []), [anchor(5, 1)]);
    expect(spelled(pieces)).toBe('Plain[1] text, no marks.');
    expect(textOf(pieces)).toBe(text);
  });

  it('puts an anchor at 0 before everything and one at the end after everything', () => {
    const text = 'Fynix leads.';
    const pieces = withMarkers(answerSegments(text, [mention]), [anchor(0, 1), anchor(text.length, 2)]);
    expect(spelled(pieces)).toBe('[1]Fynix leads.[2]');
    expect(textOf(pieces)).toBe(text);
  });

  it('keeps two anchors at one offset in order', () => {
    const pieces = withMarkers(answerSegments('abcdef', []), [anchor(3, 2), anchor(3, 1)]);
    expect(spelled(pieces)).toBe('abc[2][1]def');
  });

  it('moves an anchor inside a mention to the end of it, so a mark is never cut in two', () => {
    const text = 'Fynix leads.';
    const pieces = withMarkers(answerSegments(text, [mention]), [anchor(2, 1)]);
    expect(spelled(pieces)).toBe('Fynix[1] leads.');
    expect(pieces.filter((piece) => piece.kind === 'mention')).toHaveLength(1);
    expect(textOf(pieces)).toBe(text);
  });

  it('gives a marker between a mention and the text after it its place, and the segment starts stay true', () => {
    const text = 'Fynix leads.';
    const pieces = withMarkers(answerSegments(text, [mention]), [anchor(5, 1)]);
    expect(spelled(pieces)).toBe('Fynix[1] leads.');
    for (const piece of pieces) {
      if (piece.kind !== 'marker') expect(text.slice(piece.start, piece.start + piece.text.length)).toBe(piece.text);
    }
  });

  it('gives an empty text just its markers, and no anchors the segments unchanged', () => {
    expect(spelled(withMarkers(answerSegments('', []), [anchor(0, 1)]))).toBe('[1]');
    const segments = answerSegments('Fynix leads.', [mention]);
    expect(withMarkers(segments, [])).toEqual(segments);
  });

  it('never splits a surrogate pair when it is given anchors from markerAnchors', () => {
    const text = `${ROCKET} ${URL_A}`;
    const anchors = markerAnchors(text, [cite(1, 1, URL_A), cite(2, text.indexOf(URL_A), URL_A)]);
    const pieces = withMarkers(answerSegments(text, []), anchors);
    expect(textOf(pieces)).toBe(text);
    for (const piece of pieces) {
      if (piece.kind === 'marker') continue;
      expect(piece.text).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/);
    }
  });
});
