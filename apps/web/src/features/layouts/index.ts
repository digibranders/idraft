/**
 * The public entry of the layout screens (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md, section 3).
 * WP-16 and the page packages import from here and never edit a file behind it.
 */
// Provider: mode, draft, history, saves, and the actions on them
export { LayoutProvider, useLayoutScreen } from './layout-provider';
export type { LayoutActions, LayoutContextValue, LayoutProviderProps, SaveOutcome } from './layout-provider';
export type { CardPart, FocusRequest, LayoutMode } from './layout-state';
export { useLayoutCapabilities } from './use-layout-capabilities';
export type { LayoutCapabilities } from './use-layout-capabilities';

// Customize mode (WP-16): the screen wrapper, the controller's hook, and the controls of the page header
export { CustomizableScreen } from './customize/customizable-screen';
export type { CustomizableScreenProps } from './customize/customizable-screen';
export { useCustomize } from './customize/customize-controller';
export type { CustomizeContextValue } from './customize/customize-controller';
export { CustomizeButton, useCustomizeMenuItem } from './customize/customize-button';
export type { CustomizeButtonProps, CustomizeLabel } from './customize/customize-button';
export { CustomizingBadge } from './customize/customizing-badge';

// Grid and frame: the slots a page or WP-16 fills
export { LayoutGrid, SPAN_CLASS } from './layout-grid';
export type { LayoutGridProps } from './layout-grid';
export { CardFrame } from './card-frame';
export type { CardFrameProps } from './card-frame';
export { useBreakpoint } from './use-breakpoint';

// Registry contract: how a page says what each card type renders
export { CardSkeleton, defineCards } from './registry';
export type { CardProps, CardRegistration, CardRegistry, RegisteredCard } from './registry';

// Drag and drop for other zones (the number strip) and what is said about it
export {
  SILENT_ANNOUNCEMENTS,
  dropAnimationFor,
  layoutCollisions,
  noShift,
  rowCoordinateGetter,
  useDragAnnouncements,
  useDragBreakpoint,
  useLayoutSensors,
} from './dnd';
export type { DragAnnouncements, RowCoordinateGetterArgs } from './dnd';
export { useLayoutAnnouncer } from './announcements';
export type { LayoutAnnouncer } from './announcements';
export { dropIndex, keyboardTarget } from '@/lib/layouts';
