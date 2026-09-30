'use client';

import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useId, type ReactNode } from 'react';

import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { SettingRow } from '@/components/ui/setting-row';
import { Switch } from '@/components/ui/switch';
import { useHydrated } from '@/lib/dom/use-hydrated';
import { formatLocaleDate } from '@/lib/format/date';
import { formatDecimal } from '@/lib/format/number';
import { PREFERENCE_LOCALES, usePreferences, type PreferenceLocale } from '@/lib/preferences/preferences';
import { useMe } from '@/lib/session/use-me';

type ThemeChoice = 'system' | 'light' | 'dark';
const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
const isTheme = (value: string | undefined): value is ThemeChoice => THEMES.some((theme) => theme === value);

/** The catalog key of each format's name (catalog keys are camelCase). */
const LOCALE_KEYS: Readonly<Record<PreferenceLocale, 'enUS' | 'enGB' | 'deDE'>> = {
  'en-US': 'enUS',
  'en-GB': 'enGB',
  'de-DE': 'deDE',
};

/** The number and the date the format example shows. */
const EXAMPLE_NUMBER = 1234.5;
const EXAMPLE_DATE = new Date(Date.UTC(2026, 8, 30));

/** The example of a format: a number and a date written the way `locale` writes them. */
/** The example number and date in `locale`, which the catalog puts into its sentence. */
function exampleOf(locale: PreferenceLocale): { number: string; date: string } {
  return {
    number: formatDecimal(EXAMPLE_NUMBER, 1, { locale }),
    date: formatLocaleDate(EXAMPLE_DATE, locale, 'UTC'),
  };
}

/**
 * Settings > Preferences (11-navigation.md section 5): each control saves at once, with no save bar (10-forms.md
 * section 13.3). The theme is next-themes' own, for this device; the others are kept in this browser under
 * the person's id and cleared when they sign out.
 */
export function PreferencesScreen(): ReactNode {
  const t = useTranslations('account.preferences');
  const { user } = useMe();
  const [preferences, setPreference] = usePreferences(user.user_id);
  const { theme, setTheme } = useTheme();
  // The server does not know the stored theme, so the control shows System until the page has hydrated
  const hydrated = useHydrated();
  const localeLabel = useId();
  return (
    <section aria-labelledby="preferences-title" className="flex flex-col gap-5">
      <div>
        <h2 id="preferences-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">{t('description')}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <SegmentedControl<ThemeChoice>
          semantics="radio"
          label={t('theme')}
          value={hydrated && isTheme(theme) ? theme : 'system'}
          onValueChange={setTheme}
          items={[
            { value: 'system', label: t('themes.system') },
            { value: 'light', label: t('themes.light') },
            { value: 'dark', label: t('themes.dark') },
          ]}
        />
        <p className="type-meta">{t('themeHint')}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <SegmentedControl<'default' | 'compact'>
          semantics="radio"
          label={t('density')}
          value={preferences.density}
          onValueChange={(density) => setPreference('density', density)}
          items={[
            { value: 'default', label: t('densityDefault') },
            { value: 'compact', label: t('densityCompact') },
          ]}
        />
        <p className="type-meta">{t('densityHint')}</p>
      </div>
      <div className="flex max-w-90 flex-col gap-1.5">
        <label id={localeLabel} htmlFor={`${localeLabel}-select`} className="type-label">
          {t('locale')}
        </label>
        <Select<PreferenceLocale>
          id={`${localeLabel}-select`}
          value={preferences.locale}
          placeholder={t('locale')}
          onValueChange={(locale) => setPreference('locale', locale)}
          options={PREFERENCE_LOCALES.map((locale) => ({ value: locale, label: t(`locales.${LOCALE_KEYS[locale]}`) }))}
        />
        <p className="num type-meta">{t('example', exampleOf(preferences.locale))}</p>
      </div>
      <div className="pt-2">
        <h3 className="type-subsection-title">{t('motionAndKeys')}</h3>
        <div className="mt-2 flex flex-col">
          <SettingRow
            label={t('reduceMotion')}
            description={t('reduceMotionHint')}
            control={
              <Switch checked={preferences.reduceMotion} onCheckedChange={(on) => setPreference('reduceMotion', on)} />
            }
          />
          <SettingRow
            label={t('singleKeys')}
            description={t('singleKeysHint')}
            control={
              <Switch checked={preferences.singleKeys} onCheckedChange={(on) => setPreference('singleKeys', on)} />
            }
          />
        </div>
      </div>
    </section>
  );
}
