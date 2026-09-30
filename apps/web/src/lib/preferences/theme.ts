/**
 * The theme a person chooses (01-foundations.md section 3): System follows the device. next-themes keeps the
 * choice per device under its own key, so it is not among the per-user preferences of `preferences.ts`.
 */
export const THEME_CHOICES = ['system', 'light', 'dark'] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** Whether `value`, as next-themes reports it, is one of the three choices. */
export const isThemeChoice = (value: string | undefined): value is ThemeChoice =>
  THEME_CHOICES.some((choice) => choice === value);
