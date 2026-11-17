'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type ReactElement, type RefObject } from 'react';

import { FocusNote } from './focus-note';
import { useNeighborLookup } from './use-neighbor-lookup';
import { BulkTierDialog } from '../pages/bulk-tier-dialog';
import { usePageBulk } from '../pages/use-page-bulk';
import type { LinksTabContext } from '../tabs';
import { LinkCanvas, type LinkCanvasProps } from '@/components/app/link-canvas/link-canvas';
import { EmptyState } from '@/components/app/status/empty-state';
import { toast } from '@/components/ui/toast';
import type { View } from '@/lib/internal-links/canvas-view';
import {
  formatKeySet,
  formatLanes,
  formatMore,
  parseKeySet,
  parseLanes,
  parseMore,
} from '@/lib/internal-links/journey-codec';
import { buildJourney, pruneJourney } from '@/lib/internal-links/journey-layout';
import {
  clampJourney,
  MAX_MORE_PRESSES,
  MAX_TOGETHER,
  openExclusive,
  openTogether,
  type OpenSets,
} from '@/lib/internal-links/journey-open';
import { DEFAULT_PAGE_QUERY } from '@/lib/internal-links/queries';
import type { Neighbor, PageRow } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';

const NO_PINS: ReadonlySet<string> = new Set();
/** Before the canvas has set the first view of a focus page. */
const START_VIEW: View = { x: 0, y: 0, scale: 1 };
const noop = (): void => undefined;

/** The canvas's one tab stop: where focus goes when the tier dialog closes (the table's stop is not on this tab). */
const canvasFocus: RefObject<HTMLElement | null> = {
  get current(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-node][tabindex="0"]');
  },
};

type ViewedProps = Omit<LinkCanvasProps<Neighbor>, 'view' | 'onViewChange' | 'holdsView'> & {
  /** The view of each focus page the tab has shown; written here, read once when the canvas for a page is made. */
  held: Map<string, View>;
};

/**
 * The only thing that renders on a pan or a zoom: it holds the view, so the host above (queries, layout, closures)
 * is left alone. The view is kept for the focus page in `held`, and read back when its canvas is made again.
 */
function ViewedCanvas({ held, ...props }: ViewedProps): ReactElement {
  const id = props.focus.urlId;
  const [before] = useState(() => held.get(id));
  const [view, setView] = useState<View>(before ?? START_VIEW);
  const change = useCallback(
    (next: View): void => {
      held.set(id, next);
      setView(next);
    },
    [held, id],
  );
  return <LinkCanvas<Neighbor> {...props} view={view} onViewChange={change} holdsView={before !== undefined} />;
}

/**
 * The canvas of the Journey tab. The address holds the focus page and the opened cards, groups and counts (the
 * canvas never writes them itself); the tab keeps the view of each focus page, and this host the pinned return
 * arrows. Selection and moved cards are the canvas's own state, so they last only while this canvas stays mounted:
 * leaving the tab or refocusing (the next focus page is read first, so this host is gone for a moment) starts them anew.
 */
export function JourneyCanvas({
  context,
  page,
  held,
  onRefocus,
}: {
  context: LinksTabContext;
  page: PageRow;
  held: Map<string, View>;
  onRefocus: (urlId: string) => void;
}): ReactElement {
  const t = useTranslations('internalLinks.journey');
  const { scope, state, setSearch, tiers, inspect } = context;
  const canWrite = useCan('projects:write');
  const { lookup, useLoad, retry, retryFailed } = useNeighborLookup(scope);
  // The lanes turned off, as text for the same reason as the opened sets: a write that leaves them alone changes nothing here
  const lanesText = formatLanes(state.hiddenLanes) ?? '';
  const hiddenLanes = useMemo(() => parseLanes(lanesText), [lanesText]);
  const laneTiers = useMemo(
    () => tiers.map((tier) => ({ position: tier.position, code: tier.code, name: tier.name })),
    [tiers],
  );
  const [pinned, setPinned] = useState<ReadonlySet<string>>(NO_PINS);
  const [tierIds, setTierIds] = useState<readonly string[] | null>(null);
  const bulk = usePageBulk(scope, DEFAULT_PAGE_QUERY, noop);

  // The sets as text: opening the inspector or any other write that leaves them alone changes their identity, not
  // their text, so it does not rebuild the journey. A typed address is cut to what a person can read (`clampJourney`).
  const openText = [...state.open].join(',');
  const groupText = [...state.groups].join(',');
  const moreText = [...state.more].map(([key, count]) => `${key}*${String(count)}`).join(',');
  const journey = useMemo(() => {
    const sets = clampJourney({
      open: parseKeySet(openText),
      groups: parseKeySet(groupText),
      more: parseMore(moreText),
    });
    return { focus: page.url_id, scope: state.scope, ...sets };
  }, [page.url_id, state.scope, openText, groupText, moreText]);
  // The lookup reads the cache and changes whenever a list does, so the layout is built again exactly then
  const layout = useMemo(() => buildJourney<Neighbor>(journey, lookup), [journey, lookup]);
  useLoad(layout.requests);

  // Keys of cards whose parent closed are dropped from the address once every list has loaded
  const stale = useMemo(() => pruneJourney(journey, layout), [journey, layout]);
  useEffect(() => {
    if (stale === null) return;
    setSearch({ open: formatKeySet(stale.open), grp: formatKeySet(stale.groups), more: formatMore(stale.more) });
  }, [stale, setSearch]);

  // The inspector steps through the pages on the canvas, focus page first, as the columns read
  const order = useMemo(() => {
    const ids = [page.url_id];
    for (const column of [...layout.out, ...[...layout.in].reverse()]) {
      for (const item of column.items) if (item.kind === 'card' && !ids.includes(item.urlId)) ids.push(item.urlId);
    }
    return ids;
  }, [layout, page.url_id]);
  const { setOrder } = inspect;
  useEffect(() => {
    setOrder(order);
    return () => setOrder([]);
  }, [order, setOrder]);

  const write = (next: OpenSets): void =>
    setSearch({ open: formatKeySet(next.open), grp: formatKeySet(next.groups), more: formatMore(next.more) });
  const current: OpenSets = { open: journey.open, groups: journey.groups, more: journey.more };
  const toggle = (key: string): void => write(openExclusive(current, key));
  const showMore = (key: string): void => {
    write({
      ...current,
      more: new Map(current.more).set(key, Math.min((current.more.get(key) ?? 0) + 1, MAX_MORE_PRESSES)),
    });
    // A page of the list that failed earlier is asked for again by the press that wants more of it
    retryFailed(layout.requests);
  };
  const showTheirLinks = (keys: readonly string[]): void => {
    const some = keys.slice(0, MAX_TOGETHER);
    write(openTogether(current, some));
    if (some.length < keys.length) {
      toast({
        type: 'info',
        title: t('showLinksCapTitle', { count: some.length }),
        description: t('showLinksCapText', { count: some.length, total: keys.length }),
      });
    }
  };
  const togglePin = useCallback((key: string): void => {
    setPinned((held_) => {
      const next = new Set(held_);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const openTierDialog = (ids: readonly string[]): void => {
    bulk.clearError();
    setTierIds(ids);
  };

  // Settled with no card at all: the page links to nothing and nothing links to it, in any kind of link
  const isolated = !layout.pending && layout.out.length === 0 && layout.in.length === 0;
  return (
    <>
      <ViewedCanvas
        held={held}
        layout={layout}
        focus={{
          urlId: page.url_id,
          path: page.path,
          title: page.title,
          tier: page.tier,
          linkingPages: page.linking_pages,
          linkingPagesAll: page.linking_pages_all,
          linksOut: page.outlinks,
          statusCode: page.status_code,
          clickDepth: page.click_depth,
        }}
        focusNote={<FocusNote page={page} scope={state.scope} />}
        pinned={pinned}
        onTogglePin={togglePin}
        onToggleCard={toggle}
        onToggleGroup={toggle}
        onMore={showMore}
        onRefocus={onRefocus}
        onDetails={inspect.open}
        onRetry={retry}
        // A toast is announced by the toast region; the canvas keeps focus on the card
        onFull={() => toast({ type: 'info', title: t('full'), description: t('fullText') })}
        onShowLinks={showTheirLinks}
        onSetTier={canWrite ? openTierDialog : undefined}
        layoutMode={state.layout}
        tiers={laneTiers}
        hiddenLanes={hiddenLanes}
      />
      {isolated ? (
        <EmptyState variant="inline" title={t('noLinksTitle')} reason={t('noLinksReason')} headingLevel={3} />
      ) : null}
      <BulkTierDialog
        open={tierIds !== null}
        onOpenChange={(open) => {
          if (!open) setTierIds(null);
        }}
        count={tierIds?.length ?? 0}
        tiers={tiers}
        pending={bulk.pending}
        alert={bulk.error}
        finalFocus={canvasFocus}
        onSetTier={(tier) => bulk.setTier({ ids: tierIds ?? [], allMatching: false }, tier, 'dialog')}
        onReset={() => bulk.resetToRule({ ids: tierIds ?? [], allMatching: false }, 'dialog')}
      />
    </>
  );
}
