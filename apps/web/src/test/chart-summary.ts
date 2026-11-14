/**
 * The screen reader summary of a `ChartFrame`: the visually hidden paragraph of the frame whose heading is
 * `heading`. It stays in the DOM in every state, so a test reads it to see what assistive technology is told.
 */
export function chartSummaryText(heading: HTMLElement): string {
  const section = heading.closest('section');
  if (section === null) throw new Error('The heading is not inside a chart frame');
  const summary = Array.from(section.children).find(
    (child) => child.tagName === 'P' && child.className.includes('sr-only'),
  );
  if (summary === undefined) throw new Error('The chart frame has no summary paragraph');
  return summary.textContent;
}
