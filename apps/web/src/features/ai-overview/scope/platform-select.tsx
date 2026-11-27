'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { EngineMark } from '@/components/app/engine/engine-logo';
import { cn } from '@/lib/utils';
import { Select, type SelectOption } from '@/components/ui/select';

/** A platform the project has on: the API's code and its name. */
export interface PlatformChoice {
  code: string;
  label: string;
}

/** The value of "All platforms" in the select; it is never an engine code. */
const ALL = 'all';

export interface PlatformSelectProps {
  /** Only the platforms that are on, in the order the page lists them. A platform that is off is never offered. */
  platforms: readonly PlatformChoice[];
  /** The code chosen, or `null` for All platforms. */
  selected: string | null;
  /** The new choice: a code, or `null` for All platforms. */
  onChange: (selected: string | null) => void;
  className?: string | undefined;
}

/**
 * The Platform of the page: All platforms or one platform, each with its mark. Google AI Overview is offered like
 * the others while it is on, and never while it is off. A single choice, so a card never has to average over an
 * arbitrary subset.
 */
export function PlatformSelect({ platforms, selected, onChange, className }: PlatformSelectProps): ReactElement {
  const t = useTranslations('aiOverview.shell');
  const options = useMemo((): SelectOption<string>[] => {
    return [
      { value: ALL, label: t('allPlatforms') },
      ...platforms.map((platform) => ({
        value: platform.code,
        label: platform.label,
        icon: <EngineMark engine={platform.code} />,
      })),
    ];
  }, [platforms, t]);
  const value = platforms.some((platform) => platform.code === selected) && selected !== null ? selected : ALL;
  const current = options.find((option) => option.value === value);
  return (
    <Select<string>
      value={value}
      onValueChange={(next) => onChange(next === ALL ? null : next)}
      placeholder={t('allPlatforms')}
      options={options}
      aria-label={t('platformLabel', { platform: current?.label ?? t('allPlatforms') })}
      className={cn('hover:bg-surface-hover data-popup-open:bg-surface-selected', className)}
    />
  );
}
