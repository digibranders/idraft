/**
 * The button inside `root` with this accessible name, or null. Where the focus goes back to when a drawer that a chart
 * opened closes: the chart is a picture, and the list of brands beside it holds the buttons of the same competitors.
 */
export function buttonNamed(root: HTMLElement | null, name: string): HTMLElement | null {
  const buttons = root?.querySelectorAll<HTMLElement>('button') ?? [];
  return [...buttons].find((button) => button.getAttribute('aria-label') === name) ?? null;
}
