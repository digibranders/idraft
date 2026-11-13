'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, type ReactElement } from 'react';

import { useOverview } from '../overview-context';
import { brandedField, brandedFromValues, brandedValues } from './branded-field';
import { CompareSelect } from './compare-select';
import { CountryControl } from './country-control';
import { EnginesControl, type EngineChoice } from './engines-control';
import { FiltersSheet, SheetRow } from './filters-sheet';
import { changedFilterCount, RESET_PATCH } from './scope-model';
import { topicField } from './topic-options';
import { MAX_DAYS } from './use-overview-scope';
import { useTopicTree } from './use-topic-tree';
import { DateRangePicker } from '@/components/app/date-range/date-range-picker';
import { byEngineOrder } from '@/components/app/engine/order';
import { FilterBar } from '@/components/app/filters/filter-bar';
import type { FilterField, FilterValues } from '@/components/app/filters/types';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { TopBarPortal } from '@/components/app/shell/top-bar-slot';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useMediaQuery } from '@/lib/dom/use-media-query';
import { useZoneDay } from '@/lib/dom/use-zone-day';
import { formatList } from '@/lib/format';

/** 768 px, the width from which the scope controls are on the page and the window and country are in the top bar. */
const PAGE_CONTROLS = '(width >= 48rem)';

/**
 * The scope controls of the page (WP-33 plan section 3.2, the approved preview's filter bar): the comparison, the
 * engines, then the filter bar with Topic and Branded ("Branded: Excluded" is a chip from the default), and "Reset
 * filters" while any of them is not its default. The window and the country are scope the top bar owns and Reset
 * leaves them alone. From 768 px the top bar holds the window and the country; below it everything is behind one
 * Filters button. The controls only write the scope; the numbers and the cards read it back.
 */
export function ScopeBar(): ReactElement {
  const t = useTranslations('aiOverview.scope');
  const locale = useLocale();
  const { project, scope, setScope, engines } = useOverview();
  const onPage = useMediaQuery(PAGE_CONTROLS);
  const today = useZoneDay(project.timeZone);
  const { tree, pending } = useTopicTree();
  const barRef = useRef<HTMLDivElement>(null);

  const choices = useMemo(
    (): EngineChoice[] =>
      byEngineOrder(
        (engines.data ?? []).filter((engine) => engine.is_enabled),
        (engine) => engine.engine.engine_code,
      ).map((engine) => ({ code: engine.engine.engine_code, label: engine.engine.label })),
    [engines.data],
  );
  const withPath = useCallback((name: string, path: string): string => t('topicWithPath', { name, path }), [t]);
  const topic = useMemo(() => topicField({ tree, pending, label: t('topic'), withPath }), [tree, pending, t, withPath]);
  const branded = useMemo(
    () =>
      brandedField({
        label: t('branded'),
        excluded: t('brandedExcluded'),
        only: t('brandedOnly'),
        included: t('brandedIncluded'),
      }),
    [t],
  );
  // The URL's own words about what it could not read: Topic and Engines of a link are checked against what the
  // project has once both are known, and the person is told once of what was left out (the Prompts page's rule).
  // The bar draws only Topic and Branded; the engines are the control before it.
  const linked = useMemo(
    (): FilterField[] => [
      topic,
      {
        id: 'engine',
        kind: 'enum',
        label: t('engines'),
        multi: true,
        optionsLoading: engines.data === undefined,
        options: choices.map((choice) => ({ value: choice.code, label: choice.label })),
      },
    ],
    [topic, t, engines.data, choices],
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

  const fields = useMemo((): FilterField[] => [topic, branded], [topic, branded]);
  const values = useMemo(
    (): FilterValues => ({
      ...(scope.topic === null ? {} : { topic: { kind: 'enum', values: [scope.topic] } }),
      ...brandedValues(scope.branded),
    }),
    [scope.topic, scope.branded],
  );
  const changed = changedFilterCount(scope);
  const reset = (): void => {
    setScope(RESET_PATCH);
    // The button goes with the last change: focus moves to the first control of the bar instead of the page
    barRef.current?.querySelector<HTMLElement>('button')?.focus();
  };

  const controls = (
    <div ref={barRef} className="flex flex-wrap items-start gap-2">
      <CompareSelect scope={scope} onCompareChange={(compare) => setScope({ compare })} />
      <EnginesControl engines={choices} selected={scope.engines} onChange={(next) => setScope({ engines: next })} />
      <div className="min-w-0">
        <FilterBar
          fields={fields}
          values={values}
          hideClear
          onChange={(next) =>
            setScope({
              topic: next.topic?.kind === 'enum' ? (next.topic.values[0] ?? null) : null,
              branded: brandedFromValues(next),
            })
          }
        />
      </div>
      {changed === 0 ? null : (
        <div className="flex h-control shrink-0 items-center">
          <Button variant="link" onClick={reset}>
            {t('reset')}
          </Button>
        </div>
      )}
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
