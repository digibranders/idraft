import { axe } from './axe';

type Results = Awaited<ReturnType<typeof axe>>;

/**
 * The note box: a text area that carries `role="combobox"`, the ARIA 1.2 pattern for a multi-line box with a list.
 * Matched by the node's selector (`node.html` is cut short by axe), resolved inside the container.
 */
function isNoteBox(container: HTMLElement, target: readonly unknown[]): boolean {
  const [selector] = target;
  if (target.length !== 1 || typeof selector !== 'string') return false;
  const element = container.querySelector(selector);
  return element instanceof HTMLTextAreaElement && element.getAttribute('role') === 'combobox';
}

/**
 * axe for a container that holds the note box. Axe's `aria-allowed-role` does not list `combobox` for a `textarea`
 * although ARIA 1.2 allows it, so that one finding, on that one element, is left out. The rule stays on for everything
 * else: any other node it reports, and every other rule, still counts.
 */
export async function axeWithNoteBox(container: HTMLElement): Promise<Results> {
  const results = await axe(container);
  const violations = results.violations
    .map((violation) =>
      violation.id === 'aria-allowed-role'
        ? { ...violation, nodes: violation.nodes.filter((node) => !isNoteBox(container, node.target)) }
        : violation,
    )
    .filter((violation) => violation.nodes.length > 0);
  return { ...results, violations };
}
