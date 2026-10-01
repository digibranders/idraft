'use client';

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { Field as FieldPrimitive } from '@base-ui/react/field';
import { useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';

import { Button } from './button';
import { Field } from './field';
import { FormAlert } from './form-alert';
import { Input } from './input';
import { cn } from '@/lib/utils';

const BACKDROP = cn(
  'fixed inset-0 z-(--z-dialog) bg-(--scrim) transition-opacity duration-(--duration-slow) ease-standard data-ending-style:opacity-0 data-ending-style:duration-(--duration-base) data-ending-style:ease-exit data-starting-style:opacity-0',
);
/**
 * An alert dialog stays a centered 400 px card at every width (19-responsive-behavior.md section 9). It
 * appears with an 8 px move and leaves by fading only (21-motion.md section 4.3).
 */
const POPUP = cn(
  'fixed top-[max(12vh,3rem)] left-1/2 z-(--z-dialog) flex max-h-[calc(100dvh-12vh-3rem)] w-[min(var(--container-dialog-sm),calc(100vw-2rem))] -translate-x-1/2 flex-col rounded-xl bg-surface-elevated shadow-dialog transition-[opacity,translate] duration-(--duration-slow) ease-standard outline-none data-ending-style:opacity-0 data-ending-style:duration-(--duration-base) data-ending-style:ease-exit data-starting-style:translate-y-2 data-starting-style:opacity-0',
);

interface AlertShellProps {
  open: boolean;
  /** Escape asks to close. There is no Close button and a click on the scrim does nothing. */
  onDismiss: () => void;
  title: string;
  description: string;
  /** The field or the error line between the text and the buttons. */
  body?: ReactNode;
  /** The button that takes focus when the dialog opens: the safe choice. */
  safe: { label: string; onPress: () => void; disabled?: boolean | undefined };
  action: ReactElement;
  slot: 'confirm-dialog' | 'discard-changes-dialog';
  finalFocus?: RefObject<HTMLElement | null> | undefined;
}

function AlertShell({
  open,
  onDismiss,
  title,
  description,
  body,
  safe,
  action,
  slot,
  finalFocus,
}: AlertShellProps): ReactElement {
  const safeButton = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      {/* A select or a menu opened inside the dialog has to come out above it */}
      <AlertDialogPrimitive.Portal className="[--z-dropdown:var(--z-dialog)]">
        <AlertDialogPrimitive.Backdrop
          data-slot="dialog-scrim"
          // A press on the scrim does nothing, so it must not take focus out of the dialog either
          onMouseDown={(event) => event.preventDefault()}
          className={BACKDROP}
        />
        <AlertDialogPrimitive.Popup
          data-slot={slot}
          initialFocus={safeButton}
          {...(finalFocus === undefined ? {} : { finalFocus })}
          className={POPUP}
        >
          <div className="flex flex-col gap-1 px-6 pt-6 pb-4">
            <AlertDialogPrimitive.Title className="type-section-title">{title}</AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="type-body text-foreground-secondary">
              {description}
            </AlertDialogPrimitive.Description>
          </div>
          {body === undefined || body === null ? null : (
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-2">{body}</div>
          )}
          <div className="flex shrink-0 items-center justify-end gap-2 px-6 py-4">
            <Button ref={safeButton} disabled={safe.disabled} onClick={safe.onPress}>
              {safe.label}
            </Button>
            {action}
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export interface TypeToConfirmFieldProps {
  /** What has to be typed: the slug of the project or the workspace. */
  expected: string;
  /** "Type acme-crm to confirm", with the expected value in the mono style. */
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
}

/** Whether the typed value is the expected one: exact case, spaces around it ignored. */
export const matchesConfirmation = (value: string, expected: string): boolean => value.trim() === expected;

/**
 * The field of a typed confirmation. Only the irreversible deletion of a project or a workspace asks for
 * it; every other deletion, however large, uses the plain `ConfirmDialog` (16 section 4.5).
 */
export function TypeToConfirmField({ expected, label, value, onValueChange }: TypeToConfirmFieldProps): ReactElement {
  return (
    <Field data-slot="type-to-confirm" data-expected={expected}>
      <FieldPrimitive.Label className="type-label">{label}</FieldPrimitive.Label>
      <Input
        value={value}
        onValueChange={onValueChange}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="type-mono"
      />
    </Field>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Delete 12 keywords?" */
  title: string;
  /** What is lost, when, and the reversible alternative if there is one. */
  description: string;
  /** Repeats the verb and the count: "Delete 12 keywords". Never "OK" or "Yes". */
  confirmLabel: string;
  /** "Cancel". */
  cancelLabel: string;
  /**
   * Runs the action. When it resolves the dialog closes. When it rejects the dialog stays open, and the
   * caller says why through `error`.
   */
  onConfirm: () => Promise<void> | void;
  /** Why the action failed, shown above the buttons. */
  error?: string | null | undefined;
  /** For the irreversible deletion of a project or a workspace only. */
  typedConfirmation?: { expected: string; label: ReactNode } | undefined;
  /** `neutral` for a confirmation that destroys nothing, such as "Stay signed in". */
  tone?: 'destructive' | 'neutral' | undefined;
  /**
   * Where focus goes when the dialog closes; by default back to what opened it. Set it once the action
   * removed that control (a row and its button), so focus does not fall to the page (16 section 6).
   */
  finalFocus?: RefObject<HTMLElement | null> | undefined;
}

/**
 * Asks before a destructive or irreversible action (16-drawers-dialogs-popovers.md section 4.5). Focus
 * starts on Cancel, Escape cancels, a click outside does nothing and there is no Close button. Reversible
 * actions do not confirm: they run at once and offer Undo in a toast.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  error,
  typedConfirmation,
  tone = 'destructive',
  finalFocus,
}: ConfirmDialogProps): ReactElement {
  const [pending, setPending] = useState(false);
  const [typed, setTyped] = useState('');
  // What was typed is forgotten when the dialog opens again, not when it closes: the field would empty
  // while the dialog is still fading out
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setTyped('');
  }
  const close = (): void => {
    if (!pending) onOpenChange(false);
  };
  const confirm = async (): Promise<void> => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The dialog stays open with what was typed. The caller knows the failure and shows it through `error`.
    } finally {
      setPending(false);
    }
  };
  const blocked = typedConfirmation !== undefined && !matchesConfirmation(typed, typedConfirmation.expected);
  const hasBody = typedConfirmation !== undefined || Boolean(error);
  return (
    <AlertShell
      slot="confirm-dialog"
      open={open}
      finalFocus={finalFocus}
      onDismiss={close}
      title={title}
      description={description}
      body={
        hasBody ? (
          <>
            {typedConfirmation ? (
              <TypeToConfirmField
                expected={typedConfirmation.expected}
                label={typedConfirmation.label}
                value={typed}
                onValueChange={setTyped}
              />
            ) : null}
            {error ? <FormAlert message={error} /> : null}
          </>
        ) : undefined
      }
      safe={{ label: cancelLabel, onPress: close, disabled: pending }}
      action={
        <Button
          variant={tone === 'destructive' ? 'destructive-solid' : 'primary'}
          disabled={blocked}
          loading={pending}
          onClick={() => void confirm()}
        >
          {confirmLabel}
        </Button>
      }
    />
  );
}

export interface DiscardChangesDialogProps {
  open: boolean;
  /** "Discard unsaved changes?" */
  title: string;
  /** "Your changes to this competitor will be lost." */
  description: string;
  /** "Keep editing". It takes focus when the dialog opens. */
  keepEditingLabel: string;
  /** "Discard changes". */
  discardLabel: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
}

/**
 * Asks before unsaved edits are lost: a dirty dialog, a dirty inspector section, leaving a settings page
 * (10-forms.md section 13.2). It may open above a dialog, which is the one allowed level of stacking. The
 * "Discard" button of a save bar does not ask.
 */
export function DiscardChangesDialog({
  open,
  title,
  description,
  keepEditingLabel,
  discardLabel,
  onKeepEditing,
  onDiscard,
}: DiscardChangesDialogProps): ReactElement {
  return (
    <AlertShell
      slot="discard-changes-dialog"
      open={open}
      onDismiss={onKeepEditing}
      title={title}
      description={description}
      safe={{ label: keepEditingLabel, onPress: onKeepEditing }}
      action={
        <Button variant="destructive-solid" onClick={onDiscard}>
          {discardLabel}
        </Button>
      }
    />
  );
}
