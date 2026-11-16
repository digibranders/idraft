'use client';

import { Undo2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, type ReactElement } from 'react';

import { useOverview } from '../overview-context';
import { BrandedFilter, PAGE_CONTROLS } from './branded-filter';
import { CompareSelect } from './compare-select';
import { CountryControl } from './country-control';
import { FiltersSheet, SheetRow } from './filters-sheet';
import { GroupSelect } from './group-select';
import { PlatformSelect, type PlatformChoice } from './platform-select';
import { canResetScope, changedFilterCount, RESET_PATCH } from './scope-model';
import { topicField } from './topic-options';
import { MAX_DAYS } from './use-overview-scope';
import { useTopicTree } from './use-topic-tree';
import { DateRangePicker } from '@/components/app/date-range/date-range-picker';
import { byEngineOrder } from '@/components/app/engine/order';
import type { FilterField } from '@/components/app/filters/types';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { TopBarPortal } from '@/components/app/shell/top-bar-slot';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toast';
import { useMediaQuery } from '@/lib/dom/use-media-query';
import { useZoneDay } from '@/lib/dom/use-zone-day';
import { formatList } from '@/lib/format';

/**
 * The scope controls of the page: Platform, Group and Compare, each with its name before the value, then Reset scope
 * (always in its place, invisible while the scope is the default), then the Branded filter ("Branded: Excluded" is a
 * chip from the default; "+ Filter" shows only while the chip is removed). The served preview has no Branded control:
 * the real app keeps it, with the `branded` URL key, by the owner's decision (OV-SCOPE-10, OV-SCOPE-11 differ). The
 * window and the location are scope the top bar owns and Reset leaves them alone. From 768 px the top bar holds the
 * window and the country; below it everything is behind one Filters button. The controls only write the scope; the
 * numbers and the cards read it back.
 */
export function ScopeBar(): ReactElement {
  const t = useTranslations('aiOverview.scope');
  const tShell = useTranslations('aiOverview.shell');
  const locale = useLocale();
  const { project, scope, setScope, engines } = useOverview();
  const onPage = useMediaQuery(PAGE_CONTROLS);
  const today = useZoneDay(project.timeZone);
  const { tree, pending } = useTopicTree();
  const barRef = useRef<HTMLDivElement>(null);

  const choices = useMemo(
    (): PlatformChoice[] =>
      byEngineOrder(
        (engines.data ?? []).filter((engine) => engine.is_enabled),
        (engine) => engine.engine.engine_code,
      ).map((engine) => ({ code: engine.engine.engine_code, label: engine.engine.label })),
    [engines.data],
  );
  const below = useCallback((label: string): string => t('topicIncludesBelow', { topic: label }), [t]);
  const topic = useMemo(() => topicField({ tree, pending, label: t('topic'), below }), [tree, pending, t, below]);
  // The URL's own words about what it could not read: Topic and Engines of a link are checked against what the
  // project has once both are known, and the person is told once of what was left out (the Prompts page's rule).
  // The bar draws only Topic and Branded; the engines are the control before it.
  const linked = useMemo(
    (): FilterField[] => [
      topic,
      {
        id: 'engine',
        kind: 'enum',
        label: tShell('platform'),
        multi: true,
        optionsLoading: engines.data === undefined,
        options: choices.map((choice) => ({ value: choice.code, label: choice.label })),
      },
    ],
    [topic, tShell, engines.data, choices],
  );
  useUrlFilters(linked, {
    onDropped: (dropped) =>
      toast({
        type: 'info',
        title: t('droppedTitle', { count: dropped.length }),
        description: t('droppedDescription', {
          fields: formatList(
            dropped.map((field) => field.label),
            locale,
          ),
        }),
      }),
  });

  const changed = changedFilterCount(scope);
  const reset = (): void => {
    setScope(RESET_PATCH);
    // The button goes with the last change: focus moves to the first control of the bar instead of the page
    barRef.current?.querySelector<HTMLElement>('button')?.focus();
  };

  const controls = (
    <div ref={barRef} className="flex flex-wrap items-center gap-2">
      <PlatformSelect
        platforms={choices}
        selected={scope.engines?.[0] ?? null}
        onChange={(code) => setScope({ engines: code === null ? null : [code] })}
        className="w-full sm:w-60"
      />
      <GroupSelect
        tree={tree}
        pending={pending}
        selected={scope.topic}
        onChange={(topicId) => setScope({ topic: topicId })}
        className="w-full sm:w-60"
      />
      <CompareSelect scope={scope} onCompareChange={(compare) => setScope({ compare })} />
      {/* Always in its place, invisible (and out of the tab order) while the scope is the default, so it never moves the row */}
      <IconButton
        icon={Undo2}
        label={tShell('resetScope')}
        variant="ghost"
        size="icon"
        onClick={reset}
        className={canResetScope(scope) ? undefined : 'invisible'}
      />
    </div>
  );

  const rangeControl = (
    <DateRangePicker
      value={scope.rangeValue}
      onValueChange={(range) => setScope({ range })}
      today={today}
      timeZone={project.timeZone}
      maxDays={MAX_DAYS}
    />
  );

  if (!onPage) {
    return (
      <section aria-label={t('bar')} className="flex flex-col">
        <FiltersSheet count={changed}>
          <SheetRow label={t('window')}>{rangeControl}</SheetRow>
          <SheetRow label={t('location')}>
            <CountryControl />
          </SheetRow>
          {controls}
          <BrandedFilter />
        </FiltersSheet>
      </section>
    );
  }
  return (
    <>
      <TopBarPortal>
        {rangeControl}
        <CountryControl />
      </TopBarPortal>
      <section aria-label={t('bar')}>{controls}</section>
    </>
  );
}
