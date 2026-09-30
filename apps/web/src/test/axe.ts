import { configureAxe } from 'vitest-axe';

/**
 * axe for component tests. It checks structure: names, roles, labels, ARIA attributes and nesting.
 *
 * What it cannot judge in jsdom, and where that is checked instead:
 * - Contrast. jsdom does not paint, so the rule is off here. The token contrast tests cover every color
 *   pair, and the Playwright run checks rendered pages (26 section 9).
 * - Anything that depends on CSS. No stylesheet is loaded, so `hidden` and `sr-only` have no effect and an
 *   element the app hides is still reported. Hide with the `hidden` attribute or `aria-hidden` in a test.
 * - Layout rules such as target size, and page-level rules (landmarks, one `main`) when only a container is
 *   passed. Those belong to the Playwright run too.
 */
export const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });
