'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { useCallback, useState, type ComponentProps, type ReactElement, type ReactNode, type RefObject } from 'react';

import { DiscardChangesDialog } from './alert-dialog';
import { Button } from './button';
import { Icon } from './icon';
import { cn } from '@/lib/utils';

/** 400 px for confirmations and single fields, 560 px for standard forms, 720 px for multi-step flows. */
export type DialogSize = 'sm' | 'md' | 'lg';

/** The words of the question a dirty dialog asks before it closes (10-forms.md section 13.2). */
export interface DialogDiscardCopy {
  title: string;
  description: string;
  keepEditingLabel: string;
  discardLabel: string;
}

type DirtyGuard =
  | { dirty?: undefined; discard?: undefined }
  | {
      /** Whether any field has changed. Escape, Close and Cancel then ask first, and the scrim does nothing. */
      dirty: boolean;
      discard: DialogDiscardCopy;
    };

export type DialogProps = DirtyGuard &
  Omit<DialogPrimitive.Popup.Props, 'className' | 'render' | 'children' | 'initialFocus'> & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    size: DialogSize;
    /**
     * What takes focus when the dialog opens. Without it focus goes to the first field of the body, or to
     * the Close button when the body has none.
     */
    initialFocus?: RefObject<HTMLElement | null> | undefined;
    /**
     * `DialogHeader`, `DialogBody` and `DialogFooter`. A form that spans body and footer wraps them in
     * `<form className="contents">`, so they stay the flex children of the dialog and stay siblings, which
     * is how the footer learns that the body is cut off.
     */
    children: ReactNode;
    className?: string | undefined;
  };

const SIZE_CLASS: Readonly<Record<DialogSize, string>> = {
  sm: cn('sm:w-dialog-sm'),
  md: cn('sm:w-dialog-md'),
  lg: cn('sm:w-dialog-lg'),
};
const FIELDS =
  'input:not([type="hidden"]), textarea, select, [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"]';

/** The first field of the body that is shown and enabled takes focus; a dialog without one starts on its Close button. */
function firstField(popup: Element | null): HTMLElement | true {
  const body = popup?.querySelector('[data-slot="dialog-body"]');
  const fields = body ? [...body.querySelectorAll<HTMLElement>(FIELDS)] : [];
  const usable = (field: HTMLElement): boolean =>
    !field.matches(':disabled, [aria-disabled="true"]') &&
    field.closest('[hidden], [aria-hidden="true"], [inert]') === null;
  return fields.find(usable) ?? true;
}

/**
 * A bounded task with a clear end: create, add, edit one object (16-drawers-dialogs-popovers.md section
 * 4). It is modal: Tab stays inside, and focus returns to what opened it. Below 640 px it fills the
 * screen. A dialog never holds charts, tables or an inspector, and never opens another dialog, except
 * that the question about unsaved changes may open above it.
 */
export function Dialog({
  open,
  onOpenChange,
  size,
  dirty,
  discard,
  initialFocus,
  children,
  className,
  ...props
}: DialogProps): ReactElement {
  const [asking, setAsking] = useState(false);
  // A dialog closed from outside while the question was open must not reopen with the question
  if (!open && asking) setAsking(false);
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const handleOpenChange: NonNullable<DialogPrimitive.Root.Props['onOpenChange']> = (next, details) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (dirty === true) {
      // A click on the scrim is ignored: no prompt, no animation. Every other way out asks first.
      if (details.reason !== 'outside-press') setAsking(true);
      return;
    }
    onOpenChange(false);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      {/* A select or a menu opened inside the dialog has to come out above it */}
      <DialogPrimitive.Portal className="[--z-dropdown:var(--z-dialog)]">
        <DialogPrimitive.Backdrop
          data-slot="dialog-scrim"
          // A press on the scrim never moves focus: it closes a clean dialog and is ignored by a dirty one
          onMouseDown={(event) => event.preventDefault()}
          className="fixed inset-0 z-(--z-dialog) bg-(--scrim) transition-opacity duration-(--duration-slow) ease-standard data-ending-style:opacity-0 data-ending-style:duration-(--duration-base) data-ending-style:ease-exit data-starting-style:opacity-0"
        />
        <DialogPrimitive.Popup
          ref={setPopup}
          data-slot="dialog"
          {...props}
          initialFocus={initialFocus ?? (() => firstField(popup))}
          className={cn(
            // While the question about unsaved changes is open above it, the dialog is dimmed like the page behind it
            'fixed inset-0 z-(--z-dialog) flex flex-col bg-surface-elevated shadow-dialog transition-[opacity,translate] duration-(--duration-slow) ease-standard outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-(--scrim) after:opacity-0 after:transition-opacity after:duration-(--duration-slow) data-ending-style:opacity-0 data-ending-style:duration-(--duration-base) data-ending-style:ease-exit data-nested-dialog-open:after:opacity-100 data-starting-style:translate-y-2 data-starting-style:opacity-0 sm:inset-auto sm:top-[max(12vh,3rem)] sm:left-1/2 sm:max-h-[calc(100dvh-12vh-3rem)] sm:max-w-[calc(100vw-2rem)] sm:-translate-x-1/2 sm:rounded-xl',
            SIZE_CLASS[size],
            className,
          )}
        >
          {children}
          {discard ? (
            <DiscardChangesDialog
              open={asking}
              title={discard.title}
              description={discard.description}
              keepEditingLabel={discard.keepEditingLabel}
              discardLabel={discard.discardLabel}
              onKeepEditing={() => setAsking(false)}
              onDiscard={() => {
                setAsking(false);
                onOpenChange(false);
              }}
            />
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface DialogHeaderProps extends Omit<ComponentProps<'div'>, 'children' | 'title'> {
  /** Names the dialog. */
  title: string;
  /** One or two sentences. */
  description?: string | undefined;
  /** The name of the Close button: "Close". */
  closeLabel: string;
}

export function DialogHeader({ title, description, closeLabel, className, ...props }: DialogHeaderProps): ReactElement {
  return (
    <div
      data-slot="dialog-header"
      {...props}
      className={cn('flex shrink-0 items-start gap-4 px-6 pt-6 pb-4', className)}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <DialogPrimitive.Title className="type-section-title">{title}</DialogPrimitive.Title>
        {description === undefined ? null : (
          <DialogPrimitive.Description className="type-body text-foreground-secondary">
            {description}
          </DialogPrimitive.Description>
        )}
      </div>
      {/* No tooltip: in a dialog without fields this button takes focus first, and an open tooltip would
          take the first Escape for itself */}
      <DialogPrimitive.Close
        render={
          <Button variant="ghost" size="icon-sm" aria-label={closeLabel}>
            <Icon icon={X} size="sm" />
          </Button>
        }
      />
    </div>
  );
}

export type DialogBodyProps = ComponentProps<'div'>;

/**
 * The part of a dialog that scrolls. It tells the footer when content is cut off below (`data-cut`), which
 * is when the footer shows its top border. An error of the server that belongs to no field goes first, as
 * a `FormAlert`.
 */
export function DialogBody({ className, children, ref, ...props }: DialogBodyProps): ReactElement {
  const [cut, setCut] = useState(false);
  // A ref callback measures when the body mounts, on every scroll, and whenever its box or its content
  // changes. It also hands the element to the caller.
  const watch = useCallback(
    (node: HTMLDivElement | null): (() => void) | undefined => {
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
      if (!node) return undefined;
      const update = (): void => setCut(node.scrollHeight - node.scrollTop - node.clientHeight > 1);
      update();
      node.addEventListener('scroll', update, { passive: true });
      const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
      observer?.observe(node);
      if (node.firstElementChild) observer?.observe(node.firstElementChild);
      return () => {
        node.removeEventListener('scroll', update);
        observer?.disconnect();
        if (typeof ref === 'function') ref(null);
        else if (ref) ref.current = null;
      };
    },
    [ref],
  );
  return (
    <div
      data-slot="dialog-body"
      {...props}
      ref={watch}
      data-cut={cut ? '' : undefined}
      className={cn('peer min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6', className)}
    >
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

export interface DialogFooterProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The one primary button. Its label is the verb and the object: "Add competitor". */
  primary: ReactNode;
  /** "Cancel", inside `DialogClose`. */
  secondary?: ReactNode | undefined;
  /** At the left edge: "Back" in a multi-step dialog. */
  start?: ReactNode | undefined;
}

export function DialogFooter({ primary, secondary, start, className, ...props }: DialogFooterProps): ReactElement {
  return (
    <div
      data-slot="dialog-footer"
      {...props}
      className={cn(
        'flex shrink-0 items-center gap-2 border-t border-transparent px-6 py-4 peer-data-cut:border-border-subtle',
        className,
      )}
    >
      {start}
      <div className="ml-auto flex items-center gap-2">
        {secondary}
        {primary}
      </div>
    </div>
  );
}

/** Makes a button close the dialog the way the Close button does, so a dirty dialog asks first. */
export function DialogClose({ children }: { children: ReactElement }): ReactElement {
  return <DialogPrimitive.Close render={children} />;
}
