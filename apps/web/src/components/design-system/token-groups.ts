/**
 * The color tokens of tokens.css as the preview shows them, by role. token-groups.test.ts fails when a
 * color token exists in tokens.css and in no group here, so a new token cannot be left out of the preview.
 */
import { LABEL_PAIRS, type ContrastPair } from '@/lib/design/contrast-requirements';

export interface TokenGroup {
  readonly title: string;
  readonly note: string;
  readonly tokens: readonly string[];
}

export const TOKEN_GROUPS: readonly TokenGroup[] = [
  {
    title: 'Surfaces',
    note: '02 sections 2 and 3. Layers from the canvas up; an overlay is a lighter surface with a shadow.',
    tokens: [
      'background',
      'sidebar',
      'surface',
      'surface-subtle',
      'surface-elevated',
      'surface-hover',
      'surface-elevated-hover',
      'surface-selected',
      'surface-disabled',
      'scrim',
    ],
  },
  {
    title: 'Text',
    note: 'Primary, secondary and tertiary text carry content; muted and disabled never carry meaning alone.',
    tokens: [
      'foreground',
      'foreground-secondary',
      'foreground-tertiary',
      'foreground-muted',
      'foreground-disabled',
      'foreground-inverse',
      'link',
    ],
  },
  {
    title: 'Borders and focus',
    note: 'border-strong and ring reach 3:1 against every surface; border and border-subtle are decoration.',
    tokens: ['border-subtle', 'border', 'border-strong', 'ring'],
  },
  {
    title: 'Primary',
    note: 'The one accent: actions, links, selection.',
    tokens: ['primary', 'primary-hover', 'primary-foreground', 'primary-text', 'primary-subtle', 'primary-border'],
  },
  {
    title: 'Status families',
    note: '02 section 4. Each family has a text color, a tint, a border and, where it is used as a fill, a solid.',
    tokens: [
      'positive-text',
      'positive-subtle',
      'positive-border',
      'positive-solid',
      'negative-text',
      'negative-subtle',
      'negative-border',
      'negative-solid',
      'negative-button',
      'negative-button-hover',
      'negative-button-foreground',
      'warning-text',
      'warning-subtle',
      'warning-border',
      'warning-solid',
      'info-text',
      'info-subtle',
      'info-border',
      'neutral-text',
      'neutral-subtle',
      'neutral-border',
    ],
  },
  {
    title: 'Charts',
    note: '02 section 7. Six categorical colors, then the aggregate, reference, bar, grid, axis and band colors.',
    tokens: [
      'chart-1',
      'chart-2',
      'chart-3',
      'chart-4',
      'chart-5',
      'chart-6',
      'chart-other',
      'chart-reference',
      'chart-bar-neutral',
      'chart-positive',
      'chart-negative',
      'chart-grid',
      'chart-axis',
      'chart-label',
      'chart-band',
    ],
  },
  {
    title: 'Evidence highlights',
    note: '02 section 8. The color of an entity at 18% behind the words that name it in an answer.',
    tokens: [
      'entity-1-highlight',
      'entity-2-highlight',
      'entity-3-highlight',
      'entity-4-highlight',
      'entity-5-highlight',
      'entity-6-highlight',
      'entity-other-highlight',
    ],
  },
  {
    title: 'Scales',
    note: 'Rank bands, the sequential scale of heat maps and the diverging scale of changes.',
    tokens: [
      'rank-band-1',
      'rank-band-2',
      'rank-band-3',
      'rank-band-4',
      'rank-band-5',
      'rank-band-none',
      'seq-1',
      'seq-2',
      'seq-3',
      'seq-4',
      'seq-5',
      'seq-6',
      'seq-7',
      'div-neg-3',
      'div-neg-2',
      'div-neg-1',
      'div-zero',
      'div-pos-1',
      'div-pos-2',
      'div-pos-3',
    ],
  },
  {
    title: 'Theme switch',
    note: 'The day and night track of the theme switch in the top bar.',
    tokens: ['theme-switch-day', 'theme-switch-night', 'theme-switch-sun', 'theme-switch-moon', 'theme-switch-knob'],
  },
];

/**
 * The pairs the preview lists below the text matrix: every label pair tokens.contrast.test.ts checks, then
 * the boundaries of controls on the surfaces they usually sit on.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...LABEL_PAIRS,
  { foreground: 'border-strong', background: 'surface', required: 3, use: 'Checkbox, radio and switch outline' },
  { foreground: 'ring', background: 'surface', required: 3, use: 'Focus ring on a panel' },
  { foreground: 'ring', background: 'background', required: 3, use: 'Focus ring on the canvas' },
  { foreground: 'primary', background: 'surface', required: 3, use: 'Checked control, tab indicator' },
];

/** The stacking order, lowest first. The names are the `--z-*` tokens of tokens.css. */
export const Z_LAYERS: readonly { readonly name: string; readonly use: string }[] = [
  { name: 'base', use: 'Page content' },
  { name: 'pinned-cell', use: 'Pinned table columns' },
  { name: 'table-header', use: 'Sticky table header' },
  { name: 'sticky', use: 'Page header, filter bar, save bar' },
  { name: 'sidebar', use: 'Sidebar' },
  { name: 'inspector', use: 'Docked inspector' },
  { name: 'dropdown', use: 'Menus, popovers, selects, date pickers' },
  { name: 'drawer', use: 'Navigation drawer, overlay inspector' },
  { name: 'dialog', use: 'Dialogs' },
  { name: 'command', use: 'Command palette' },
  { name: 'toast', use: 'Toasts' },
  { name: 'tooltip', use: 'Tooltips' },
];
