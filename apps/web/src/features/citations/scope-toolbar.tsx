'use client';

import { ChevronDown, Download, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, type ReactElement } from 'react';

import type { BoardEngine, TopicTerm, TrackedCompetitor } from './board-reads';
import { RUN_CHOICES, type BoardState, type Platform } from './board-state';
import { runsLabel, runsNote } from './board-text';
import { CompetitorPicker } from './competitor-picker';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { inputVariants } from '@/components/ui/input-variants';
import { Select, type SelectOption } from '@/components/ui/select';
import type { RunSlot, RunsChoice } from '@/lib/citations/board-queries';
import { cn } from '@/lib/utils';

export interface ScopeToolbarProps {
  state: BoardState;
  engines: readonly BoardEngine[];
  /** The topic terms; `null` while they load. */
  terms: readonly TopicTerm[] | null;
  tracked: readonly TrackedCompetitor[] | null;
  /** `window.trend` of the overview read, for the Runs notes. */
  trend: readonly RunSlot[];
  timeZone: string;
  latest: string | null;
  isDefaultScope: boolean;
  onChange: (patch: Partial<BoardState>) => void;
  onReset: () => void;
  onExport: () => void;
  exporting: boolean;
  /** `false` while the engines are unknown: an export with no engine would read every engine (D-4). */
  canExport: boolean;
  /** The competitors popover, which the gap tab's empty state opens too (C 681). */
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
}

interface GroupChoice {
  id: string;
  name: string;
}

// Constants, not literals in the JSX: the i18n rule reads `popupClassName` as visible text
const PLATFORM_POPUP = cn('min-w-52');
const RUNS_POPUP = cn('min-w-56');

// The preview's TRIGGER states (aiov-controls.js), shared by the Select and Combobox triggers
const TRIGGER_STATES = cn('whitespace-nowrap hover:bg-surface-hover aria-expanded:bg-surface-hover');
const PLATFORM_TRIGGER = cn(TRIGGER_STATES, 'w-full min-w-0 sm:w-56');
const RUNS_TRIGGER = cn(TRIGGER_STATES, 'w-full min-w-0 sm:w-44');

const TRIGGER = cn(
  inputVariants({ variant: 'outline', size: 'md' }),
  'flex w-full max-w-full min-w-0 items-center gap-2 text-left',
  TRIGGER_STATES,
);

/**
 * The toolbar (C 110 to 198): the scope on the left, as a two column grid below 1024 px and a wrapping row from it,
 * Export at the right. Freshness is the table footer's (C 188). The page title is for screen readers only (3.1).
 */
export function ScopeToolbar(props: ScopeToolbarProps): ReactElement {
  const t = useTranslations('citations');
  const { state, engines, terms, tracked, trend, timeZone, latest, onChange } = props;
  const platform = useRef<HTMLButtonElement>(null);

  const platformOptions = useMemo(
    (): readonly SelectOption<Platform>[] => [
      { value: 'all', label: t('toolbar.allPlatforms') },
      ...engines.map((engine) => ({
        value: engine.code,
        label: engine.label,
        display: <EngineLogo engine={engine.code} name={engine.label} truncate />,
      })),
    ],
    [engines, t],
  );
  const platformLabel = platformOptions.find((option) => option.value === state.platform)?.label ?? '';

  const runOptions = useMemo(
    (): readonly SelectOption<string>[] =>
      RUN_CHOICES.map((choice: RunsChoice) => ({
        value: String(choice),
        label: runsLabel(choice, t),
        note: runsNote(choice, trend, timeZone, latest, t) ?? undefined,
      })),
    [trend, timeZone, latest, t],
  );

  const everyGroup = useMemo((): GroupChoice => ({ id: 'all', name: t('toolbar.allGroups') }), [t]);
  const groupChoices = useMemo(
    (): readonly GroupChoice[] => [everyGroup, ...(terms ?? []).map((term) => ({ id: term.id, name: term.name }))],
    [everyGroup, terms],
  );
  const group = groupChoices.find((choice) => choice.id === state.group) ?? everyGroup;

  return (
    <section aria-label={t('toolbar.label')} className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="sr-only">{t('title')}</h1>
      <div
        role="group"
        aria-label={t('toolbar.scope')}
        className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:flex-wrap lg:items-center"
      >
        <Select<Platform>
          ref={platform}
          aria-label={t('toolbar.trigger', { name: t('toolbar.platform'), value: platformLabel })}
          triggerPrefix={t('toolbar.prefix', { name: t('toolbar.platform') })}
          placeholder={t('toolbar.allPlatforms')}
          value={state.platform}
          onValueChange={(platform) => onChange({ platform })}
          options={platformOptions}
          popupClassName={PLATFORM_POPUP}
          className={PLATFORM_TRIGGER}
        />
        <Combobox<GroupChoice>
          value={group}
          onValueChange={(next) => {
            if (next !== null && next.id !== state.group) onChange({ group: next.id });
          }}
          items={groupChoices}
          itemToString={(choice) => choice.name}
          itemKey={(choice) => choice.id}
          emptyText={(query) => t('toolbar.groupEmpty', { query })}
          placeholder={t('toolbar.groupSearch')}
          clearLabel={t('toolbar.groupClear')}
          openLabel={t('toolbar.groupOpen')}
          trigger={
            <button type="button" className={cn(TRIGGER, 'sm:w-52')}>
              <span className="text-foreground-secondary">{t('toolbar.prefix', { name: t('toolbar.group') })}</span>
              <span className="truncate">{group.name}</span>
              <Icon icon={ChevronDown} size="sm" className="ml-auto shrink-0 text-foreground-tertiary" />
            </button>
          }
          triggerLabel={t('toolbar.trigger', { name: t('toolbar.group'), value: group.name })}
        />
        <Select<string>
          aria-label={t('toolbar.trigger', { name: t('toolbar.runs'), value: runsLabel(state.runs, t) })}
          triggerPrefix={t('toolbar.prefix', { name: t('toolbar.runs') })}
          placeholder={t('toolbar.runs')}
          value={String(state.runs)}
          onValueChange={(value) => {
            const runs = RUN_CHOICES.find((choice) => String(choice) === value);
            if (runs !== undefined) onChange({ runs });
          }}
          options={runOptions}
          popupClassName={RUNS_POPUP}
          className={RUNS_TRIGGER}
        />
        <CompetitorPicker
          tracked={tracked ?? []}
          chosen={state.competitors}
          onChange={(competitors) => onChange({ competitors })}
          open={props.pickerOpen}
          onOpenChange={props.onPickerOpenChange}
        />
        {/* Invisible keeps its place in the desktop row; in the two column phone grid it would leave an empty row (C 696 to 698) */}
        <span
          aria-hidden={props.isDefaultScope ? true : undefined}
          className={cn('flex size-control shrink-0', props.isDefaultScope && 'invisible max-lg:hidden')}
        >
          <IconButton
            icon={Undo2}
            variant="ghost"
            size="icon"
            label={t('toolbar.reset')}
            // The preview's reset is a plain 36 px box: no border and the body weight (`type-body` replaces the button's)
            className="border-0 type-body"
            disabled={props.isDefaultScope}
            tabIndex={props.isDefaultScope ? -1 : undefined}
            onClick={() => {
              props.onReset();
              // The button is out of reach once the scope is the default: focus goes to the first control, not to the page
              platform.current?.focus();
            }}
          />
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-x-4 xl:ml-auto">
        {/* The preview draws this icon at 14 px (`size-icon-sm`), which is 2 px under the button's own 16 px */}
        <Button variant="secondary" loading={props.exporting} disabled={!props.canExport} onClick={props.onExport}>
          <Icon icon={Download} size="sm" />
          {t('toolbar.export')}
        </Button>
      </div>
    </section>
  );
}
