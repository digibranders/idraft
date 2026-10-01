'use client';

import { useTranslations } from 'next-intl';
import {
  use,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';

import { InspectorHeader, type InspectorHeaderProps } from './inspector-header';
import { InspectorAreaContext, useViewportWidth } from './inspector-layout';
import { InspectorResizeHandle } from './inspector-resize-handle';
import type { MenuItemDef } from '@/components/ui/menu';
import { Sheet } from '@/components/ui/sheet';
import { useShortcut } from '@/lib/a11y/use-shortcut';
import {
  defaultInspectorWidth,
  INSPECTOR_WIDTH,
  inspectorPlacement,
  type InspectorType,
} from '@/lib/inspector/placement';
import { readInspectorWidth, subscribeInspectorWidth, writeInspectorWidth } from '@/lib/inspector/width-store';
import { cn } from '@/lib/utils';

export interface InspectorProps {
  type: InspectorType;
  /** Everything the header shows except what the inspector itself adds (the title's id, Close, the width items). */
  header: Omit<InspectorHeaderProps, 'titleId' | 'titleRef' | 'onClose' | 'backLabel' | 'moreActions'> & {
    moreActions?: readonly MenuItemDef[] | undefined;
  };
  /** The sheet's back button below 768 px: "Back to Rankings". */
  backLabel: string;
  onClose: () => void;
  /** J and K, the same as Previous and Next; left out with them. */
  onStep?: ((direction: 'next' | 'previous') => void) | undefined;
  /** An `InspectorFooter` while a section is in edit mode. */
  footer?: ReactNode;
  /** `InspectorTabs` with their panels, or an `InspectorBody`. */
  children: ReactNode;
}

const FRAME = cn(
  'relative flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-inspector',
);

/**
 * The detail panel of one record (16-drawers-dialogs-popovers.md section 2, 25 section 18.1): a card under
 * the top bar that docks beside the list when the main column keeps 720 px, lays over the list from
 * 768 px otherwise, and is a full-screen sheet below that. Docked and laid over it is a non-modal `aside`:
 * the list stays usable, Escape closes it from inside, and J and K step through the list. It must sit in
 * an `InspectorLayout`.
 */
export function Inspector({
  type,
  header,
  backLabel,
  onClose,
  onStep,
  footer,
  children,
}: InspectorProps): ReactElement {
  const t = useTranslations('inspector');
  const titleId = useId();
  const asideId = useId();
  const aside = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const areaWidth = use(InspectorAreaContext);
  const viewportWidth = useViewportWidth();
  const stored = useSyncExternalStore(
    subscribeInspectorWidth,
    () => readInspectorWidth(type),
    () => null,
  );
  const [preview, setPreview] = useState<number | null>(null);
  const defaultWidth = defaultInspectorWidth(type);
  const placement = inspectorPlacement({
    areaWidth: areaWidth ?? viewportWidth,
    viewportWidth,
    preferred: preview ?? stored ?? defaultWidth,
  });
  const { mode, width, maxWidth } = placement;
  const setWidth = (next: number | null): void => writeInspectorWidth(type, next);

  // Opening moves focus to the title, so the next Tab reaches the header's actions (16 section 2.8). The
  // sheet does the same through its own initial focus. Only on opening: a resize that turns the sheet into
  // a card keeps focus where it is.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (mode !== 'sheet') title.current?.focus({ preventScroll: true });
  }, [mode]);

  const focusInside = (): boolean => aside.current?.contains(document.activeElement) === true;
  useShortcut('Escape', onClose, { kind: 'dismiss', enabled: mode !== 'sheet' });
  useShortcut(
    'j',
    () => {
      if (focusInside() || document.activeElement?.closest('[role="grid"]') !== null) onStep?.('next');
    },
    { kind: 'single-key', enabled: onStep !== undefined },
  );
  useShortcut(
    'k',
    () => {
      if (focusInside() || document.activeElement?.closest('[role="grid"]') !== null) onStep?.('previous');
    },
    { kind: 'single-key', enabled: onStep !== undefined },
  );

  const widthItems: MenuItemDef[] =
    mode === 'sheet'
      ? []
      : [
          ...(
            [
              { id: 'default', label: t('widthDefault'), value: defaultWidth },
              { id: 'wide', label: t('widthWide'), value: INSPECTOR_WIDTH.wide },
              { id: 'maximum', label: t('widthMaximum'), value: maxWidth },
            ] as const
          ).map((option) => ({
            id: option.id,
            kind: 'radio' as const,
            group: t('width'),
            label: option.label,
            checked: width === Math.min(option.value, maxWidth),
            onSelect: () => setWidth(option.id === 'default' ? null : Math.min(option.value, maxWidth)),
          })),
          { id: 'reset-width', label: t('resetWidth'), onSelect: () => setWidth(null) },
        ];
  const content = (
    <>
      <InspectorHeader
        {...header}
        titleId={titleId}
        titleRef={title}
        moreActions={[...(header.moreActions ?? []), ...widthItems]}
        onClose={onClose}
        backLabel={mode === 'sheet' ? backLabel : null}
      />
      {children}
      {footer}
    </>
  );

  if (mode === 'sheet') {
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        aria-labelledby={titleId}
        initialFocus={title}
      >
        {content}
      </Sheet>
    );
  }
  return (
    <aside
      ref={aside}
      id={asideId}
      aria-labelledby={titleId}
      style={{ width }}
      className={cn(
        FRAME,
        mode === 'docked'
          ? // Beside the list, 12 px under the top bar and from the window's right and bottom edges
            'sticky top-inspector-top z-(--z-inspector) my-3 mr-3 h-inspector-docked shrink-0'
          : // Over the list, which stays usable: no scrim
            'fixed top-inspector-top right-3 bottom-3 z-(--z-drawer)',
      )}
    >
      {content}
      <InspectorResizeHandle
        width={width}
        max={maxWidth}
        controlsId={asideId}
        onResize={setWidth}
        onReset={() => setWidth(null)}
        onPreview={setPreview}
      />
    </aside>
  );
}
