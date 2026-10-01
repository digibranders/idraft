/**
 * Names a combobox's list after its field. Base UI names the text field by the field's label but leaves the
 * list unnamed, which a screen reader announces as a bare "list box". When the list mounts, it takes the
 * `aria-labelledby` of the text field inside `field` (the element around the text field).
 */
export function nameListAfterField(field: HTMLElement | null, list: HTMLElement | null): void {
  if (field === null || list === null || list.hasAttribute('aria-label')) return;
  const label = field.querySelector('input')?.getAttribute('aria-labelledby');
  if (label !== null && label !== undefined && label !== '') list.setAttribute('aria-labelledby', label);
}
