import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FOCUS_RINGS,
  NAMED_ANIMATIONS,
  NAMED_CONTAINERS,
  NAMED_EASINGS,
  NAMED_RADII,
  NAMED_SHADOWS,
  NAMED_SIZES,
  TYPE_STYLES,
} from './class-names';

const css = readFileSync(path.join(import.meta.dirname, '../../styles/globals.css'), 'utf8');
const NAME = '([a-z0-9-]+)';

/** Names declared in a CSS text by lines such as `--spacing-control: ...` or `@utility type-body {`. */
function declared(text: string, before: string, after: string): string[] {
  const pattern = new RegExp(`^\\s*${before}${NAME}${after}`, 'gm');
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1] ?? ''))].sort();
}
const sorted = (names: readonly string[]): string[] => [...names].sort();

const GROUPS: readonly [label: string, before: string, after: string, names: readonly string[]][] = [
  ['type utilities', '@utility type-', '\\s*\\{', TYPE_STYLES],
  ['named sizes', '--spacing-', ':', NAMED_SIZES],
  ['container widths', '--container-', ':', NAMED_CONTAINERS],
  ['radii', '--radius-', ':', NAMED_RADII],
  ['shadows', '--shadow-', ':', NAMED_SHADOWS],
  ['easings', '--ease-', ':', NAMED_EASINGS],
  ['animations', '--animate-', ':', NAMED_ANIMATIONS],
];

describe('the class name lists match globals.css', () => {
  it.each(GROUPS)('%s', (_, before, after, names) => {
    expect(sorted(names)).toEqual(declared(css, before, after));
  });

  it('focus rings', () => {
    expect(sorted(FOCUS_RINGS)).toEqual(declared(css, '@utility (?=focus-ring)', '\\s*\\{'));
  });
});

describe('the comparison notices a name that is only in the stylesheet', () => {
  it.each([
    ['a size with a digit', '--spacing-', ':', '  --spacing-icon-2xl: 1.5rem;'],
    ['a shadow with a digit', '--shadow-', ':', '  --shadow-2xl: none;'],
    ['a radius with a hyphen', '--radius-', ':', '  --radius-pill-sm: 1rem;'],
    ['a type utility with a digit', '@utility type-', '\\s*\\{', '@utility type-h2 {'],
    ['a type utility without a space before the brace', '@utility type-', '\\s*\\{', '@utility type-caption{'],
    ['a container width', '--container-', ':', '  --container-wide: 80rem;'],
  ])('%s', (_, before, after, line) => {
    expect(declared(`${css}\n${line}\n`, before, after)).not.toEqual(declared(css, before, after));
  });
});
