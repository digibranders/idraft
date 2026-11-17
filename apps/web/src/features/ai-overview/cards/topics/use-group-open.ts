'use client';

import type { Route } from 'next';
import { useCallback, useMemo, type MouseEvent } from 'react';

import { rememberDrill } from './group-drill';
import type { HeatLinks } from './heatmap-model';
import { useOverview } from '../../overview-context';
import { DEFAULT_METRIC, singlePlatform, type OverviewScope } from '../../scope/scope-model';
import { writeRangeParams } from '@/components/app/date-range/range-model';
import { cmpParam } from '@/lib/compare/compare-model';
import { projectPath, withQuery } from '@/lib/routes/paths';

/** The keys of the Overview's address that a group and a platform are written to (`use-overview-scope.ts`). */
const TOPIC_KEY = 'topic';
const ENGINE_KEY = 'engine';

/**
 * The address of the Overview for `scope` with a group and a platform set: the keys `use-overview-scope.ts` writes,
 * each left out at its default, so the link opens the page as it is now with only the group (and platform) changed.
 */
export function overviewQuery(scope: OverviewScope, group: string, platform: string | null): string {
  const query = new URLSearchParams();
  const put = (key: string, value: string | null): void => {
    if (value !== null) query.set(key, value);
  };
  const { win, from, to } = writeRangeParams(scope.rangeValue);
  put('win', win);
  put('from', from);
  put('to', to);
  put('cmp', cmpParam(scope.compare, scope.compareKind));
  put('country', scope.country);
  put(ENGINE_KEY, platform);
  put(TOPIC_KEY, group);
  put('branded', scope.branded === 'excluded' ? null : scope.branded);
  put('metric', scope.metric === DEFAULT_METRIC ? null : scope.metric);
  return query.toString();
}

export interface GroupOpen {
  links: HeatLinks;
  /** On the element that holds the heat map: a plain click on a link of `links` sets the scope in place. */
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * How the cells of the groups heat map open a group (OV-GRP-08). Each is a link to the Overview with the group (and the
 * platform of a platform cell) set on top of the address as it is, so it still opens in a new tab; a plain click is
 * taken here and writes the same two keys in one step, remembering the platform it came from for Back.
 */
export function useGroupOpen(): GroupOpen {
  const { workspaceSlug, project, scope, setScope } = useOverview();
  const chosen = singlePlatform(scope);
  const base = projectPath(workspaceSlug, project.slug, '/ai');

  const links = useMemo((): HeatLinks => {
    const hrefOf = (group: string, platform: string | null): Route =>
      withQuery(base, overviewQuery(scope, group, platform));
    return { row: (key) => hrefOf(key, chosen), cell: (key, code) => hrefOf(key, code) };
  }, [base, scope, chosen]);

  const onClickCapture = useCallback(
    (event: MouseEvent<HTMLElement>): void => {
      const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      const target = event.target;
      if (!plain || !(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (anchor === null) return;
      const url = new URL(anchor.getAttribute('href') ?? '', window.location.origin);
      const group = url.searchParams.get(TOPIC_KEY);
      if (group === null || url.pathname !== base) return;
      const platform = url.searchParams.get(ENGINE_KEY);
      event.preventDefault();
      event.stopPropagation();
      rememberDrill(group, chosen, platform);
      setScope({ topic: group, engines: platform === null ? null : [platform] });
    },
    [base, chosen, setScope],
  );

  return { links, onClickCapture };
}
