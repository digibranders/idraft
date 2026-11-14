'use client';

import { TriangleAlert } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';
import type { Control } from 'react-hook-form';

import type { AddValues } from './add-values';
import { engineCountryCounts, engineSettingsHref } from './market-model';
import { countriesForEngines } from '../prompt-model';
import { FormField } from '@/components/app/forms/form-field';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { TextLink } from '@/components/ui/text-link';
import type { ProjectEngine } from '@/lib/api/types';
import { formatList } from '@/lib/format';
import { LANGUAGE_CODES, languageName } from '@/lib/format/language';
import type { Country } from '@/lib/locations/countries';

export interface MarketFieldsProps {
  control: Control<AddValues>;
  /** The project's enabled engines: the countries they all ask in are the ones offered. */
  engines: readonly ProjectEngine[];
  /** Every country the API lists. */
  countries: readonly Country[];
  /** The list could not be read; `onRetry` asks again. */
  countriesFailed: boolean;
  onRetry: () => void;
}

function EngineSettingsLink({ href }: { href: Route | null }): ReactElement | null {
  const t = useTranslations('prompts.add');
  if (href === null) return null;
  return (
    <TextLink variant="inline" render={<Link href={href} target="_blank" rel="noopener noreferrer" />}>
      {t('engineSettings')} <span className="sr-only">{t('newTab')}</span>
    </TextLink>
  );
}

/**
 * Country first, then language (prompt-dialogs 4.1, 4.6): the country decides what is offered, so it comes first.
 * Under them, which countries each engine asks in with a link to the engine settings, and a warning that does not
 * block when no engine is on. A countries list that could not be read says so under the fields, with a retry.
 */
export function MarketFields({
  control,
  engines,
  countries,
  countriesFailed,
  onRetry,
}: MarketFieldsProps): ReactElement {
  const t = useTranslations('prompts.add');
  const common = useTranslations('common');
  const locale = useLocale();
  const settingsHref = engineSettingsHref(usePathname());
  const countryOptions = useMemo(
    () =>
      countriesForEngines(engines, countries).map((country) => ({ value: country.country_iso, label: country.name })),
    [engines, countries],
  );
  const languageOptions = useMemo(
    () => LANGUAGE_CODES.map((code) => ({ value: code, label: languageName(code, locale) })),
    [locale],
  );
  const reach = engineCountryCounts(engines, countries).map((entry) =>
    t('engineReach', { engine: entry.label, count: entry.count }),
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="country_iso"
          label={t('country')}
          render={(field) => (
            <Select<string>
              {...field.controlProps}
              // A project country no enabled engine asks in is not offered, so it is not shown as chosen
              value={countryOptions.some((option) => option.value === field.value) ? field.value : null}
              onValueChange={field.onChange}
              placeholder={t('country')}
              options={countryOptions}
            />
          )}
        />
        <FormField
          control={control}
          name="language_code"
          label={t('language')}
          render={(field) => (
            <Select<string>
              {...field.controlProps}
              value={field.value}
              onValueChange={field.onChange}
              placeholder={t('language')}
              options={languageOptions}
            />
          )}
        />
      </div>
      {countriesFailed ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="flex-1 type-meta text-negative-text">
            {t('countriesFailed')}
          </p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {common('retry')}
          </Button>
        </div>
      ) : null}
      {engines.length === 0 ? (
        <p className="flex items-start gap-1.5 type-meta text-warning-text">
          <Icon icon={TriangleAlert} size="sm" className="mt-0.5" />
          <span>
            {t('noEngineWarning')} <EngineSettingsLink href={settingsHref} />
          </span>
        </p>
      ) : (
        <p className="type-meta text-foreground-secondary">
          {t('countryHintEngines', { reach: formatList(reach, locale) })} <EngineSettingsLink href={settingsHref} />
        </p>
      )}
    </div>
  );
}
