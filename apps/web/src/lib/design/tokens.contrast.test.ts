/**
 * Verifies WCAG 2.2 AA contrast for token pairs in both themes, sRGB gamut for every color token,
 * and color-vision-deficiency separation for the categorical chart palette.
 * Spec: docs/design-system/02-color-system.md section 9 and 15-data-visualization.md section 4.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  clampChroma,
  differenceCiede2000,
  displayable,
  filterDeficiencyDeuter,
  filterDeficiencyProt,
  filterDeficiencyTrit,
  interpolate,
  parse,
  wcagContrast,
  type Color,
} from 'culori';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../../styles/tokens.css', import.meta.url)), 'utf8');

function block(selector: ':root' | '.dark'): Record<string, string> {
  const re = selector === ':root' ? /^:root\s*\{([\s\S]*?)^\}/m : /^\.dark\s*\{([\s\S]*?)^\}/m;
  const body = re.exec(css)?.[1];
  if (!body) throw new Error(`token block ${selector} not found`);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(oklch\([^)]*\))\s*;/g)) out[m[1] as string] = m[2] as string;
  return out;
}

const light = block(':root');
const dark = { ...light, ...block('.dark') };
const themes = { light, dark } as const;

function color(tokens: Record<string, string>, name: string): Color {
  const value = tokens[name];
  if (!value) throw new Error(`missing token --${name}`);
  const parsed = parse(value);
  if (!parsed) throw new Error(`unparseable token --${name}: ${value}`);
  return parsed;
}

const textBackgrounds = [
  'background',
  'surface',
  'surface-subtle',
  'surface-elevated',
  'surface-hover',
  'surface-selected',
];
const textTokens = [
  'foreground',
  'foreground-secondary',
  'foreground-tertiary',
  'link',
  'primary-text',
  'positive-text',
  'negative-text',
  'warning-text',
  'info-text',
  'neutral-text',
];
const nonTextTokens = ['border-strong', 'ring', 'foreground-muted'];

describe.each(Object.entries(themes))('%s theme', (_name, tokens) => {
  it('keeps every color token inside the sRGB gamut', () => {
    const outside = Object.entries(tokens)
      .filter(([, v]) => {
        const c = parse(v);
        if (!c) return true;
        // allow rounding noise: compare with the gamut-clamped color
        return !displayable(c) && differenceCiede2000()(c, clampChroma(c, 'oklch')) > 0.5;
      })
      .map(([k]) => k);
    expect(outside).toEqual([]);
  });

  it.each(textBackgrounds.flatMap((bg) => textTokens.map((fg) => [fg, bg] as const)))(
    'text %s on %s meets 4.5:1',
    (fg, bg) => {
      expect(wcagContrast(color(tokens, fg), color(tokens, bg))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['foreground', 'foreground-secondary', 'foreground-tertiary'])('text %s on sidebar meets 4.5:1', (fg) => {
    expect(wcagContrast(color(tokens, fg), color(tokens, 'sidebar'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(textBackgrounds.flatMap((bg) => nonTextTokens.map((fg) => [fg, bg] as const)))(
    'non-text %s on %s meets 3:1',
    (fg, bg) => {
      expect(wcagContrast(color(tokens, fg), color(tokens, bg))).toBeGreaterThanOrEqual(3);
    },
  );

  it.each([
    ['primary-foreground', 'primary'],
    ['primary-foreground', 'primary-hover'],
    ['negative-button-foreground', 'negative-button'],
    ['negative-button-foreground', 'negative-button-hover'],
    ['positive-text', 'positive-subtle'],
    ['negative-text', 'negative-subtle'],
    ['warning-text', 'warning-subtle'],
    ['info-text', 'info-subtle'],
    ['primary-text', 'primary-subtle'],
    ['neutral-text', 'neutral-subtle'],
  ])('text %s on %s meets 4.5:1', (fg, bg) => {
    expect(wcagContrast(color(tokens, fg), color(tokens, bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    'positive-solid',
    'negative-solid',
    'warning-solid',
    'chart-1',
    'chart-2',
    'chart-3',
    'chart-4',
    'chart-5',
    'chart-6',
    'chart-other',
    'chart-reference',
  ])('graphical mark %s meets 3:1 on surface', (mark) => {
    expect(wcagContrast(color(tokens, mark), color(tokens, 'surface'))).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ['theme-switch-sun', 'theme-switch-day'],
    ['theme-switch-moon', 'theme-switch-night'],
  ] as const)('theme switch glyph %s meets 3:1 on %s', (glyph, track) => {
    expect(wcagContrast(color(tokens, glyph), color(tokens, track))).toBeGreaterThanOrEqual(3);
  });

  it.each([1, 2, 3, 4, 5, 6])('foreground on entity %i evidence highlight (18% over surface) meets 4.5:1', (n) => {
    const mixed = interpolate([color(tokens, 'surface'), color(tokens, `chart-${n}`)], 'oklch')(0.18);
    expect(wcagContrast(color(tokens, 'foreground'), mixed)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the six categorical chart colors distinguishable under color-vision deficiencies', () => {
    const de = differenceCiede2000();
    const palette = [1, 2, 3, 4, 5, 6].map((i) => color(tokens, `chart-${i}`));
    const simulations: Record<string, (c: Color) => Color> = {
      normal: (c: Color) => c,
      deuteranopia: filterDeficiencyDeuter(1),
      protanopia: filterDeficiencyProt(1),
      tritanopia: filterDeficiencyTrit(0.7),
    };
    for (const [mode, simulate] of Object.entries(simulations)) {
      let min = Number.POSITIVE_INFINITY;
      for (let i = 0; i < palette.length; i++) {
        for (let j = i + 1; j < palette.length; j++) {
          min = Math.min(min, de(simulate(palette[i] as Color), simulate(palette[j] as Color)));
        }
      }
      // CIEDE2000 above 8 is clearly distinguishable for thin lines; normal vision target is 15.
      expect(min, `${mode} minimum pairwise difference`).toBeGreaterThanOrEqual(mode === 'normal' ? 15 : 8);
    }
  });
});
