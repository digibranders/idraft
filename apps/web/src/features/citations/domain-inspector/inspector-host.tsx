'use client';

import type { Route } from 'next';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { DomainInspector } from './domain-inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import type { SourceFilters } from '@/lib/citations/source-queries';
import type { EngineCode, SourceScope } from '@/lib/citations/types';
import { formatText } from '@/lib/filters/filter-values';
import type { InspectorTarget } from '@/lib/inspector/placement';
import { projectPath, withQuery } from '@/lib/routes/paths';

/** The keys of the inspector and of a tab's own columns, which a link to another tab does not carry. */
const DROPPED_KEYS = ['inspect', 'itab', 'cols'] as const;

export interface CitationInspectorHostProps {
  /** The record the address names; `null` for none. Only a domain opens an inspector so far. */
  target: InspectorTarget | null;
  source: SourceScope;
  filters: SourceFilters;
  timeZone: string;
  workspaceSlug: string;
  projectSlug: string;
  /** The engines in scope with their names. */
  engines: readonly { code: EngineCode; label: string }[];
  /** Where the open record is in the order of the list on screen; `null` when it is not in it. */
  position: { index: number; count: number } | null;
  onStep: (direction: 'next' | 'previous') => void;
  /** The tab the address asks for. */
  tab: string;
  /** Overview is the first tab and is left out of the address. */
  onTabChange: (tab: string) => void;
  onClose: () => void;
}

/**
 * The inspector of the Citations page: the one record the address names (`?inspect=domain:<registrable domain>`),
 * stepped through in the order of the table it was opened from. The source inspector joins the domain's here.
 */
export function CitationInspectorHost({
  target,
  source,
  filters,
  timeZone,
  workspaceSlug,
  projectSlug,
  engines,
  position,
  onStep,
  tab,
  onTabChange,
  onClose,
}: CitationInspectorHostProps): ReactElement | null {
  const t = useTranslations('citations.inspectors.domain');
  const address = useSearchParams().toString();
  const registrable = target?.type === 'domain' ? target.id.toLowerCase() : null;
  const pagesHref = useMemo((): Route => {
    const next = new URLSearchParams(address);
    for (const key of DROPPED_KEYS) next.delete(key);
    next.set('tab', 'pages');
    next.set('domain', formatText({ operator: 'equals', text: registrable ?? '' }));
    return withQuery(projectPath(workspaceSlug, projectSlug, '/ai/citations'), next.toString());
  }, [address, workspaceSlug, projectSlug, registrable]);
  if (registrable === null) return null;

  const navigation: InspectorNavigation | null =
    position === null
      ? null
      : {
          onPrevious: () => onStep('previous'),
          onNext: () => onStep('next'),
          atFirst: position.index === 0,
          atLast: position.index === position.count - 1,
        };
  return (
    <DomainInspector
      source={source}
      filters={filters}
      registrable={registrable}
      timeZone={timeZone}
      engines={engines}
      pagesHref={pagesHref}
      positionText={position === null ? null : t('position', { index: position.index + 1, count: position.count })}
      navigation={navigation}
      onStep={position === null ? undefined : onStep}
      tab={tab}
      onTabChange={onTabChange}
      onClose={onClose}
    />
  );
}
