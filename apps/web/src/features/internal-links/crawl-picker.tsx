'use client';

import { History } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { formatTableDate } from '@/lib/format';
import { chosenCrawl } from '@/lib/internal-links/crawl-choice';
import type { CrawlRun } from '@/lib/internal-links/types';

export interface CrawlPickerProps {
  runs: readonly CrawlRun[];
  /** The crawl id in the address, or `null` for the latest. */
  run: string | null;
  timeZone: string;
  /** The tab in view reads links, so a crawl whose links were dropped cannot be chosen for it. */
  needsLinks: boolean;
  /** `null` is the latest crawl. */
  onChoose: (run: string | null) => void;
  /** "Back to latest": its own button goes away, so the caller says where focus goes. */
  onBack: () => void;
}

/** The catalog's camelCase keys of the API's triggers. */
const TRIGGER_KEY = {
  website_added: 'websiteAdded',
  schedule: 'schedule',
  manual: 'manual',
  ceiling_retry: 'ceilingRetry',
} as const satisfies Record<CrawlRun['trigger'], string>;

type DataState = 'ready' | 'stopped_at_ceiling';
const hasData = (state: CrawlRun['state']): state is DataState => state === 'ready' || state === 'stopped_at_ceiling';

/**
 * The crawl in scope and the menu of the project's crawls (spec 7.1 context line, 7.10 "Crawl picker"). Every crawl
 * is listed; one that is waiting, crawling, failed or cancelled has no data and says so instead of being choosable,
 * and one whose links were dropped is disabled for the tabs that read links, with the reason.
 */
export function CrawlPicker({
  runs,
  run,
  timeZone,
  needsLinks,
  onChoose,
  onBack,
}: CrawlPickerProps): ReactElement | null {
  const t = useTranslations('internalLinks.picker');
  const chosen = chosenCrawl(runs, run);
  if (chosen === null) return null;
  const dateOf = (item: CrawlRun): string => formatTableDate(item.finished_at ?? item.created_at, timeZone);
  const items: MenuItemDef[] = runs.map((item) => {
    const base = {
      id: item.run_id,
      label: dateOf(item),
      kind: 'radio' as const,
      checked: item.run_id === chosen.run_id,
      closeOnClick: true,
    };
    if (!hasData(item.state)) return { ...base, disabledReason: t(`state.${item.state}`) };
    if (needsLinks && !item.links_available) return { ...base, disabledReason: t('linksDropped') };
    return {
      ...base,
      detail: t('detail', { trigger: t(`trigger.${TRIGGER_KEY[item.trigger]}`), count: item.pages }),
      onSelect: () => onChoose(item.is_latest ? null : item.run_id),
    };
  });
  return (
    <span className="flex shrink-0 items-center gap-2">
      <Menu
        align="start"
        trigger={
          <Button variant="ghost" size="sm" icon={History}>
            {t('crawled', { date: dateOf(chosen), count: chosen.pages })}
          </Button>
        }
        items={items}
      />
      {chosen.is_latest ? null : (
        <>
          <Badge tone="warning">{t('older')}</Badge>
          <Button variant="secondary" size="sm" onClick={onBack}>
            {t('backToLatest')}
          </Button>
        </>
      )}
    </span>
  );
}
