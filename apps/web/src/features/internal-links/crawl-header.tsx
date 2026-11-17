'use client';

import { Download, MoreHorizontal, Radar, RefreshCw } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { CrawlButton } from './crawl-button';
import { isActive } from './crawl-reads';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { formatRelative, formatTableDate } from '@/lib/format';
import type { CrawlRun } from '@/lib/internal-links/types';

export interface CrawlHeaderProps {
  latest: CrawlRun | null;
  active: CrawlRun | null;
  timeZone: string;
  canCrawl: boolean;
  /** Whether the role may change the workspace's tiers (`workspace:update`); the link to them is left out without it. */
  canEditTiers: boolean;
  crawlPending: boolean;
  onCrawlNow: () => void;
  onExport: (() => void) | null;
  /** A download is being made: Export waits for it, and says so. */
  exporting?: boolean | undefined;
  /** Items Task 13 adds (Tier rules, Import tiers from CSV) before the settings links. */
  extraItems?: readonly MenuItemDef[] | undefined;
  settingsHref: Route;
  tiersHref: Route;
}

/**
 * The page actions (mock `il.js` `pageRow`): the crawl in scope ("Crawled 14 Nov, 40 pages"; no picker in slice 1,
 * decision W19), More actions, Export and Crawl now. While a crawl runs, Crawl now reads "Crawling" with the busy
 * spinner, ignores clicks and says when the crawl started; it stays in the tab order, so that tooltip can be read.
 */
export function CrawlHeader({
  latest,
  active,
  timeZone,
  canCrawl,
  canEditTiers,
  crawlPending,
  onCrawlNow,
  onExport,
  exporting = false,
  extraItems = [],
  settingsHref,
  tiersHref,
}: CrawlHeaderProps): ReactElement {
  const t = useTranslations('internalLinks.header');
  const running = active !== null && isActive(active);
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
  ];
  const exportItems: MenuItemDef[] = [
    {
      id: 'export-tab',
      label: t('exportTab'),
      icon: Download,
      ...(onExport === null
        ? { disabledReason: t('exportNone') }
        : exporting
          ? { disabledReason: t('exportRunning') }
          : { onSelect: onExport }),
    },
  ];
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
      {latest === null ? null : (
        <span className="flex items-center gap-1.5 type-meta whitespace-nowrap text-foreground-secondary">
          <Icon icon={Radar} size="sm" className="text-foreground-tertiary" />
          <span className="num">
            {t('crawled', {
              date: formatTableDate(latest.finished_at ?? latest.created_at, timeZone),
              count: latest.pages_crawled,
            })}
          </span>
        </span>
      )}
      <Menu
        align="end"
        trigger={<IconButton icon={MoreHorizontal} variant="secondary" size="icon-sm" label={t('moreActions')} />}
        items={moreItems}
      />
      <Menu
        align="end"
        trigger={
          <Button variant="secondary" size="sm" icon={Download}>
            {t('export')}
          </Button>
        }
        items={exportItems}
      />
      <CrawlButton
        label={running ? t('crawling') : t('crawlNow')}
        icon={RefreshCw}
        canCrawl={canCrawl}
        pending={crawlPending}
        startedAgo={running ? formatRelative(active.created_at, timeZone) : null}
        onClick={onCrawlNow}
      />
    </div>
  );
}
