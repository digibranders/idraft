/**
 * Every heat-map bin keeps its printed value readable: the bin's text token on the bin's fill token is at
 * least 4.5:1 in both themes (WCAG 2.2 AA, docs/design-system/02-color-system.md section 9). It reads the
 * class strings of `heat-bins.ts` and the values of `tokens.css`, so a changed class or token is measured.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, wcagContrast, type Color } from 'culori';
import { describe, expect, it } from 'vitest';

import { DIVERGING_BINS, SEQUENTIAL_BINS, type HeatBin } from './heat-bins';

const css = readFileSync(fileURLToPath(new URL('../../../styles/tokens.css', import.meta.url)), 'utf8');

function block(selector: ':root' | '.dark'): Record<string, string> {
  const re = selector === ':root' ? /^:root\s*\{([\s\S]*?)^\}/m : /^\.dark\s*\{([\s\S]*?)^\}/m;
  const body = re.exec(css)?.[1];
  if (!body) throw new Error(`token block ${selector} not found`);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(oklch\([^)]*\))\s*;/g)) out[m[1] as string] = m[2] as string;
  return out;
}

const light = block(':root');
const themes = { light, dark: { ...light, ...block('.dark') } } as const;

function color(tokens: Record<string, string>, name: string): Color {
  const value = tokens[name];
  if (!value) throw new Error(`missing token --${name}`);
  const parsed = parse(value);
  if (!parsed) throw new Error(`unparseable token --${name}: ${value}`);
  return parsed;
}

/** The token a bin's fill class names, `bg-seq-3` to `seq-3`. */
function fillToken(bin: HeatBin): string {
  const name = /^bg-((?:seq|div)-[a-z0-9-]+)$/.exec(bin.fill)?.[1];
  if (!name) throw new Error(`fill class ${bin.fill} is not a seq or div utility`);
  return name;
}

/** The token a bin's text class names in a theme: `dark:text-*` wins in dark, `text-*` is the base. */
function textToken(bin: HeatBin, theme: 'light' | 'dark'): string {
  const classes = bin.text.split(' ');
  const base = classes.find((name) => name.startsWith('text-'));
  const dark = classes.find((name) => name.startsWith('dark:text-'));
  const chosen = theme === 'dark' && dark ? dark.slice('dark:'.length) : base;
  if (!chosen) throw new Error(`text class ${bin.text} has no text colour`);
  return chosen.slice('text-'.length);
}

describe.each(Object.entries(themes))('%s theme', (name, tokens) => {
  const theme = name as 'light' | 'dark';
  const bins: readonly (readonly [string, HeatBin])[] = [
    ...SEQUENTIAL_BINS.map((bin) => [`sequential ${fillToken(bin)}`, bin] as const),
    ...DIVERGING_BINS.map((bin) => [`diverging ${fillToken(bin)}`, bin] as const),
  ];

  it.each(bins)('%s keeps its text at 4.5:1', (_label, bin) => {
    const ratio = wcagContrast(color(tokens, textToken(bin, theme)), color(tokens, fillToken(bin)));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
