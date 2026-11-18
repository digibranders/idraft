'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useContext, useMemo, type ReactElement } from 'react';

import { PromptInspector, type PromptCounts } from './prompt-inspector';
import { enginesQuery, summaryQuery, type PromptScope } from './prompt-queries';
import { useDateRangeParams } from '@/components/app/date-range/use-date-range-params';
import { DEFAULT_INSPECTOR_TAB, useInspector } from '@/components/app/inspector/use-inspector';
import type { ProjectEngine } from '@/lib/api/types';
import { useErrorId } from '@/lib/api/use-error-id';
import { useZoneDay } from '@/lib/dom/use-zone-day';
import { formatInteger } from '@/lib/format';
import { PromptOrderContext } from '@/lib/inspector/prompt-order';

const NO_ENGINES: readonly ProjectEngine[] = [];
const NO_ENTITIES: PromptCounts['entities'] = [];

export interface PromptDrawerHostProps {
  workspaceId: string;
  projectId: string;
  timeZone: string;
}

/**
 * The prompt inspector on a page other than Topics & Prompts (WP-77, the Citations drawers' "Open answers"): it reads
 * what `PromptInspector` needs itself (the engines and the prompt's summary row over the date range of the address,
 * non-branded) and shows when the address names a prompt (`inspect=prompt:<id>`). The page passes it as an element and
 * provides the order for J and K (`PromptOrderContext`). The answer viewer is not wired here: the dates of the answers
 * are plain text.
 */
export function PromptDrawerHost({ workspaceId, projectId, timeZone }: PromptDrawerHostProps): ReactElement | null {
  const t = useTranslations('prompts');
  const inspector = useInspector();
  const order = useContext(PromptOrderContext);
  const scope = useMemo((): PromptScope => ({ workspaceId, projectId }), [workspaceId, projectId]);
  const today = useZoneDay(timeZone);
  const picked = useDateRangeParams({ today });
  const range = useMemo(() => ({ from: picked.range.from, to: picked.range.to }), [picked.range]);
  const engines = useQuery(enginesQuery(scope));
  const all = engines.data?.data ?? NO_ENGINES;
  const enabled = useMemo(() => all.filter((engine) => engine.is_enabled), [all]);
  const summary = useQuery({
    ...summaryQuery(scope, range, false),
    enabled: enabled.length > 0,
    placeholderData: keepPreviousData,
  });
  const errorId = useErrorId(summary.error);
  const target = inspector.target;
  if (target === null || target.type !== 'prompt') return null;
  const at = inspector.position(order);
  const counts: PromptCounts = {
    status:
      summary.isError && summary.data === undefined
        ? 'failed'
        : engines.isPending || (enabled.length > 0 && (summary.isPending || summary.isPlaceholderData))
          ? 'loading'
          : 'ready',
    brandedIncluded: false,
    entities: summary.data?.data.entities ?? NO_ENTITIES,
    row: summary.data?.data.prompts.find((row) => row.prompt_id === target.id),
    errorId,
    retry: () => void summary.refetch(),
    retrying: summary.isFetching,
  };
  const step = (direction: 'next' | 'previous'): void => inspector.step(direction, order);
  return (
    <PromptInspector
      key={projectId}
      scope={scope}
      promptId={target.id}
      timeZone={timeZone}
      range={range}
      engines={enabled}
      allEngines={all}
      counts={counts}
      positionText={
        at === null
          ? null
          : t('inspector.position', { index: formatInteger(at.index + 1), count: formatInteger(at.count) })
      }
      navigation={
        at === null
          ? null
          : {
              onPrevious: () => step('previous'),
              onNext: () => step('next'),
              atFirst: at.index === 0,
              atLast: at.index === at.count - 1,
            }
      }
      onStep={at === null ? undefined : step}
      tab={inspector.tab}
      // Latest is the inspector's first tab, which the address leaves out
      onTabChange={(next) => inspector.setTab(next === 'latest' ? DEFAULT_INSPECTOR_TAB : next)}
      onClose={() => inspector.close()}
    />
  );
}
