'use client';

import { ChevronDown, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, type ReactElement } from 'react';

import { DEVICES, PERIODS, type CannState, type Device, type Period } from './cann-model';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { inputVariants } from '@/components/ui/input-variants';
import { Select, type SelectOption } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface GroupChoice {
  id: string;
  name: string;
}

export interface ScopeToolbarProps {
  state: Pick<CannState, 'device' | 'group' | 'days'>;
  /** The project's keyword groups; `null` while they load. */
  groups: readonly GroupChoice[] | null;
  isDefaultScope: boolean;
  onChange: (patch: Partial<CannState>) => void;
  onReset: () => void;
}

const PERIOD_KEY = { 14: 'days14', 30: 'days30', 90: 'days90' } as const satisfies Record<Period, string>;

// Constants, not literals in the JSX: the i18n rule reads `className` strings as visible text
const TRIGGER_STATES = cn('whitespace-nowrap hover:bg-surface-hover aria-expanded:bg-surface-hover');
const DEVICE_TRIGGER = cn(TRIGGER_STATES, 'w-full min-w-0 sm:w-36');
const PERIOD_TRIGGER = cn(TRIGGER_STATES, 'w-full min-w-0 sm:w-44');
const GROUP_TRIGGER = cn(
  inputVariants({ variant: 'outline', size: 'md' }),
  'flex w-full max-w-full min-w-0 items-center gap-2 text-left sm:w-56',
  TRIGGER_STATES,
);

/**
 * The scope toolbar (docs/33 section 7.1): Device, Group and Period, as a two column grid below 1024 px and a wrapping
 * row from it. The page's own Period and Device replace the shell's date range and country, which this page hides.
 */
export function ScopeToolbar({ state, groups, isDefaultScope, onChange, onReset }: ScopeToolbarProps): ReactElement {
  const t = useTranslations('cannibalization');
  const first = useRef<HTMLButtonElement>(null);

  const deviceOptions = useMemo(
    (): readonly SelectOption<Device>[] => DEVICES.map((value) => ({ value, label: t(`toolbar.${value}`) })),
    [t],
  );
  const periodOptions = useMemo(
    (): readonly SelectOption<string>[] =>
      PERIODS.map((value) => ({ value: String(value), label: t(`toolbar.${PERIOD_KEY[value]}`) })),
    [t],
  );
  const everyGroup = useMemo((): GroupChoice => ({ id: 'all', name: t('toolbar.allGroups') }), [t]);
  const choices = useMemo((): readonly GroupChoice[] => [everyGroup, ...(groups ?? [])], [everyGroup, groups]);
  const group = choices.find((choice) => choice.id === state.group) ?? everyGroup;
  const deviceLabel = t(`toolbar.${state.device}`);
  const periodLabel = t(`toolbar.${PERIOD_KEY[state.days]}`);

  return (
    <section aria-label={t('toolbar.label')} className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="sr-only">{t('title')}</h1>
      <div
        role="group"
        aria-label={t('toolbar.scope')}
        className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:flex-wrap lg:items-center"
      >
        <Select<Device>
          ref={first}
          aria-label={t('toolbar.trigger', { name: t('toolbar.device'), value: deviceLabel })}
          placeholder={t('toolbar.device')}
          value={state.device}
          onValueChange={(device) => onChange({ device })}
          options={deviceOptions}
          className={DEVICE_TRIGGER}
        />
        <Combobox<GroupChoice>
          value={group}
          onValueChange={(next) => {
            if (next !== null && next.id !== state.group) onChange({ group: next.id });
          }}
          items={choices}
          itemToString={(choice) => choice.name}
          itemKey={(choice) => choice.id}
          emptyText={(query) => t('toolbar.groupEmpty', { query })}
          placeholder={t('toolbar.groupSearch')}
          clearLabel={t('toolbar.groupClear')}
          openLabel={t('toolbar.groupOpen')}
          trigger={
            <button type="button" className={GROUP_TRIGGER}>
              <span className="truncate">{group.name}</span>
              <Icon icon={ChevronDown} size="sm" className="ml-auto shrink-0 text-foreground-tertiary" />
            </button>
          }
          triggerLabel={t('toolbar.trigger', { name: t('toolbar.group'), value: group.name })}
        />
        <Select<string>
          aria-label={t('toolbar.trigger', { name: t('toolbar.period'), value: periodLabel })}
          placeholder={t('toolbar.period')}
          value={String(state.days)}
          onValueChange={(value) => {
            const days = PERIODS.find((period) => String(period) === value);
            if (days !== undefined) onChange({ days });
          }}
          options={periodOptions}
          className={PERIOD_TRIGGER}
        />
        {/* Invisible keeps its place in the desktop row; in the two column phone grid it would leave an empty row */}
        <span
          aria-hidden={isDefaultScope ? true : undefined}
          className={cn('flex size-control shrink-0', isDefaultScope && 'invisible max-lg:hidden')}
        >
          <IconButton
            icon={Undo2}
            variant="ghost"
            size="icon"
            label={t('toolbar.reset')}
            className="border-0 type-body"
            disabled={isDefaultScope}
            tabIndex={isDefaultScope ? -1 : undefined}
            onClick={() => {
              onReset();
              first.current?.focus();
            }}
          />
        </span>
      </div>
    </section>
  );
}
