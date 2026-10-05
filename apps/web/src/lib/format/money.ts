/**
 * A money string of the API as a number, or `null` when it is not one. The API sends money as decimal
 * strings with six places ("12.400000"), never as floats; sums of a screen's rows are fine as numbers at the
 * sizes the screens hold.
 */
export function money(value: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  return Number(value);
}
