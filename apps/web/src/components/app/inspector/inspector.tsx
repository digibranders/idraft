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
  fitInspectorWidth,
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

const FRAME = cn('relative flex flex-col rounded-xl border border-border bg-background shadow-inspector');

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
  const { mode, width, maxWidth } = inspectorPlacement({
    areaWidth: areaWidth ?? viewportWidth,
    viewportWidth,
    preferred: stored ?? defaultWidth,
  });
  // While a drag runs the card is drawn at the preview width; docked, a negative margin keeps the space it
  // takes in the layout at the committed width, so the list reflows once, on release (16 section 2.2)
  const drawn = preview === null ? width : fitInspectorWidth(preview, maxWidth);
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

  // Escape closes from inside the card only (16 section 2.8, rule 3), so the list's search keeps its own
  // Escape. Popups portal out of the card and close themselves; a tooltip showing goes first, one layer
  // per press (rule 5). A held key closes once.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const element = aside.current;
    if (element === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return;
      if (document.querySelector('[data-slot="tooltip"]') !== null) return;
      event.preventDefault();
      latestClose.current();
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [mode]);
  // J and K work from the list or the inspector, not from elsewhere on the page (16 section 2.10)
  const stepFromHere = (direction: 'next' | 'previous'): void => {
    const active = document.activeElement;
    const here =
      active !== null && (aside.current?.contains(active) === true || active.closest('[role="grid"]') !== null);
    if (here) onStep?.(direction);
  };
  useShortcut('j', () => stepFromHere('next'), { kind: 'single-key', enabled: onStep !== undefined });
  useShortcut('k', () => stepFromHere('previous'), { kind: 'single-key', enabled: onStep !== undefined });

  const widthOptions = [
    { id: 'default', label: t('widthDefault'), value: defaultWidth },
    { id: 'wide', label: t('widthWide'), value: INSPECTOR_WIDTH.wide },
    { id: 'maximum', label: t('widthMaximum'), value: maxWidth },
  ] as const;
  // One option is checked: Default while no width is kept, else the first that gives the current width
  const checkedWidth =
    stored === null ? 'default' : widthOptions.find((option) => Math.min(option.value, maxWidth) === width)?.id;
  const widthItems: MenuItemDef[] =
    mode === 'sheet'
      ? []
      : [
          ...widthOptions.map((option) => ({
            id: option.id,
            kind: 'radio' as const,
            group: t('width'),
            label: option.label,
            checked: option.id === checkedWidth,
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
      style={{ width: drawn, ...(mode === 'docked' && drawn !== width ? { marginLeft: width - drawn } : {}) }}
      className={cn(
        FRAME,
        mode === 'docked'
          ? // Beside the list, 12 px under the top bar and from the window's right and bottom edges
            'sticky top-inspector-top z-(--z-inspector) my-3 mr-3 h-inspector-docked max-h-inspector-docked-max shrink-0'
          : // Over the list, which stays usable: no scrim
            'fixed top-inspector-top right-3 bottom-3 z-(--z-drawer)',
      )}
    >
      {/* The content clips to the rounded card; the resize handle reaches over its left edge */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">{content}</div>
      <InspectorResizeHandle
        width={drawn}
        max={maxWidth}
        controlsId={asideId}
        onResize={setWidth}
        onReset={() => setWidth(null)}
        onPreview={setPreview}
      />
    </aside>
  );
}
