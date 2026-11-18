'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { PlatformMark } from './platform-mark';
import { byEngineOrder } from '@/components/app/engine/order';
import type { FilterValues } from '@/components/app/filters/types';
import { Select, type SelectOption } from '@/components/ui/select';
import type { ProjectEngine } from '@/lib/api/types';
import { enumValuesOf } from '@/lib/filters/filter-values';

/** The values of the choices that are not a platform: every platform, and a set of two or more of them. */
const ALL = 'all';
const SET = 'set';
/** The platform the API does not offer yet: listed, never chosen. */
const AI_OVERVIEW = 'google_ai_overview';

/**
 * Which choice a list of platform codes is, among the platforms that are on: none or all of them is "all", one is that
 * platform, two or more is a set. Codes of a platform that is off count for nothing, as they do for the table.
 */
export function platformChoice(chosen: readonly string[], enabled: readonly string[]): string {
  const known = chosen.filter((code) => enabled.includes(code));
  if (known.length === 0 || known.length === enabled.length) return ALL;
  return known.length === 1 ? (known[0] ?? ALL) : SET;
}

/**
 * `values` without the Platform filter when it names every platform that is on: that is All platforms, which has no
 * chip and nothing to clear. The same object when there is nothing to take out (and always while no platform is known,
 * since a link's platforms wait for the list of them).
 */
export function withoutFullPlatformSet(values: FilterValues, enabled: readonly string[]): FilterValues {
  const chosen = enumValuesOf(values['engine']);
  if (enabled.length === 0 || chosen.length === 0 || !enabled.every((code) => chosen.includes(code))) return values;
  return Object.fromEntries(Object.entries(values).filter(([id]) => id !== 'engine'));
}

export interface PlatformSelectProps {
  /** The platforms that are on, which the select offers. */
  engines: readonly ProjectEngine[];
  /** The platform codes the Platform filter holds; none is every platform. */
  chosen: readonly string[];
  /** The new list: `[]` for every platform, one code for one. */
  onChange: (codes: readonly string[]) => void;
}

/**
 * The Platform select of the Prompts page (the first control of its row): All platforms, or one platform, with the
 * platform's mark. It writes the page's Platform filter, so its choice is the filter's value; a set of two or more,
 * which only the filter's chip can make, shows as its count and keeps its chip. The name of the control is the only
 * label ("Platform"): the trigger shows the choice alone.
 */
export function PlatformSelect({ engines, chosen, onChange }: PlatformSelectProps): ReactElement {
  const t = useTranslations('prompts.shell.platform');
  const words = useTranslations('prompts.platformSelect');
  const ordered = useMemo(() => byEngineOrder(engines, (engine) => engine.engine.engine_code), [engines]);
  const enabled: readonly string[] = ordered.map((engine) => engine.engine.engine_code);
  const value = platformChoice(chosen, enabled);
  const setSize = chosen.filter((code) => enabled.includes(code)).length;
  const options: SelectOption<string>[] = [
    { value: ALL, label: t('all'), icon: <PlatformMark code={null} /> },
    ...ordered.map((engine) => ({
      value: engine.engine.engine_code,
      label: engine.engine.label,
      icon: <PlatformMark code={engine.engine.engine_code} />,
    })),
    // Listed as the Overview's select lists it, so people see it is coming: the API does not collect it yet
    ...(enabled.includes(AI_OVERVIEW)
      ? []
      : [
          {
            value: AI_OVERVIEW,
            label: words('aiOverview'),
            description: words('unavailable'),
            disabled: true,
            icon: <PlatformMark code={AI_OVERVIEW} />,
          },
        ]),
    // Only while the filter holds a set: it is shown, not offered
    ...(value === SET ? [{ value: SET, label: t('set', { count: setSize }), icon: <PlatformMark code={null} /> }] : []),
  ];
  const chosenLabel = options.find((option) => option.value === value)?.label ?? t('all');
  return (
    <Select<string>
      aria-label={words('trigger', { value: chosenLabel })}
      listLabel={words('list')}
      size="sm"
      value={value}
      placeholder={t('label')}
      options={options}
      onValueChange={(next) => {
        if (next === SET) return;
        onChange(next === ALL ? [] : [next]);
      }}
    />
  );
}
