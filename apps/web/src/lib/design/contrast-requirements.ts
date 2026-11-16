/**
 * The token pairs that must reach a WCAG contrast ratio (02-color-system.md section 9). One list, read by
 * tokens.contrast.test.ts, which checks every pair in both themes, and by the tokens section of the
 * component preview, which shows the same ratios live.
 */

/** The surfaces text sits on. */
export const TEXT_SURFACES = [
  'background',
  'surface',
  'surface-subtle',
  'surface-elevated',
  'surface-hover',
  'surface-elevated-hover',
  'surface-selected',
] as const;

/** The tokens for text that has to be read: each reaches 4.5:1 on every surface above. */
export const TEXT_TOKENS = [
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
] as const;

/** Boundaries and marks that are not text: each reaches 3:1 on every surface above. */
export const NON_TEXT_TOKENS = ['border-strong', 'ring', 'foreground-muted'] as const;

export interface ContrastPair {
  readonly foreground: string;
  readonly background: string;
  /** 4.5 for text, 3 for the boundary of a control and for other marks that are not text. */
  readonly required: 4.5 | 3;
  /** Where the pair appears, as the preview names it. */
  readonly use: string;
}

/** Labels on fills and text on tints: each reaches 4.5:1. */
export const LABEL_PAIRS: readonly ContrastPair[] = [
  { foreground: 'primary-foreground', background: 'primary', required: 4.5, use: 'Primary button label' },
  { foreground: 'primary-foreground', background: 'primary-hover', required: 4.5, use: 'Primary button, hovered' },
  {
    foreground: 'negative-button-foreground',
    background: 'negative-button',
    required: 4.5,
    use: 'Destructive button label',
  },
  {
    foreground: 'negative-button-foreground',
    background: 'negative-button-hover',
    required: 4.5,
    use: 'Destructive button, hovered',
  },
  { foreground: 'primary-text', background: 'primary-subtle', required: 4.5, use: 'Selected segment, active tab' },
  { foreground: 'positive-text', background: 'positive-subtle', required: 4.5, use: 'Positive badge' },
  { foreground: 'negative-text', background: 'negative-subtle', required: 4.5, use: 'Negative badge, error banner' },
  { foreground: 'warning-text', background: 'warning-subtle', required: 4.5, use: 'Warning badge' },
  { foreground: 'info-text', background: 'info-subtle', required: 4.5, use: 'Info badge' },
  { foreground: 'neutral-text', background: 'neutral-subtle', required: 4.5, use: 'Neutral badge' },
];

/**
 * The page tier scale (internal links, spec 7.9): the 4 px card edge and the badge square are marks that are
 * not text, so each tier reaches 3:1 on the surfaces a card or a badge sits on. The badge always pairs the
 * color with its code, so the color never carries the meaning alone.
 */
export const TIER_TOKENS = [
  'tier-1',
  'tier-2',
  'tier-3',
  'tier-4',
  'tier-5',
  'tier-6',
  'tier-7',
  'tier-8',
  'tier-none',
] as const;

/** The surfaces tier marks sit on: cards and badges on `surface`, the canvas on `surface-subtle`. */
export const TIER_SURFACES = ['surface', 'surface-subtle'] as const;
