'use client';

import { Download, FileText, MoreHorizontal, RefreshCw } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

import { CrawlButton } from './crawl-button';
import { isActive } from './crawl-reads';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { MEDIA, useMediaQuery } from '@/lib/dom/use-media-query';
import { formatRelative } from '@/lib/format';
import type { CrawlRun } from '@/lib/internal-links/types';

export interface CrawlHeaderProps {
  /** The tab list; absent where there is no panel to switch. */
  tabs?: ReactElement | undefined;
  /** The chosen tab's id, to scroll it into view when the tab list scrolls sideways. */
  activeTab?: string | undefined;
  /** Line 2: the crawl picker and the context line. */
  context?: ReactNode | undefined;
  active: CrawlRun | null;
  timeZone: string;
  canCrawl: boolean;
  /** Whether the role may change the workspace's tiers (`workspace:update`); the link to them is left out without it. */
  canEditTiers: boolean;
  crawlPending: boolean;
  /** The API said crawls are not switched on yet: Crawl now waits, with that reason. */
  crawlsOff?: boolean | undefined;
  onCrawlNow: () => void;
  onExport: (() => void) | null;
  /** A download is being made: Export waits for it, and says so. */
  exporting?: boolean | undefined;
  /** Builds the client summary of the crawl in view; `null` while there is no crawl to summarise. */
  onSummary?: (() => void) | null | undefined;
  /** The summary is being made: its entry waits for it, and says so. */
  summaryPreparing?: boolean | undefined;
  /** Items of the screen (Tier rules, Import tiers from CSV) before the settings links. */
  extraItems?: readonly MenuItemDef[] | undefined;
  settingsHref: Route;
  tiersHref: Route;
}

/**
 * The page header in two lines (spec 7.1, mock `pageRow`). Line 1: the tabs on the left, Crawl now, Export and More
 * on the right. Line 2: the crawl picker and the key numbers, one scrolling line. Below `md` the tabs take the whole
 * first line and scroll sideways with the chosen tab in view, the actions drop to a line of their own, right aligned,
 * and Export moves into More. While a crawl runs, Crawl now reads "Crawling" with the busy spinner, ignores clicks and
 * says when the crawl started; it stays in the tab order, so that tooltip can be read.
 */
export function CrawlHeader({
  tabs,
  activeTab,
  context,
  active,
  timeZone,
  canCrawl,
  canEditTiers,
  crawlPending,
  crawlsOff = false,
  onCrawlNow,
  onExport,
  exporting = false,
  onSummary = null,
  summaryPreparing = false,
  extraItems = [],
  settingsHref,
  tiersHref,
}: CrawlHeaderProps): ReactElement {
  const t = useTranslations('internalLinks.header');
  const tabsRef = useRef<HTMLDivElement>(null);
  const wide = useMediaQuery(MEDIA.md);
  const running = active !== null && isActive(active);
  // A tab list wider than the room scrolls inside itself: the chosen tab must never be the one that is cut off
  useEffect(() => {
    const list = tabsRef.current?.querySelector<HTMLElement>('[role="tablist"]');
    const current = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list != null && current != null && list.scrollWidth > list.clientWidth) {
      list.scrollLeft = Math.max(0, current.offsetLeft - 16);
    }
  }, [activeTab]);
  const exportItem: MenuItemDef = {
    id: 'export-tab',
    label: t('exportTab'),
    icon: Download,
    ...(onExport === null
      ? { disabledReason: t('exportNone') }
      : exporting
        ? { disabledReason: t('exportRunning') }
        : { onSelect: onExport }),
  };
  const summaryItem: MenuItemDef = {
    id: 'export-summary',
    label: summaryPreparing ? t('summaryRunning') : t('summary'),
    icon: FileText,
    ...(onSummary === null
      ? { disabledReason: t('summaryNone') }
      : summaryPreparing
        ? { disabledReason: t('summaryRunning') }
        : { onSelect: onSummary }),
  };
  const moreItems: MenuItemDef[] = [
    ...extraItems,
    { id: 'crawl-settings', kind: 'link', label: t('crawlSettings'), link: <Link href={settingsHref} /> },
    ...(canEditTiers
      ? [
          {
            id: 'edit-tiers',
            kind: 'link' as const,
            label: t('editTiers'),
            detail: t('workspace'),
            link: <Link href={tiersHref} />,
          },
        ]
      : []),
    ...(wide ? [] : [exportItem, summaryItem].map((item) => ({ ...item, group: t('export') }))),
  ];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:flex-nowrap">
        {tabs === undefined ? null : (
          <div ref={tabsRef} className="max-w-full min-w-0 basis-full md:basis-auto">
            {tabs}
          </div>
        )}
        <div className="flex shrink-0 basis-full items-center justify-end gap-2 md:ml-auto md:basis-auto">
          <CrawlButton
            label={running ? t('crawling') : t('crawlNow')}
            icon={RefreshCw}
            canCrawl={canCrawl}
            pending={crawlPending}
            crawlsOff={crawlsOff}
            startedAgo={running ? formatRelative(active.created_at, timeZone) : null}
            onClick={onCrawlNow}
          />
          <Menu
            align="end"
            trigger={
              <Button variant="secondary" size="sm" icon={Download} className="hidden md:inline-flex">
                {t('export')}
              </Button>
            }
            items={[exportItem, summaryItem]}
          />
          <Menu
            align="end"
            trigger={<IconButton icon={MoreHorizontal} variant="secondary" size="icon-sm" label={t('moreActions')} />}
            items={moreItems}
          />
        </div>
      </div>
      {context === undefined ? null : <div className="flex min-w-0 items-center gap-3">{context}</div>}
    </div>
  );
}
