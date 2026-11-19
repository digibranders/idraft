'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, type ReactElement } from 'react';

import { useImportantTiers } from './important-tiers';
import { TierSuggestions } from './tier-suggestions';
import { Button } from '@/components/ui/button';
import { formatInteger } from '@/lib/format';
import { worklistsQuery } from '@/lib/internal-links/queries';
import type { EdgeWorklist, LinksScope, PageWorklist, Worklists } from '@/lib/internal-links/types';

const PAGE_LISTS: readonly (readonly [
  PageWorklist,
  'underLinkedT1' | 'orphans' | 'editorialOrphans' | 'deepOnlyThroughAuto',
])[] = [
  ['under_linked_t1', 'underLinkedT1'],
  ['orphans', 'orphans'],
  ['editorial_orphans', 'editorialOrphans'],
  ['deep_only_through_auto', 'deepOnlyThroughAuto'],
];
const EDGE_LISTS: readonly (readonly [EdgeWorklist, 'brokenAndRedirected' | 'linksToNonIndexable'])[] = [
  ['broken_and_redirected', 'brokenAndRedirected'],
  ['links_to_non_indexable', 'linksToNonIndexable'],
];

/**
 * The saved worklists of spec 7.2 as the mock's issue chips: All pages, the four page worklists with their counts,
 * and the two link worklists, which count links and open the Links tab (decision W17, gap G2). A chip that is on is
 * a toggle button (`aria-pressed`), which the button draws with the selected fill.
 */
export function WorklistChips({
  scope,
  run,
  linksAvailable,
  current,
  onPick,
  onPickEdges,
}: {
  scope: LinksScope;
  /** The crawl the counts are of: `null` for the latest. */
  run: string | null;
  /** False for a crawl whose links were dropped: the weak outlinks list reads links and answers 410, so it is not offered. */
  linksAvailable: boolean;
  current: PageWorklist | null;
  onPick: (worklist: PageWorklist | null) => void;
  onPickEdges: (worklist: EdgeWorklist) => void;
}): ReactElement {
  const t = useTranslations('internalLinks');
  const read = useQuery(worklistsQuery(scope, run));
  const counts: Worklists | undefined = read.data?.data;
  const { tiers, settled } = useImportantTiers(scope);
  const allPages = useRef<HTMLButtonElement>(null);
  // The last suggestion went, and with it the chip that held focus
  const focusAllPages = useCallback((): void => allPages.current?.focus(), []);
  const history: readonly (readonly [PageWorklist, string])[] = [
    // Held until the setting is read, so the chip's name does not change under the user
    ...(settled
      ? ([
          [
            'lost_links_top',
            tiers === null ? t('worklists.lostLinksTopFallback') : t('worklists.lostLinksTop', { tiers }),
          ],
        ] as const)
      : []),
    ...(linksAvailable ? ([['weak_outlinks', t('worklists.weakOutlinks')]] as const) : []),
  ];
  return (
    <div role="group" aria-label={t('pages.worklistsLabel')} className="flex flex-wrap items-center gap-2">
      <Button ref={allPages} variant="secondary" size="sm" aria-pressed={current === null} onClick={() => onPick(null)}>
        {t('pages.allPages')}
      </Button>
      {PAGE_LISTS.map(([id, key]) => (
        <Button key={id} variant="secondary" size="sm" aria-pressed={current === id} onClick={() => onPick(id)}>
          {t(`worklists.${key}`)}{' '}
          <span className="num type-body-strong">{counts === undefined ? '' : formatInteger(counts[id])}</span>
        </Button>
      ))}
      {EDGE_LISTS.map(([id, key]) => (
        <Button key={id} variant="secondary" size="sm" onClick={() => onPickEdges(id)}>
          {t(`worklists.${key}`)}{' '}
          <span className="num type-body-strong">
            {counts === undefined ? '' : t('pages.linkCount', { count: counts[id] })}
          </span>
        </Button>
      ))}
      {history.map(([id, label]) => (
        <Button key={id} variant="secondary" size="sm" aria-pressed={current === id} onClick={() => onPick(id)}>
          {label} <span className="num type-body-strong">{counts === undefined ? '' : formatInteger(counts[id])}</span>
        </Button>
      ))}
      {counts !== undefined && [...PAGE_LISTS, ...EDGE_LISTS, ...history].every(([id]) => counts[id] === 0) ? (
        <span className="type-meta text-foreground-tertiary">{t('pages.noIssues')}</span>
      ) : null}
      <TierSuggestions scope={scope} onEmptied={focusAllPages} />
    </div>
  );
}
