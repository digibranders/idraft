/* global document, setTimeout */
/**
 * The native <dialog> frame of the Rankings screens (16-drawers-dialogs-popovers.md section 4): a title, a body and
 * a footer, sized by a design token (`sm` 400 px, `md` 560 px, `lg` 720 px). The body is a plain div, not a form,
 * so Enter in a field never closes the dialog; each screen decides what submits.
 */
import { BUTTON, BUTTON_PRIMARY, button, iconButton } from './perf-ui.js';
import { el } from './prompts-parts.js';

export const BUTTON_DANGER = 'h-control px-3 rounded-md bg-negative-button text-negative-button-foreground type-body-strong flex items-center gap-2 whitespace-nowrap hover:bg-negative-button-hover disabled:bg-surface-disabled disabled:text-foreground-disabled';
export const PRIMARY_DISABLED = `${BUTTON_PRIMARY} disabled:bg-surface-disabled disabled:text-foreground-disabled`;
export const FIELD_LABEL = 'flex flex-col gap-1.5 min-w-0';
export const INPUT = 'h-control px-3 rounded-md border border-border bg-surface type-body text-foreground placeholder:text-foreground-tertiary w-full min-w-0';

/**
 * @param {{title: string, description?: string, width?: 'sm'|'md'|'lg', role?: string, onCancel?: () => boolean, onClose?: () => void}} options
 * `onCancel` returns false to keep the dialog open (for example while a half-made import would be lost).
 * @returns {{dialog: HTMLDialogElement, body: HTMLElement, footer: HTMLElement, close: () => void}}
 */
// Whole class names, so Tailwind compiles them (a built name would be missed).
const WIDTH = {
  sm: 'max-w-(--container-dialog-sm)',
  md: 'max-w-(--container-dialog-md)',
  lg: 'max-w-(--container-dialog-lg)',
};

export function openDialog({ title, description, width = 'md', role = 'dialog', onCancel, onClose }) {
  const dialog = el('dialog', `m-auto rounded-xl border border-border bg-surface text-foreground shadow-dialog p-0 w-full ${WIDTH[width]} backdrop:bg-(--scrim)`);
  dialog.setAttribute('role', role);
  const shell = el('div', 'flex flex-col');
  shell.style.maxHeight = '85dvh';
  const head = el('header', 'px-4 py-3 border-b border-border flex items-start gap-3');
  const text = el('div', 'min-w-0 flex-1 flex flex-col gap-1');
  const heading = el('h2', 'type-section-title', title);
  heading.id = `kw-dialog-${Math.random().toString(36).slice(2, 8)}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  text.append(heading);
  if (description) text.append(el('p', 'type-body text-foreground-secondary', description));
  // Cleanup runs once, from whichever path closes the dialog: our close, or the native close event (Escape).
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onClose?.();
    dialog.remove();
  };
  const close = () => {
    dialog.close();
    finish();
  };
  // The header close and Escape both ask onCancel first, so a half-made import can ask before it is lost.
  const dismiss = () => {
    if (onCancel?.() !== false) close();
  };
  head.append(text, iconButton('x', 'Close', dismiss));
  const body = el('div', 'flex-1 min-h-0 overflow-auto px-4 py-4 flex flex-col gap-3');
  const footer = el('footer', 'px-4 py-3 border-t border-border flex items-center gap-2 flex-wrap');
  shell.append(head, body, footer);
  dialog.append(shell);
  // Escape goes through `dismiss` here. A page cannot always cancel the browser's own close request, so a draft
  // could close unasked; stopping the keydown keeps the question in our hands.
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener('cancel', (event) => {
    if (onCancel && onCancel() === false) {
      event.preventDefault();
      return;
    }
    setTimeout(() => {
      if (!dialog.open) finish();
    }, 0);
  });
  dialog.addEventListener('close', finish);
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, body, footer, close, dismiss };
}

/**
 * A small alert question: a cancel and one confirming action (`danger` for the destructive ones). `onKeep` runs
 * when the person backs out (the cancel button, the close button or Escape), so a caller can put the page back.
 */
export function confirmDialog({ title, description, confirmLabel, cancelLabel = 'Cancel', danger = false, onConfirm, onKeep }) {
  const frame = openDialog({ title, description, width: 'sm', role: 'alertdialog', onCancel: () => {
    onKeep?.();
  } });
  const cancel = button(cancelLabel, { className: BUTTON, onClick: () => {
    frame.close();
    onKeep?.();
  } });
  const confirm = button(confirmLabel, { className: danger ? BUTTON_DANGER : BUTTON_PRIMARY, onClick: () => {
    frame.close();
    onConfirm();
  } });
  frame.footer.append(cancel, confirm);
  // A destructive question starts on the safe answer, so Enter does not discard.
  (danger ? cancel : confirm).focus();
  return frame;
}

/** The "Discard unsaved changes?" question, in the same frame as the other confirmations. */
export function confirmDiscard(message, onDiscard) {
  return confirmDialog({ title: 'Discard unsaved changes?', description: message, confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true, onConfirm: onDiscard });
}

/** A labelled field: the label sits above the control, the hint and the error below it (09 section 4). */
export function field(label, control, { hint, error } = {}) {
  const wrap = el('label', FIELD_LABEL);
  wrap.append(el('span', 'type-label text-foreground', label), control);
  if (hint) wrap.append(el('span', 'type-meta text-foreground-tertiary', hint));
  if (error) wrap.append(el('span', 'type-meta text-negative-text', error));
  return wrap;
}

export function fieldError(text) {
  const node = el('p', 'type-meta text-negative-text', text);
  node.setAttribute('role', 'alert');
  return node;
}
