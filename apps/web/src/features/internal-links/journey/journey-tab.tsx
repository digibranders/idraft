'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ListTree, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type ReactElement } from 'react';

import { FocusPicker } from './focus-picker';
import { JourneyCanvas } from './journey-canvas';
import { readPageRows } from './page-reads';
import { TreeList } from './tree-list';
import { ScopeMenu } from '../scope-menu';
import type { LinksTabContext } from '../tabs';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiProblem } from '@/lib/api/problem';
import type { View } from '@/lib/internal-links/canvas-view';
import { formatKeySet } from '@/lib/internal-links/journey-codec';
import type { Direction } from '@/lib/internal-links/journey-layout';
import { DEFAULT_PAGE_QUERY, pageDetailQuery, pagesQuery } from '@/lib/internal-links/queries';

/** Before the canvas has set the first view of a focus page. */
const START_VIEW: View = { x: 0, y: 0, scale: 1 };
/** What a new focus clears: the opened cards, groups and counts of the canvas and the opened rows of the tree. */
const CLEARED = { open: null, grp: null, more: null, topen: null } as const;
/** The page the detail read is asked about while no focus is known: the read is off then. */
const NO_FOCUS = '1';

/**
 * The Journey tab (spec 7.5, mock `il-journey.js`): the canvas and the tree list are two views of one journey, kept in
 * the address: focus, link scope, opened cards, groups and counts. The focus defaults to the home page (the first page
 * by path). A focus that is no page id is not found, never the home page.
 */
export function JourneyTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks.journey');
  const common = useTranslations('common');
  const { scope, state, setSearch } = context;
  const refused = state.invalid.focus !== null;
  const home = useQuery({
    ...pagesQuery(scope, { ...DEFAULT_PAGE_QUERY, scope: state.scope, sort: 'path', limit: 1 }),
    enabled: state.focus === null && !refused,
    select: readPageRows,
  });
  const focusId = state.focus ?? home.data?.data[0]?.url_id ?? null;
  const detail = useQuery({
    ...pageDetailQuery(scope, focusId ?? NO_FOCUS, state.scope),
    enabled: focusId !== null && !refused,
    // A change of link scope keeps the page on screen while it is read again; another page never shows as this one
    placeholderData: keepPreviousData,
  });
  const loaded = detail.data?.data.page.url_id === focusId ? detail.data.data.page : null;
  // One view for each focus page the tab has shown
  const [views, setViews] = useState<ReadonlyMap<string, View>>(new Map());
  const changeView = useCallback(
    (next: View): void => {
      if (focusId !== null) setViews((held) => new Map(held).set(focusId, next));
    },
    [focusId],
  );

  const refocus = (urlId: string): void => setSearch({ focus: urlId, ...CLEARED }, { history: 'push' });
  const goHome = (): void => setSearch({ focus: null, ...CLEARED }, { history: 'push' });
  const backToHome = (
    <Button variant="secondary" size="sm" onClick={goHome}>
      {t('backToHome')}
    </Button>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-3 py-2">
      <SegmentedControl
        semantics="view"
        label={t('view')}
        value={state.journeyView}
        onValueChange={(next) => setSearch({ jv: next === 'canvas' ? null : next })}
        items={[
          { value: 'canvas', label: t('canvas'), icon: Workflow },
          { value: 'tree', label: t('tree'), icon: ListTree },
        ]}
        size="sm"
      />
      <FocusPicker scope={scope} path={loaded?.path ?? t('focus')} onPick={refocus} />
      <ScopeMenu scope={state.scope} onChange={(next) => setSearch({ scope: next === 'editorial' ? null : next })} />
      {state.journeyView === 'tree' ? (
        <Select<Direction>
          value={state.treeDir}
          onValueChange={(next) => setSearch({ dir: next === 'out' ? null : next, topen: null })}
          placeholder={t('follow')}
          aria-label={t('follow')}
          options={[
            { value: 'out', label: t('out') },
            { value: 'in', label: t('in') },
          ]}
          size="sm"
        />
      ) : null}
    </div>
  );

  let body: ReactElement;
  if (refused) {
    body = (
      <EmptyState title={t('notFoundTitle')} reason={t('notFoundReason')} headingLevel={3} primaryAction={backToHome} />
    );
  } else if (detail.isError && isApiProblem(detail.error, 'not_found')) {
    body = (
      <EmptyState
        title={t('notInCrawlTitle')}
        reason={t('notInCrawlReason')}
        headingLevel={3}
        primaryAction={backToHome}
      />
    );
  } else if (detail.isError || home.isError) {
    body = (
      <InlineError
        title={t('loadFailed')}
        reason={t('loadFailedReason')}
        errorId={null}
        onRetry={() => void (home.isError ? home.refetch() : detail.refetch())}
        retrying={home.isError ? home.isFetching : detail.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (state.focus === null && home.isSuccess && focusId === null) {
    body = <EmptyState title={t('noPagesTitle')} reason={t('noPagesReason')} headingLevel={3} />;
  } else if (loaded === null) {
    body = (
      <div className="flex flex-col gap-2 p-4" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} shape="block" height="row" />
        ))}
      </div>
    );
  } else if (state.journeyView === 'tree') {
    body = (
      <TreeList
        scope={scope}
        focus={loaded}
        linkScope={state.scope}
        dir={state.treeDir}
        open={state.treeOpen}
        onToggle={(key) => {
          const next = new Set(state.treeOpen);
          if (!next.delete(key)) next.add(key);
          setSearch({ topen: formatKeySet(next) });
        }}
        onRefocus={refocus}
        onDetails={context.inspect.open}
      />
    );
  } else {
    body = (
      <JourneyCanvas
        context={context}
        page={loaded}
        view={views.get(loaded.url_id) ?? START_VIEW}
        onViewChange={changeView}
        onRefocus={refocus}
      />
    );
  }

  return (
    <section aria-labelledby="journey-title" className="overflow-hidden rounded-lg border border-border bg-surface">
      {/* The canvas's column titles are h3: this names the section above them */}
      <h2 id="journey-title" className="sr-only">
        {t('heading')}
      </h2>
      {toolbar}
      {body}
    </section>
  );
}
