'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { clockOf, selectorParts, WEEKDAYS, type SelectorNames, type SelectorPart } from './schedule-model';
import type { Schedule, Selector } from '@/lib/api/types';
import { formatList } from '@/lib/format';
import { useKeywordGroups, useVocabularies, type TaxonomyScope } from '@/lib/keywords/taxonomy-reads';

/**
 * The names of the groups and terms a selector holds ids of. A list still loading, or one that failed,
 * leaves its names `null`: the words then count the ids instead of naming them.
 */
export function useSelectorNames(scope: TaxonomyScope): SelectorNames {
  const t = useTranslations('projectSettings.schedules.selector');
  const groups = useKeywordGroups(scope);
  const vocabularies = useVocabularies(scope);
  const groupData = groups.data?.data;
  const termsReady = !vocabularies.pending && !vocabularies.error;
  const loaded = vocabularies.loaded;
  return useMemo(
    () => ({
      groups: groupData === undefined ? null : new Map(groupData.map((group) => [group.group_id, group.path])),
      terms: termsReady
        ? new Map(
            loaded.flatMap(({ vocabulary, terms }) =>
              terms.map((term) => [term.termId, t('termName', { vocabulary: vocabulary.name, term: term.path })]),
            ),
          )
        : null,
    }),
    [groupData, termsReady, loaded, t],
  );
}

export interface ScheduleWords {
  /** The cadence in words, with the time and the window: "Every day at 06:00, 4 hour window". */
  when: (schedule: Schedule) => string;
  /** What the schedule collects: "All keywords", "Groups: Brand and Local". */
  collects: (selector: Selector, names: SelectorNames) => string;
}

/** The words the Schedules section puts to a schedule's rule, in one place for the table and the toasts. */
export function useScheduleWords(): ScheduleWords {
  const t = useTranslations('projectSettings.schedules');
  const days = useTranslations('common.weekdays');
  const when = useCallback(
    (schedule: Schedule): string => {
      const time = clockOf(schedule.window_start_local);
      const hours = schedule.window_hours;
      if (schedule.cadence === 'daily') return t('when.daily', { time, hours });
      if (schedule.cadence === 'monthly' && schedule.month_day !== null) {
        return t('when.monthly', { day: schedule.month_day, time, hours });
      }
      const weekday = schedule.weekday === null ? undefined : WEEKDAYS[schedule.weekday];
      if (schedule.cadence === 'weekly' && weekday !== undefined) {
        return t('when.weekly', { weekday: days(weekday), time, hours });
      }
      return t('when.cron');
    },
    [t, days],
  );
  const part = useCallback(
    (item: SelectorPart): string => {
      switch (item.kind) {
        case 'all':
          return t('selector.all');
        case 'stale':
          return t('selector.stale', { days: item.days });
        case 'priority':
          return t('selector.priority', { max: item.max });
        case 'groups': {
          if (item.pending > 0) return t('selector.groupsPending', { count: item.pending });
          const removed = item.removed > 0 ? [t('selector.groupsRemoved', { count: item.removed })] : [];
          return t('selector.groups', { names: formatList([...item.names, ...removed]) });
        }
        case 'terms': {
          if (item.pending > 0) return t('selector.termsPending', { count: item.pending });
          const removed = item.removed > 0 ? [t('selector.termsRemoved', { count: item.removed })] : [];
          return t('selector.terms', { names: formatList([...item.names, ...removed]) });
        }
      }
    },
    [t],
  );
  const collects = useCallback(
    (selector: Selector, names: SelectorNames): string => {
      const parts = selectorParts(selector, names);
      if (parts.length === 0) return t('selector.none');
      // Several parts all hold at once: a keyword has to match each
      return parts.map(part).reduce((first, second) => t('selector.join', { first, second }));
    },
    [t, part],
  );
  return { when, collects };
}
