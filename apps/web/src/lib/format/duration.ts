/**
 * Elapsed time. The only permitted way to turn a span of milliseconds into display text.
 * Spec: docs/design-system/22-content-formatting.md section 2.
 */

import { EMPTY_VALUE } from './number';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A span as its two largest units: 800 -> "<1 s", 45 000 -> "45 s", 192 000 -> "3 min 12 s",
 * 3 900 000 -> "1 h 5 min", 98 000 000 -> "1 d 3 h". A unit that is zero is left out ("2 min", not "2 min 0 s").
 * A span that is not a finite, non-negative number reads "n/a".
 */
export function formatDuration(milliseconds: number | null | undefined): string {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) return EMPTY_VALUE;
  if (milliseconds < SECOND) return '<1 s';
  const seconds = Math.round(milliseconds / SECOND);
  const total = seconds * SECOND;
  const days = Math.floor(total / DAY);
  const hours = Math.floor((total % DAY) / HOUR);
  const minutes = Math.floor((total % HOUR) / MINUTE);
  const rest = seconds % 60;
  const units: [number, string][] =
    days > 0
      ? [
          [days, 'd'],
          [hours, 'h'],
        ]
      : hours > 0
        ? [
            [hours, 'h'],
            [minutes, 'min'],
          ]
        : [
            [minutes, 'min'],
            [rest, 's'],
          ];
  // At least one second has passed, so one of the two units is never zero
  return units
    .filter(([count]) => count > 0)
    .map(([count, unit]) => `${count} ${unit}`)
    .join(' ');
}
