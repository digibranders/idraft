/**
 * WCAG contrast between two design tokens, computed from the value the browser reports for them. The
 * component preview shows these ratios live, in whichever theme is on; tokens.contrast.test.ts checks the
 * required pairs in both themes on every run.
 *
 * Three notations are read. tokens.css declares `oklch()`; the build writes every color twice, as a hex
 * fallback and again as `lab()` inside `@supports (color: lab(0% 0 0))`. A current browser hands back the
 * `lab()` value from `getComputedStyle`, an older one the hex value.
 */
import { formatDecimal } from '@/lib/format';

/** A color as linear-light sRGB channels from 0 to 1, with its opacity. */
export interface LinearColor {
  red: number;
  green: number;
  blue: number;
  /** 1 is opaque. */
  alpha: number;
}

const NUMBER = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const ALPHA = String.raw`(?:\/\s*(${NUMBER})(%?)\s*)?`;
/** `name(first second third / alpha)`. The name is a parameter so that no color function is spelled in a literal. */
const colorFunction = (name: string, thirdUnit: string): RegExp =>
  new RegExp(String.raw`^${name}\(\s*(${NUMBER})(%?)\s+(${NUMBER})\s+(${NUMBER})${thirdUnit}\s*${ALPHA}\)$`);
const OKLCH = colorFunction('oklch', '(?:deg)?');
const LAB = colorFunction('lab', '');
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const alphaOf = (value: string | undefined, percent: string | undefined): number =>
  value === undefined ? 1 : clamp(Number(value) / (percent === '%' ? 100 : 1));

/** OKLCH to linear-light sRGB, by way of OKLab and the LMS cone response (Ottosson 2020). */
function fromOklch(l: number, c: number, h: number): [red: number, green: number, blue: number] {
  const hue = (h * Math.PI) / 180;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
}

const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;
/** The D50 white CSS uses for `lab()`. */
const D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585] as const;

/**
 * CIE Lab to linear-light sRGB, with the matrices of CSS Color 4: Lab to XYZ under D50, the Bradford
 * adaptation to D65, then XYZ to sRGB.
 */
function fromLab(l: number, a: number, b: number): [red: number, green: number, blue: number] {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (f: number): number => (f ** 3 > LAB_EPSILON ? f ** 3 : (116 * f - 16) / LAB_KAPPA);
  const x50 = inverse(fx) * D50[0];
  const y50 = (l > LAB_KAPPA * LAB_EPSILON ? fy ** 3 : l / LAB_KAPPA) * D50[1];
  const z50 = inverse(fz) * D50[2];
  const x = 0.9554734527042182 * x50 - 0.023098536874261423 * y50 + 0.0632593086610217 * z50;
  const y = -0.028369706963208136 * x50 + 1.0099954580058226 * y50 + 0.021041398966943008 * z50;
  const z = 0.012314001688319899 * x50 - 0.020507696433477912 * y50 + 1.3303659366080753 * z50;
  return [
    3.2409699419045226 * x - 1.537383177570094 * y - 0.4986107602930034 * z,
    -0.9692436362808796 * x + 1.8759675015077202 * y + 0.04155505740717559 * z,
    0.05563007969699366 * x - 0.20397695888897652 * y + 1.0569715142428786 * z,
  ];
}

/** One sRGB channel from 0 to 255 as linear light. */
function decode(channel: number): number {
  const share = channel / 255;
  return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
}

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`: what the build writes for a color that sRGB can show exactly. */
function fromHex(text: string): LinearColor | null {
  const digits = HEX.exec(text)?.[1];
  if (digits === undefined) return null;
  const pairs = digits.length <= 4 ? [...digits].map((digit) => digit + digit) : (digits.match(/../g) ?? []);
  const [red = 0, green = 0, blue = 0, alpha = 255] = pairs.map((pair) => Number.parseInt(pair, 16));
  return { red: decode(red), green: decode(green), blue: decode(blue), alpha: alpha / 255 };
}

/**
 * Reads `oklch(L C H)` or `lab(L a b)`, each with an optional alpha, and hex colors. Anything else (a
 * `var()`, a `color-mix()`, a named color, an empty string) is `null`, so a caller shows no ratio instead
 * of a wrong one.
 */
export function parseColor(value: string): LinearColor | null {
  const text = value.trim();
  if (text.startsWith('#')) return fromHex(text);
  const oklch = OKLCH.exec(text);
  const lab = oklch ? null : LAB.exec(text);
  const match = oklch ?? lab;
  if (!match) return null;
  const [, first, percent, second, third, alpha, alphaPercent] = match;
  // Lightness is 0 to 1 in oklch() and 0 to 100 in lab(); a percentage means the same share of either range.
  // Out-of-range lightness and a negative chroma are clamped, as CSS does when it computes the value.
  const channels = oklch
    ? fromOklch(clamp(Number(first) / (percent === '%' ? 100 : 1)), Math.max(0, Number(second)), Number(third))
    : fromLab(Math.min(100, Math.max(0, Number(first))), Number(second), Number(third));
  if (!channels.every(Number.isFinite)) return null;
  const [red, green, blue] = channels;
  return { red: clamp(red), green: clamp(green), blue: clamp(blue), alpha: alphaOf(alpha, alphaPercent) };
}

/** Relative luminance as WCAG 2.2 defines it: the weighted sum of the linear-light channels. */
export function relativeLuminance(color: LinearColor): number {
  return 0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue;
}

/** The WCAG contrast ratio of two colors, each taken as opaque, from 1 (the same) to 21 (black on white). */
export function contrastRatio(first: LinearColor, second: LinearColor): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

/** One linear-light channel as the two hex digits of its sRGB value. */
function hexChannel(linear: number): string {
  const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(clamp(encoded) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

/** The sRGB hex value of a color, as 02-color-system.md lists it beside each token. The alpha is left out. */
export function toHex(color: LinearColor): string {
  return `#${hexChannel(color.red)}${hexChannel(color.green)}${hexChannel(color.blue)}`;
}

/** Two decimals, rounded down: 4.499 is 4.49, never 4.5. */
const roundedDown = (ratio: number): number => Math.floor(ratio * 100) / 100;

/**
 * The ratio as it is written in the documents: two decimals, rounded down, so a pair is never shown as
 * passing a threshold it misses ("4.49:1" for 4.499).
 */
export function formatRatio(ratio: number): string {
  return `${formatDecimal(roundedDown(ratio), 2)}:1`;
}

/** Whether a ratio reaches what is required, judged on the number `formatRatio` shows. */
export function meetsContrast(ratio: number, required: number): boolean {
  return roundedDown(ratio) >= required;
}
