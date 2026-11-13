'use client';

import type { Route } from 'next';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { DomainInspector } from './domain-inspector';
import { SourceInspector } from '../source-inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import type { SourceFilters } from '@/lib/citations/source-queries';
import type { EngineCode, SourceScope } from '@/lib/citations/types';
import { formatText } from '@/lib/filters/filter-values';
import { formatInspectTarget, type InspectorTarget } from '@/lib/inspector/placement';
import { projectPath, rankingsPath, withQuery } from '@/lib/routes/paths';

/** The keys of the inspector and of a tab's own columns, which a link to another tab does not carry. */
const DROPPED_KEYS = ['inspect', 'itab', 'cols'] as const;

export interface CitationInspectorHostProps {
  /** The record the address names; `null` for none. A domain or a source (a cited page) opens one. */
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
 * The inspector of the Citations page: the one record the address names (`?inspect=domain:<registrable domain>` or
 * `?inspect=source:<url_id>`), stepped through in the order of the table it was opened from. The two share the tab
 * address (`itab`), the position and the way to step.
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
  const domainWords = useTranslations('citations.inspectors.domain');
  const sourceWords = useTranslations('citations.inspectors.source');
  const address = useSearchParams().toString();
  const registrable = target?.type === 'domain' ? target.id.toLowerCase() : null;
  const pagesHref = useMemo((): Route => {
    const next = new URLSearchParams(address);
    for (const key of DROPPED_KEYS) next.delete(key);
    next.set('tab', 'pages');
    next.set('domain', formatText({ operator: 'equals', text: registrable ?? '' }));
    return withQuery(projectPath(workspaceSlug, projectSlug, '/ai/citations'), next.toString());
  }, [address, workspaceSlug, projectSlug, registrable]);
  // A record opens its inspector beside the list as it is (the same scope, filters and view), on a tab of its own
  const inspectorHrefOf = useCallback(
    (record: InspectorTarget): Route => {
      const next = new URLSearchParams(address);
      next.set('inspect', formatInspectTarget(record));
      next.delete('itab');
      return withQuery(projectPath(workspaceSlug, projectSlug, '/ai/citations'), next.toString());
    },
    [address, workspaceSlug, projectSlug],
  );
  const sourceHrefOf = useCallback(
    (urlId: number): Route => inspectorHrefOf({ type: 'source', id: String(urlId) }),
    [inspectorHrefOf],
  );
  const domainHrefOf = useCallback(
    (name: string): Route => inspectorHrefOf({ type: 'domain', id: name }),
    [inspectorHrefOf],
  );
  // A prompt or an answer opens on the prompts page, which keeps its own scope: only the record is named
  const promptsHref = useMemo(
    (): Route => projectPath(workspaceSlug, projectSlug, '/ai/prompts'),
    [workspaceSlug, projectSlug],
  );
  const promptHrefOf = useCallback(
    (promptId: string): Route =>
      withQuery(
        promptsHref,
        new URLSearchParams({ inspect: formatInspectTarget({ type: 'prompt', id: promptId }) }).toString(),
      ),
    [promptsHref],
  );
  if (target?.type !== 'domain' && target?.type !== 'source') return null;

  const navigation: InspectorNavigation | null =
    position === null
      ? null
      : {
          onPrevious: () => onStep('previous'),
          onNext: () => onStep('next'),
          atFirst: position.index === 0,
          atLast: position.index === position.count - 1,
        };
  const places = position === null ? null : { index: position.index + 1, count: position.count };
  if (target.type === 'source') {
    return (
      <SourceInspector
        source={source}
        filters={filters}
        sourceId={target.id}
        timeZone={timeZone}
        engines={engines}
        domainHref={domainHrefOf}
        promptsHref={promptsHref}
        positionText={places === null ? null : sourceWords('position', places)}
        navigation={navigation}
        onStep={position === null ? undefined : onStep}
        tab={tab}
        onTabChange={onTabChange}
        onClose={onClose}
      />
    );
  }
  return (
    <DomainInspector
      source={source}
      filters={filters}
      registrable={target.id.toLowerCase()}
      timeZone={timeZone}
      engines={engines}
      pagesHref={pagesHref}
      rankingsHref={rankingsPath(workspaceSlug, projectSlug)}
      sourceHrefOf={sourceHrefOf}
      promptHrefOf={promptHrefOf}
      positionText={places === null ? null : domainWords('position', places)}
      navigation={navigation}
      onStep={position === null ? undefined : onStep}
      tab={tab}
      onTabChange={onTabChange}
      onClose={onClose}
    />
  );
}
