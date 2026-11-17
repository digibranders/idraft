'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';

import { FocusNote } from './focus-note';
import { useNeighborLookup, useNeighborVersion } from './use-neighbor-lookup';
import { BulkTierDialog } from '../pages/bulk-tier-dialog';
import { usePageBulk } from '../pages/use-page-bulk';
import type { LinksTabContext } from '../tabs';
import { EmptyState } from '@/components/app/status/empty-state';
import { LinkCanvas } from '@/components/app/link-canvas/link-canvas';
import { toast } from '@/components/ui/toast';
import type { View } from '@/lib/internal-links/canvas-view';
import { formatKeySet, formatMore } from '@/lib/internal-links/journey-codec';
import { buildJourney, pruneJourney } from '@/lib/internal-links/journey-layout';
import { openExclusive, openTogether, type OpenSets } from '@/lib/internal-links/journey-open';
import { DEFAULT_PAGE_QUERY } from '@/lib/internal-links/queries';
import type { Neighbor, PageRow } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';

const NO_PINS: ReadonlySet<string> = new Set();
const noop = (): void => undefined;

/**
 * The canvas of the Journey tab. The address holds the focus page and the opened cards, groups and counts (the
 * canvas never writes them itself); the tab owns the view of each focus page, and this host the pinned return arrows.
 * Selection and moved cards are the canvas's own state, so they last only while this canvas stays mounted: leaving
 * the tab or refocusing (the next focus page is read first, so this host is gone for a moment) starts them anew.
 */
export function JourneyCanvas({
  context,
  page,
  view,
  onViewChange,
  onRefocus,
}: {
  context: LinksTabContext;
  page: PageRow;
  /** The view of this focus page: the tab keeps one for each, so it survives the canvas being shown again. */
  view: View;
  onViewChange: (view: View) => void;
  onRefocus: (urlId: string) => void;
}): ReactElement {
  const t = useTranslations('internalLinks.journey');
  const { scope, state, setSearch, tiers, inspect } = context;
  const canWrite = useCan('projects:write');
  const { lookup, useLoad, retry } = useNeighborLookup(scope);
  const version = useNeighborVersion(scope);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(NO_PINS);
  const [tierIds, setTierIds] = useState<readonly string[] | null>(null);
  const bulk = usePageBulk(scope, DEFAULT_PAGE_QUERY, noop);

  const journey = useMemo(
    () => ({ focus: page.url_id, scope: state.scope, open: state.open, groups: state.groups, more: state.more }),
    [page.url_id, state.scope, state.open, state.groups, state.more],
  );
  // The lookup reads the cache, which is no subscription: `version` renders the layout again when a list arrives
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => buildJourney<Neighbor>(journey, lookup), [journey, lookup, version]);
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
  const current: OpenSets = { open: state.open, groups: state.groups, more: state.more };
  const toggle = (key: string): void => write(openExclusive(current, key));
  const showMore = (key: string): void =>
    write({ ...current, more: new Map(current.more).set(key, (current.more.get(key) ?? 0) + 1) });
  const showTheirLinks = (keys: readonly string[]): void => write(openTogether(current, keys));

  const togglePin = useCallback((key: string): void => {
    setPinned((held) => {
      const next = new Set(held);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  // Settled with no card at all: the page links to nothing and nothing links to it, in any kind of link
  if (!layout.pending && layout.out.length === 0 && layout.in.length === 0) {
    return <EmptyState title={t('noLinksTitle')} reason={t('noLinksReason')} headingLevel={3} />;
  }
  return (
    <>
      <LinkCanvas<Neighbor>
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
        view={view}
        onViewChange={onViewChange}
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
        onSetTier={canWrite ? setTierIds : undefined}
      />
      <BulkTierDialog
        open={tierIds !== null}
        onOpenChange={(open) => {
          if (!open) setTierIds(null);
        }}
        count={tierIds?.length ?? 0}
        tiers={tiers}
        pending={bulk.pending}
        alert={bulk.error}
        onSetTier={(tier) => bulk.setTier({ ids: tierIds ?? [], allMatching: false }, tier, 'dialog')}
        onReset={() => bulk.resetToRule({ ids: tierIds ?? [], allMatching: false }, 'dialog')}
      />
    </>
  );
}
