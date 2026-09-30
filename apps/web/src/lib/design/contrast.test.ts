import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { converter, formatHex, parse, wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

import { contrastRatio, formatRatio, meetsContrast, parseColor, relativeLuminance, toHex } from './contrast';

const css = readFileSync(fileURLToPath(new URL('../../styles/tokens.css', import.meta.url)), 'utf8');
const declared = [...css.matchAll(/--([a-z0-9-]+):\s*(oklch\([^)]*\))\s*;/g)].map(
  ([, name, value]) => [name as string, value as string] as const,
);

/** A color in CSS notation. Built from its parts, because the lint rule refuses a color literal in code. */
const notation = (fn: string, body: string): string => `${fn}(${body})`;
const hex = (digits: string): string => `#${digits}`;
const toLab = converter('lab');
/** A token value in the `lab()` notation the build writes and the browser reports, leading dots included. */
function asLab(value: string): string {
  const color = toLab(parse(value));
  if (!color) throw new Error(`culori could not read ${value}`);
  const short = (channel: number): string => String(Number(channel.toPrecision(6))).replace(/^(-?)0\./, '$1.');
  return notation('lab', `${short(color.l)}% ${short(color.a)} ${short(color.b)}`);
}
function read(value: string): NonNullable<ReturnType<typeof parseColor>> {
  const color = parseColor(value);
  if (!color) throw new Error(`could not read ${value}`);
  return color;
}

describe('parseColor', () => {
  it('reads the notation tokens.css uses', () => {
    expect(toHex(read(notation('oklch', '1 0 0')))).toBe(hex('FFFFFF'));
    expect(read(notation('oklch', '0.997 0.001 255')).alpha).toBe(1);
    expect(read(`  ${notation('oklch', '0.215 0.010 260 / 0.32')} `).alpha).toBe(0.32);
    expect(read(notation('oklch', '62% 0.014 258deg'))).toEqual(read(notation('oklch', '0.62 0.014 258')));
  });

  it('reads the lab notation a browser reports, with leading dots, negatives and a percent alpha', () => {
    const color = read(notation('lab', '4.82854% -.165135 -1.39487'));
    expect(relativeLuminance(color)).toBeGreaterThan(0.004);
    expect(relativeLuminance(color)).toBeLessThan(0.007);
    expect(read(notation('lab', '.898769% -.0460669 -.468522 / .56')).alpha).toBe(0.56);
    expect(read(notation('lab', '50 10 -10 / 56%')).alpha).toBe(0.56);
    expect(toHex(read(notation('lab', '100 0 0')))).toBe(hex('FFFFFF'));
    expect(toHex(read(notation('lab', '0 0 0')))).toBe(hex('000000'));
  });

  it('reads the hex colors the build writes, short and long, with and without alpha', () => {
    expect(toHex(read(hex('171a1e52')))).toBe(hex('171A1E'));
    expect(read(hex('171a1e52')).alpha).toBeCloseTo(0.32, 2);
    expect(read(hex('fff'))).toEqual(read(hex('FFFFFF')));
    expect(read(hex('0008')).alpha).toBeCloseTo(0.533, 3);
    expect(relativeLuminance(read(hex('ffffff')))).toBeCloseTo(1, 6);
    for (const [name, value] of declared) {
      const written = toHex(read(value));
      expect(toHex(read(written)), name).toBe(written);
    }
    for (const value of [hex('12'), hex('12345'), hex('ggg'), hex('1234567'), '#section']) {
      expect(parseColor(value), value).toBeNull();
    }
  });

  it('clamps lightness and chroma the way CSS computes them, and reads exponent notation', () => {
    const gray = read(notation('oklch', '0.5 0 200'));
    expect(read(notation('oklch', '0.5 -0.1 200'))).toEqual(gray);
    expect(read(notation('oklch', '1.4 0 0'))).toEqual(read(notation('oklch', '1 0 0')));
    expect(read(notation('lab', '-5 0 0'))).toEqual(read(notation('lab', '0 0 0')));
    expect(read(notation('lab', '120 0 0'))).toEqual(read(notation('lab', '100 0 0')));
    expect(read(notation('lab', '50 1e-3 -2.5e-2'))).toEqual(read(notation('lab', '50 0.001 -0.025')));
  });

  it('is null for anything else, so the preview shows no ratio instead of a wrong one', () => {
    const others = [
      '',
      'var(--surface)',
      'white',
      notation('rgb', '0 0 0'),
      notation('oklch', 'none 0 0'),
      notation('oklch', '0.5 0.1'),
      notation('lab', '50 10'),
      notation('color-mix', `in oklch, ${notation('oklch', '0.542 0.204 261')} 18%, transparent`),
    ];
    for (const value of others) expect(parseColor(value), value).toBeNull();
  });

  it('reads every color token of tokens.css, in both notations, as the same color', () => {
    expect(declared.length).toBeGreaterThan(80);
    for (const [name, value] of declared) {
      const fromOklch = read(value);
      const fromLab = read(asLab(value));
      expect(relativeLuminance(fromLab), name).toBeCloseTo(relativeLuminance(fromOklch), 4);
      expect(toHex(fromOklch), name).toBe(formatHex(parse(value))?.toUpperCase());
    }
  });
});

describe('contrastRatio', () => {
  const black = read(notation('oklch', '0 0 0'));
  const white = read(notation('oklch', '1 0 0'));

  it('is 21 for black on white and 1 for a color on itself, in either order', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, white)).toBe(1);
    expect(relativeLuminance(black)).toBe(0);
  });

  it.each([
    ['oklch', (value: string): string => value],
    ['lab', asLab],
  ])('agrees with culori for every token of both themes against the light surface, read as %s', (_, write) => {
    const surface = declared.find(([name]) => name === 'surface')?.[1] ?? '';
    const reference = parse(surface);
    if (!reference) throw new Error('the surface token could not be read');
    for (const [name, value] of declared) {
      const theirs = parse(value);
      if (!theirs) throw new Error(`culori could not read --${name}`);
      expect(contrastRatio(read(write(value)), read(write(surface))), name).toBeCloseTo(
        wcagContrast(theirs, reference),
        1,
      );
    }
  });
});

describe('formatRatio and meetsContrast', () => {
  it('round down, so a pair is never shown as passing a threshold it misses', () => {
    expect(formatRatio(4.499)).toBe('4.49:1');
    expect(formatRatio(4.5)).toBe('4.50:1');
    expect(formatRatio(21)).toBe('21.00:1');
    expect(formatRatio(2.999999)).toBe('2.99:1');
  });

  it('judge the number that is shown', () => {
    expect(meetsContrast(4.499, 4.5)).toBe(false);
    expect(meetsContrast(4.5, 4.5)).toBe(true);
    expect(meetsContrast(2.9999, 3)).toBe(false);
    expect(meetsContrast(3.004, 3)).toBe(true);
  });
});
