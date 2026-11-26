import { expect } from 'vitest';

/**
 * A drawer is 640 px by default and can be dragged from 480 px (the least) to 960 px. jsdom has no layout, so a width
 * test reads what decides the width in code: nothing inside the card holds a pixel width of its own.
 */

/**
 * The `w-`, `min-w-` and `max-w-` classes of a box that set a size. `w-full`, `min-w-0` and the like leave the box to
 * its parent; a plain `w-1` to `w-16` (4 to 64 px) is the slot of an icon, a date or a figure inside a row, and
 * `min-w-1` to `min-w-24` (up to 96 px) the floor of a cell, never the width of a column or of the card. The tab underline takes the width of the tab it sits under, which the tab list
 * measures, and its hidden measuring row is as wide as its tabs (`w-max`). A variant (`md:`, `@lg:`, `[&>td]:`) or an
 * important mark (`!w-80`, `w-80!`) does not hide a width: the class is judged by its bare name. A cap that steps with
 * a container (`max-w-32 @md:max-w-48 ...`) grows with the card, so such a box is not a fixed width.
 */
export function sizingWidthClasses(node: Element): string[] {
  const free = /^(?:(?:min-|max-)?w-(?:0|full|none|auto|fit|max|min)|w-\(--active-tab-width\))$/;
  const slot = /^(?:w-(?:[1-9]|1[0-6])|min-w-(?:[1-9]|1\d|2[0-4]))$/;
  const names = (node.getAttribute('class') ?? '').split(/\s+/);
  const steps = names.some((name) => /^@[^:]+:max-w-/.test(name));
  return names.filter((name) => {
    const bare = name.replace(/^(?:(?:\[[^\]]*\]|[^\s:[]+):)*/, '').replace(/^!|!$/g, '');
    if (steps && bare.startsWith('max-w-')) return false;
    return /^(?:min-|max-)?w-/.test(bare) && !free.test(bare) && !slot.test(bare);
  });
}

/**
 * Boxes whose own width is not the card's: a badge or a chip (`h-badge`) keeps to its label, a select keeps the width
 * of its words (its wrapper holds the width, a control of 176 px), and the native input behind a select, a radio or a
 * checkbox is a hidden 1 px box.
 */
function isOwnSizeControl(node: Element): boolean {
  return (
    node.matches(
      '[data-slot="badge"], .h-badge, input[aria-hidden="true"], input[type="radio"], input[type="checkbox"]',
    ) || node.querySelector(':scope > [data-slot="select"]') !== null
  );
}

/**
 * The label column (160 px), the figure column (112 px) and the trailing slot (224 px) of a bar row, from the
 * container query, have a sibling that takes all the room that is left: they are the fixed boxes of a row that fills
 * the card.
 */
function isColumnBesideFlexible(node: Element): boolean {
  return [...(node.parentElement?.children ?? [])].some(
    (sibling) => sibling !== node && /(?:^|\s)(?:[^\s:]+:)*flex-1(?:\s|$)/.test(sibling.getAttribute('class') ?? ''),
  );
}

/**
 * Nothing inside the card fixes a width in pixels (a share of the card, as a whisker has, is fine). `follows` names
 * the boxes a screen has shown to follow the card another way (a table column beside a free one, a canvas drawn at
 * its measured box).
 */
export function expectNoPixelWidth(drawer: HTMLElement, follows: (node: Element) => boolean = () => false): void {
  for (const node of drawer.querySelectorAll<HTMLElement | SVGElement>('*')) {
    // The box is named in the result, so a failure says which one holds the width
    const box = `${node.tagName.toLowerCase()}.${node.getAttribute('class') ?? ''}`;
    // A cap that steps with a container only grows when a container is above it: without one it stays at its least
    if ((node.getAttribute('class') ?? '').split(/\s+/).some((name) => /^@[^:]+:max-w-/.test(name))) {
      expect({ box, container: node.closest('.\\@container') !== null }).toEqual({ box, container: true });
    }
    // The card itself and its resize handle are the drawer's own
    if (node.closest('[role="separator"]') !== null || isOwnSizeControl(node) || follows(node)) continue;
    const inline = [node.style.width, node.style.minWidth, node.style.maxWidth].filter(
      (value) => value !== '' && !value.endsWith('%'),
    );
    expect({ box, inline }).toEqual({ box, inline: [] });
    const classes = sizingWidthClasses(node).filter(
      (name) => !(/w-(?:28|40|56)$/.test(name) && isColumnBesideFlexible(node)),
    );
    expect({ box, classes }).toEqual({ box, classes: [] });
  }
}
