'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ListTree, Route as RouteIcon, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { FocusPicker } from './focus-picker';
import { LinksDropped } from '../links-dropped';
import { JourneyCanvas } from './journey-canvas';
import { readPageRows } from './page-reads';
import { PathFinder } from './path-finder';
import { TreeList } from './tree-list';
import { ScopeMenu } from '../scope-menu';
import type { LinksTabContext } from '../tabs';
import { LaneChips, LayoutSwitch } from '@/components/app/link-canvas/layout-controls';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import type { View } from '@/lib/internal-links/canvas-view';
import { formatKeySet, formatLanes } from '@/lib/internal-links/journey-codec';
import type { Direction } from '@/lib/internal-links/journey-layout';
import { DEFAULT_PAGE_QUERY, pageDetailQuery, pagesQuery } from '@/lib/internal-links/queries';
import { tierPosition } from '@/lib/internal-links/tiers';
import { withQuery } from '@/lib/routes/paths';

/** A load that takes this long is spoken once. */
const LOADING_SAYS_MS = 2000;
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
  const paths = useTranslations('internalLinks.paths');
  const common = useTranslations('common');
  const { scope, state, setSearch } = context;
  const refused = state.invalid.focus !== null;
  // The home page is the first by path in any scope, so the link scope is not part of this read: a change of scope
  // must not send the tab back to loading (which would end the canvas's selection and moved cards)
  const home = useQuery({
    ...pagesQuery(scope, { ...DEFAULT_PAGE_QUERY, sort: 'path', limit: 1 }, context.crawl.run),
    enabled: state.focus === null && !refused,
    select: readPageRows,
  });
  const focusId = state.focus ?? home.data?.data[0]?.url_id ?? null;
  const detail = useQuery({
    ...pageDetailQuery(scope, focusId ?? NO_FOCUS, state.scope, context.crawl.run),
    enabled: focusId !== null && !refused,
    // A change of link scope keeps the page on screen while it is read again; another page never shows as this one
    placeholderData: keepPreviousData,
  });
  const loaded = detail.data?.data.page.url_id === focusId ? detail.data.data.page : null;
  // The view of each focus page the tab has shown, for as long as the tab is open. Written by the canvas as it pans
  // and never read while rendering this tab: a pan is not a render of the tab.
  const [held] = useState<Map<string, View>>(() => new Map());
  // Where "more" rows of the tree list send the person: the Links tab for the links of one page
  const linksHref = (urlId: string): Route => {
    const side = state.treeDir === 'in' ? 'tgt' : 'src';
    const scopeKey = state.scope === 'editorial' ? '' : `&scope=${state.scope}`;
    return withQuery(context.hrefOf('/seo/internal-links'), `tab=links&${side}=${urlId}${scopeKey}`);
  };
  const section = useRef<HTMLElement>(null);
  // A refocus moves focus to the new focus page once it is on screen (the control that asked for it is gone)
  const moveFocus = useRef(false);

  // Choosing the page that is already the focus changes nothing: no history entry, the opened cards stay
  const refocus = (urlId: string): void => {
    if (urlId === focusId) return;
    moveFocus.current = true;
    setSearch({ focus: urlId, ...CLEARED }, { history: 'push' });
  };
  const goHome = (): void => {
    moveFocus.current = true;
    setSearch({ focus: null, ...CLEARED }, { history: 'push' });
  };
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
          { value: 'paths', label: paths('view'), icon: RouteIcon },
        ]}
        size="sm"
      />
      <FocusPicker
        scope={scope}
        run={context.crawl.run}
        path={loaded?.path ?? t('focus')}
        host={context.host}
        mode={state.journeyView === 'paths' ? 'paths' : 'focus'}
        onPick={refocus}
      />
      <ScopeMenu scope={state.scope} onChange={(next) => setSearch({ scope: next === 'editorial' ? null : next })} />
      {state.journeyView === 'canvas' ? (
        // The layout is how the canvas stands; the tree list has one layout
        <LayoutSwitch value={state.layout} onChange={(next) => setSearch({ jl: next === 'step' ? null : next })} />
      ) : null}
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
  let waiting = false;
  if (!context.crawl.linksAvailable) {
    // No neighbor read is made for a crawl whose links are gone (the API would answer 410 to each)
    body = <LinksDropped />;
  } else if (refused) {
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
    waiting = true;
    body = (
      <div className="flex flex-col gap-2 p-4" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} shape="block" height="row" />
        ))}
      </div>
    );
  } else if (state.journeyView === 'paths') {
    body = <PathFinder context={context} page={loaded} />;
  } else if (state.journeyView === 'tree') {
    body = (
      <TreeList
        scope={scope}
        run={context.crawl.run}
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
        onOrder={context.inspect.setOrder}
        linksHref={linksHref}
      />
    );
  } else {
    body = (
      // One canvas for each focus page: pinned return arrows are of the page they were pinned on
      <JourneyCanvas key={loaded.url_id} context={context} page={loaded} held={held} onRefocus={refocus} />
    );
  }

  // Focus follows a refocus onto the new focus page, or onto the section's heading in the tree list
  const loadedId = loaded?.url_id ?? null;
  const { journeyView } = state;
  useEffect(() => {
    if (!moveFocus.current || loadedId === null) return;
    moveFocus.current = false;
    const root = section.current;
    const target =
      journeyView !== 'canvas'
        ? root?.querySelector<HTMLElement>('#journey-title')
        : root?.querySelector<HTMLElement>('[data-node][data-key="f"]');
    target?.focus({ preventScroll: true });
  }, [loadedId, journeyView]);
  // A page that takes longer than 2 seconds says so once (20-accessibility.md section 6.9)
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = window.setTimeout(
      () => announce(t('loadingJourney'), { key: 'internal-links-journey-loading' }),
      LOADING_SAYS_MS,
    );
    return () => window.clearTimeout(timer);
  }, [waiting, t]);

  // By tier: one chip for each tier turns its lane off or on; the lane of the focus page stays on
  const laneChips =
    state.layout === 'tier' && state.journeyView === 'canvas' && loaded !== null ? (
      <div className="border-b border-border-subtle px-3 py-2">
        <LaneChips
          tiers={context.tiers}
          hidden={state.hiddenLanes}
          focusPosition={tierPosition(loaded.tier)}
          onToggle={(position) => {
            const next = new Set(state.hiddenLanes);
            if (!next.delete(position)) next.add(position);
            setSearch({ jt: formatLanes(next) });
          }}
        />
      </div>
    ) : null;

  return (
    <section
      ref={section}
      aria-labelledby="journey-title"
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      {/* The canvas's column titles are h3: this names the section above them */}
      <h2 id="journey-title" tabIndex={-1} className="sr-only">
        {t('heading')}
      </h2>
      {toolbar}
      {laneChips}
      {body}
    </section>
  );
}
