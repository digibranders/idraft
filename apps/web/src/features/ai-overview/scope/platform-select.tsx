'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { engineMark } from '@/components/app/engine/marks';
import { Select, type SelectOption } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** A platform the project has on: the API's code and its name. */
export interface PlatformChoice {
  code: string;
  label: string;
}

/** The value of "All platforms" in the select; it is never an engine code. */
const ALL = 'all';
/** The platform the API does not offer yet: listed so people see it is coming, never chosen. */
const AI_OVERVIEW = 'google_ai_overview';

export interface PlatformSelectProps {
  /** Only the platforms that are on, in the order the page lists them. A platform that is off is never offered. */
  platforms: readonly PlatformChoice[];
  /** The code chosen, or `null` for All platforms. */
  selected: string | null;
  /** The new choice: a code, or `null` for All platforms. */
  onChange: (selected: string | null) => void;
  className?: string | undefined;
}

/** The vendor's mark, which names nothing by itself (the option's label does). */
function Mark({ code }: { code: string }): ReactElement | null {
  const mark = engineMark(code);
  if (mark === null) return null;
  return (
    <>
      {/* A fixed 16 px box, so a row never shifts while the mark loads; a static SVG has nothing for next/image to optimize */}
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img
        src={mark.src}
        alt=""
        width={16}
        height={16}
        className={cn('size-icon', mark.followsText && 'dark:invert')}
      />
    </>
  );
}

/**
 * The Platform of the page: All platforms or one platform, each with its mark. AI Overview is listed as not
 * available, because the API collects three platforms. A single choice, so a card never has to average over an
 * arbitrary subset.
 */
export function PlatformSelect({ platforms, selected, onChange, className }: PlatformSelectProps): ReactElement {
  const t = useTranslations('aiOverview.shell');
  const options = useMemo((): SelectOption<string>[] => {
    const list: SelectOption<string>[] = [
      { value: ALL, label: t('allPlatforms') },
      ...platforms.map((platform) => ({
        value: platform.code,
        label: platform.label,
        icon: <Mark code={platform.code} />,
      })),
    ];
    if (!platforms.some((platform) => platform.code === AI_OVERVIEW)) {
      list.push({
        value: AI_OVERVIEW,
        label: t('platformAiOverview'),
        description: t('platformUnavailable'),
        disabled: true,
        icon: <Mark code={AI_OVERVIEW} />,
      });
    }
    return list;
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
      className={className}
    />
  );
}
