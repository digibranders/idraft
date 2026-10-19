/**
 * Copies text to the clipboard (09-buttons-controls.md section 9.1). The Clipboard API is tried first. It is
 * missing outside a secure context and rejects without the permission or the focus, so a temporary field is
 * selected and copied as a second try. Resolves `false` when neither worked, and the caller says so. The text
 * is copied exactly as given: no trimming, and line breaks and quotes stay.
 */
export async function copyText(text: string): Promise<boolean> {
  if ('clipboard' in navigator && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused or not allowed here: the selection below may still be
    }
  }
  return copyBySelection(text);
}

/**
 * The older way: a read-only field outside the view, selected and copied. Focus and the person's own
 * selection are put back, since the field takes both for the moment it exists. The field is put beside the
 * element that has focus, not at the end of the page, so focus moves only within the part of the page it
 * was in: a table that watches where focus goes (a cell in widget mode) does not see it leave.
 */
function copyBySelection(text: string): boolean {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, index) => selection?.getRangeAt(index));
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.tabIndex = -1;
  field.setAttribute('aria-hidden', 'true');
  Object.assign(field.style, { position: 'fixed', top: '0', left: '-9999px', opacity: '0' });
  // The body has focus when nothing does, and its parent is the document element, which is no place for a field
  const host =
    previous === null || previous === document.body ? document.body : (previous.parentElement ?? document.body);
  host.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    previous?.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) if (range !== undefined) selection?.addRange(range);
  }
}
