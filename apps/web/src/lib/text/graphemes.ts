/**
 * The UTF-16 index of the last boundary between user perceived characters (extended grapheme clusters) at or before
 * `index`: a cut there never splits a letter from its accent, a joined emoji or a flag. An index past the end is the
 * end, one below 0 is 0.
 */
export function graphemeBoundaryBefore(text: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;
  let boundary = 0;
  for (const { index: start } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (start > index) break;
    boundary = start;
  }
  return boundary;
}
