'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, Ref } from 'react';

import { useImportantTiers } from './important-tiers';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { formatInteger } from '@/lib/format';
import { contextStats } from '@/lib/internal-links/context-stats';
import { overviewQuery, tierFlowQuery, worklistsQuery } from '@/lib/internal-links/queries';
import type { EdgeWorklist, LinksScope, PageView, PageWorklist } from '@/lib/internal-links/types';
import type { PagesState } from '@/lib/pages/url-state';
import { viewCounts, visibleViews, type ViewId } from '@/lib/pages/views';

/** The names the worklists keep under `internalLinks.worklists.*`. */
const WORKLIST_KEY = {
  under_linked_t1: 'underLinkedT1',
  orphans: 'orphans',
  editorial_orphans: 'editorialOrphans',
  deep_only_through_auto: 'deepOnlyThroughAuto',
  weak_outlinks: 'weakOutlinks',
  broken_and_redirected: 'brokenAndRedirected',
  links_to_non_indexable: 'linksToNonIndexable',
} as const;
type WorklistId = keyof typeof WORKLIST_KEY;
type PlainViewId = Exclude<ViewId, WorklistId | 'lost_links_top'>;

const isWorklistId = (id: ViewId): id is WorklistId => id in WORKLIST_KEY;
const isEdge = (id: ViewId): id is EdgeWorklist => id === 'broken_and_redirected' || id === 'links_to_non_indexable';

/** The name of a view as the menu, the trigger and the announcement say it. */
export function useViewLabel(scope: LinksScope): (id: ViewId) => string {
  const tv = useTranslations('pages.view');
  const tw = useTranslations('internalLinks.worklists');
  const { tiers } = useImportantTiers(scope);
  return (id) => {
    if (isWorklistId(id)) return tw(WORKLIST_KEY[id]);
    if (id === 'lost_links_top') return tiers === null ? tw('lostLinksTopFallback') : tw('lostLinksTop', { tiers });
    const plain: PlainViewId = id;
    return tv(plain);
  };
}

export interface ViewMenuProps {
  scope: LinksScope;
  /** The crawl the counts are of: `null` for the latest. */
  run: string | null;
  /** False for a crawl whose links were dropped: the weak outlinks list reads links and answers 410. */
  linksAvailable: boolean;
  state: Pick<PagesState, 'view' | 'worklist'>;
  untieredActive: boolean;
  onView: (view: PageView | PageWorklist | null) => void;
  onUntiered: () => void;
  onEdgeWorklist: (worklist: EdgeWorklist) => void;
  /** The trigger, so the caller can send focus to it. */
  triggerRef?: Ref<HTMLButtonElement>;
}

/** The id of the view in force: a server view or a worklist of the address, else Untiered, else All pages. */
export function activeViewId(state: Pick<PagesState, 'view' | 'worklist'>, untieredActive: boolean): ViewId {
  return state.view ?? state.worklist ?? (untieredActive ? 'untiered' : 'all');
}

/**
 * The View menu of All pages (spec 7.3): one trigger at the start of the table toolbar, the views by section with
 * the count of each as its detail. The counts are the totals the lists then show; while they load the items show
 * none and can still be chosen.
 */
export function ViewMenu({
  scope,
  run,
  linksAvailable,
  state,
  untieredActive,
  onView,
  onUntiered,
  onEdgeWorklist,
  triggerRef,
}: ViewMenuProps): ReactElement {
  const t = useTranslations('pages.view');
  const tl = useTranslations('internalLinks');
  const labelOf = useViewLabel(scope);
  const overview = useQuery(overviewQuery(scope, run)).data?.data;
  const worklists = useQuery(worklistsQuery(scope, run)).data?.data;
  const flow = useQuery(tierFlowQuery(scope, 'editorial', run)).data?.data;
  const { settled } = useImportantTiers(scope);
  const active = activeViewId(state, untieredActive);
  const known = overview !== undefined && worklists !== undefined;
  const untiered =
    flow === undefined ? null : contextStats({ tiers: flow.tiers, noEditorial: 0, lostToTop: 0 }).tiered.untiered;
  // The counts and the list of views are built together: a view's visibility depends on its count
  const counts = known ? viewCounts(overview, worklists, untiered) : {};
  // Until the sitemap is known its views are not offered; one that is active still shows in the trigger
  const entries = visibleViews(counts, active, known && overview.sitemap.state === 'read').filter(
    (entry) => (entry.id !== 'weak_outlinks' || linksAvailable) && (entry.id !== 'lost_links_top' || settled),
  );
  const items: MenuItemDef[] = entries.map((entry) => {
    const id = entry.id;
    const count = counts[id];
    const shared = {
      id,
      label: labelOf(id),
      group: t(`sections.${entry.section}`),
      detail: count === undefined ? undefined : formatInteger(count),
    };
    if (isEdge(id)) {
      return { ...shared, kind: 'action', description: t('opensLinks'), onSelect: () => onEdgeWorklist(id) };
    }
    return {
      ...shared,
      kind: 'radio',
      checked: id === active,
      closeOnClick: true,
      onSelect: () => {
        if (id === 'untiered') onUntiered();
        else if (id === 'all') onView(null);
        else onView(id);
      },
    };
  });
  // A line that is not a choice: the menu has no plain text row, so it is a disabled item with nothing at its end
  if (known && !entries.some((entry) => entry.section === 'linkProblems')) {
    items.push({
      id: 'no-issues',
      label: tl('pages.noIssues'),
      group: t('sections.linkProblems'),
      kind: 'action',
      disabledReason: '',
    });
  }
  if (known && worklists.may_be_incomplete) {
    items.push({ id: 'coverage', label: tl('coverage.incomplete'), kind: 'action', disabledReason: '' });
  }
  return (
    <Menu
      trigger={
        <Button ref={triggerRef} variant="secondary" size="sm">
          {t('trigger', { view: labelOf(active) })}
          <Icon icon={ChevronDown} size="sm" className="text-foreground-tertiary" />
        </Button>
      }
      items={items}
    />
  );
}
