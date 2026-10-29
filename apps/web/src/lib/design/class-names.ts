/**
 * The design system's own class names, as registered in src/styles/globals.css. tailwind-merge has to
 * know them to tell which of two classes wins: without these lists `h-control h-control-sm` keeps both.
 * class-names.test.ts reads globals.css and fails when a name exists there and not here.
 */
export const TYPE_STYLES = [
  'page-title',
  'inspector-title',
  'section-title',
  'subsection-title',
  'body',
  'input-touch',
  'body-strong',
  'inline-strong',
  'prose',
  'table',
  'table-strong',
  'table-header',
  'meta',
  'label',
  'micro',
  'metric',
  'metric-sm',
  'mono',
  'kbd',
] as const;
export const NAMED_SIZES = [
  'control-sm',
  'control',
  'control-lg',
  'control-touch',
  'row',
  'row-compact',
  'row-header',
  'topbar',
  'page-body',
  'page-body-min',
  'sidebar',
  'sidebar-collapsed',
  'sidebar-item',
  'tab',
  'metric-strip',
  'badge',
  'avatar',
  'save-bar',
  'inspector',
  'inspector-min',
  'inspector-max',
  'inspector-wide',
  'inspector-top',
  'inspector-docked',
  'inspector-docked-max',
  'drawer',
  'popover-min',
  'popover-max',
  'menu-min',
  'menu-max',
  'tooltip-max',
  'command',
  'icon-xs',
  'icon-sm',
  'icon',
  'icon-md',
  'icon-lg',
] as const;
export const NAMED_CONTAINERS = ['reading', 'form', 'dialog-sm', 'dialog-md', 'dialog-lg'] as const;
export const NAMED_RADII = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', 'full'] as const;
export const NAMED_SHADOWS = ['popover', 'switch-knob', 'dialog', 'drag', 'inspector'] as const;
export const NAMED_EASINGS = ['standard', 'exit'] as const;
// The two auth showcase entries are the approved additions in 21-motion.md section 14.
export const NAMED_ANIMATIONS = [
  'spin',
  'skeleton-pulse',
  'row-new',
  'live-pulse',
  'showcase-in',
  'showcase-rise',
] as const;
/** The two focus rings (08-interaction-states.md section 2): the default one and the one for dense containers. */
export const FOCUS_RINGS = ['focus-ring', 'focus-ring-inset'] as const;
