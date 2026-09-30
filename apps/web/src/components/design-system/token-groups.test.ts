import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONTRAST_PAIRS, TOKEN_GROUPS, Z_LAYERS } from './token-groups';
import { contrastRatio, formatRatio, meetsContrast, parseColor } from '@/lib/design/contrast';
import { TEXT_SURFACES, TEXT_TOKENS } from '@/lib/design/contrast-requirements';

const css = readFileSync(fileURLToPath(new URL('../../styles/tokens.css', import.meta.url)), 'utf8');

/** The declarations of the first block a selector opens: `:root` is the light theme, `.dark` the dark one. */
function block(selector: ':root' | '.dark'): Map<string, string> {
  const body = (selector === ':root' ? /^:root\s*\{([\s\S]*?)^\}/m : /^\.dark\s*\{([\s\S]*?)^\}/m).exec(css)?.[1];
  if (!body) throw new Error(`token block ${selector} not found`);
  return new Map([...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name ?? '', value ?? '']));
}
const light = block(':root');
const dark = block('.dark');
/** The value a token has in the dark theme: its own, or the light one when the dark block does not restate it. */
const inTheme = (theme: 'light' | 'dark', name: string): string =>
  (theme === 'dark' ? dark.get(name) : undefined) ?? light.get(name) ?? '';

const listed = TOKEN_GROUPS.flatMap((group) => group.tokens);

describe('the token groups match tokens.css', () => {
  it('lists every color token once, and nothing that does not exist', () => {
    // A shadow is a length list ("0 1px 2px ..."); every color value starts with a function name
    const colors = [...light].filter(([, value]) => !/^\d/.test(value)).map(([name]) => name);
    expect(colors.length).toBeGreaterThan(90);
    // Sorted lists are equal only when each token is listed exactly once
    expect([...listed].sort()).toEqual([...colors].sort());
  });

  it('has no token that only the dark theme declares, so the light list is the whole set', () => {
    expect(dark.size).toBeGreaterThan(80);
    expect([...dark.keys()].filter((name) => !light.has(name))).toEqual([]);
  });

  it('lists the layers in stacking order', () => {
    const layers = [...css.matchAll(/--z-([a-z-]+):\s*(\d+);/g)].map(([, name, value]) => ({
      name: name ?? '',
      value: Number(value),
    }));
    expect(Z_LAYERS.map((layer) => layer.name)).toEqual(layers.map((layer) => layer.name));
    expect(layers.map((layer) => layer.value)).toEqual([...layers.map((layer) => layer.value)].sort((a, b) => a - b));
  });
});

describe.each(['light', 'dark'] as const)('what the tokens section claims holds in the %s theme', (theme) => {
  function ratio(foreground: string, background: string): number {
    const first = parseColor(inTheme(theme, foreground));
    const second = parseColor(inTheme(theme, background));
    if (!first || !second) throw new Error(`cannot read ${foreground} or ${background} in the ${theme} theme`);
    return contrastRatio(first, second);
  }

  it('every text token reaches 4.5:1 on every surface of the matrix', () => {
    const misses = TEXT_TOKENS.flatMap((token) =>
      TEXT_SURFACES.filter((surface) => !meetsContrast(ratio(token, surface), 4.5)).map(
        (surface) => `${token} on ${surface}: ${formatRatio(ratio(token, surface))}`,
      ),
    );
    expect(misses).toEqual([]);
  });

  it('every listed pair reaches what it needs', () => {
    const misses = CONTRAST_PAIRS.filter(
      (pair) => !meetsContrast(ratio(pair.foreground, pair.background), pair.required),
    ).map(
      (pair) => `${pair.foreground} on ${pair.background}: ${formatRatio(ratio(pair.foreground, pair.background))}`,
    );
    expect(misses).toEqual([]);
  });
});
