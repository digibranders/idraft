'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { PreviewCard } from '@/components/ui/preview-card';
import type { TrackedKeywordRow, UrlRef } from '@/lib/api/types';
import { formatRelative } from '@/lib/format/date';
import type { Device, DeviceScope, PairedRow } from './keyword-pairs';

/** One page of the project that ranks for a keyword, with its rank on each device the table shows. */
export interface RankingPage {
  url: UrlRef;
  ranks: Partial<Record<Device, number>>;
  /** The page holds the rank another page holds: a sub-result (sitelink) of it. */
  sharesRank: boolean;
}

const bestRank = (page: RankingPage): number => Math.min(...Object.values(page.ranks), Number.POSITIVE_INFINITY);

const devicesOf = (scope: DeviceScope): readonly Device[] => (scope === 'both' ? ['desktop', 'mobile'] : [scope]);

/**
 * The pages that rank for a keyword on the devices shown, best rank first. A page that ranks on both devices is
 * one entry with a rank for each. A keyword whose rows did not carry the pages (`include=ranking_urls` not
 * asked) has the one page its state names.
 */
export function rankingPages(row: TrackedKeywordRow | PairedRow, scope: DeviceScope): RankingPage[] {
  const found = new Map<string, RankingPage>();
  // A row that is not paired is one device's tracked keyword
  const devices: PairedRow['devices'] =
    'devices' in row
      ? row.devices
      : { desktop: row.device === 'desktop' ? row : null, mobile: row.device === 'mobile' ? row : null };
  const tracked = devicesOf(scope).flatMap((device): [Device, TrackedKeywordRow][] => {
    const own = devices[device];
    return own === null ? [] : [[device, own]];
  });
  for (const [device, own] of tracked) {
    for (const page of own.ranking_urls ?? []) {
      const entry = found.get(page.url.url_id) ?? { url: page.url, ranks: {}, sharesRank: false };
      entry.ranks[device] = page.rank;
      entry.sharesRank = entry.sharesRank || page.shares_rank;
      found.set(page.url.url_id, entry);
    }
  }
  if (found.size === 0) {
    for (const [device, own] of tracked) {
      const { url, rank, state } = own.state.current;
      if (state !== 'ranked' || url === null || rank === null) continue;
      const entry = found.get(url.url_id) ?? { url, ranks: {}, sharesRank: false };
      entry.ranks[device] = rank;
      found.set(url.url_id, entry);
    }
  }
  return [...found.values()].sort((a, b) => bestRank(a) - bestRank(b));
}

export interface RankingPagesCardProps {
  /** The arrow beside the keyword: a link to the best page. */
  trigger: ReactElement;
  pages: readonly RankingPage[];
  scope: DeviceScope;
  /** When the keyword was last checked. */
  checkedAt: string | null;
  timeZone: string;
}

/**
 * The pages that rank for a keyword, on hover and focus of the arrow beside its name: each page with its rank on
 * the devices shown. Two or more pages for one keyword can hold each other back, which the card says. A longer
 * analysis (a page's history, the competitors in the same results) is the detail popup that comes later.
 */
export function RankingPagesCard({ trigger, pages, scope, checkedAt, timeZone }: RankingPagesCardProps): ReactElement {
  const t = useTranslations('rankings.pages');
  const rank = useTranslations('rankings.rank');
  const devices = devicesOf(scope);
  const deviceLabel: Record<Device, string> = { desktop: rank('rankDesktop'), mobile: rank('rankMobile') };
  return (
    <PreviewCard trigger={trigger} label={t('label')} className="w-auto max-w-(--size-popover-max) min-w-80 gap-2">
      <p className="type-meta text-foreground-secondary">{t('title', { count: pages.length })}</p>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th scope="col" className="pb-1 text-left type-table-header text-foreground-tertiary">
              {t('page')}
            </th>
            {devices.map((device) => (
              <th key={device} scope="col" className="pb-1 pl-4 text-right type-table-header text-foreground-tertiary">
                {deviceLabel[device]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pages.map((page, index) => (
            <tr key={page.url.url_id} className="border-t border-border-subtle align-top">
              <td className="max-w-72 py-1.5">
                <a
                  href={page.url.canonical_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate type-body text-link hover:underline"
                >
                  {page.url.path}
                </a>
                {index === 0 && pages.length > 1 ? (
                  <span className="type-meta text-foreground-tertiary">{t('best')}</span>
                ) : page.sharesRank ? (
                  <span className="type-meta text-foreground-tertiary">{t('subResult')}</span>
                ) : null}
              </td>
              {devices.map((device) => (
                <td key={device} className="py-1.5 pl-4 text-right num type-table text-foreground">
                  {page.ranks[device] ?? t('beyond')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {checkedAt === null ? null : (
        <p className="type-meta text-foreground-tertiary">
          {t('checked', { time: formatRelative(checkedAt, timeZone) })}
          {pages.length > 1 ? ` ${t('competing')}` : ''}
        </p>
      )}
    </PreviewCard>
  );
}
