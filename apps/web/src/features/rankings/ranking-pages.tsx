'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { PreviewCard } from '@/components/ui/preview-card';
import type { TrackedKeywordRow, UrlRef } from '@/lib/api/types';
import { formatRelative } from '@/lib/format/date';
import type { Device, PairedRow } from './keyword-pairs';

/** One page of the project that ranks for a keyword, with its rank on the device the table shows. */
export interface RankingPage {
  url: UrlRef;
  rank: number;
  /** The page holds the rank another page holds: a sub-result (sitelink) of it. */
  sharesRank: boolean;
}

/**
 * The pages that rank for a keyword on the device shown, best rank first. A keyword whose rows did not carry
 * the pages (`include=ranking_urls` not asked) has the one page its state names.
 */
export function rankingPages(row: TrackedKeywordRow | PairedRow, device: Device): RankingPage[] {
  const found = new Map<string, RankingPage>();
  // A row that is not paired is one device's tracked keyword
  const devices: PairedRow['devices'] =
    'devices' in row
      ? row.devices
      : { desktop: row.device === 'desktop' ? row : null, mobile: row.device === 'mobile' ? row : null };
  const own = devices[device];
  if (own === null) return [];
  for (const page of own.ranking_urls ?? []) {
    const entry = found.get(page.url.url_id) ?? { url: page.url, rank: page.rank, sharesRank: false };
    entry.rank = page.rank;
    entry.sharesRank = entry.sharesRank || page.shares_rank;
    found.set(page.url.url_id, entry);
  }
  if (found.size === 0) {
    const { url, rank, state } = own.state.current;
    if (state === 'ranked' && url !== null && rank !== null) {
      found.set(url.url_id, { url, rank, sharesRank: false });
    }
  }
  return [...found.values()].sort((a, b) => a.rank - b.rank);
}

export interface RankingPagesCardProps {
  /** The arrow beside the keyword: a link to the best page. */
  trigger: ReactElement;
  pages: readonly RankingPage[];
  /** When the keyword was last checked. */
  checkedAt: string | null;
  timeZone: string;
}

/**
 * The pages that rank for a keyword, on hover and focus of the arrow beside its name: each page with its rank on
 * the device shown. Two or more pages for one keyword can hold each other back, which the card says. A longer
 * analysis (a page's history, the competitors in the same results) is the detail popup that comes later.
 */
export function RankingPagesCard({ trigger, pages, checkedAt, timeZone }: RankingPagesCardProps): ReactElement {
  const t = useTranslations('rankings.pages');
  const rank = useTranslations('rankings.rank');
  return (
    <PreviewCard trigger={trigger} label={t('label')} className="w-auto max-w-(--size-popover-max) min-w-80 gap-2">
      <p className="type-meta text-foreground-secondary">{t('title', { count: pages.length })}</p>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th scope="col" className="pb-1 text-left type-table-header text-foreground-tertiary">
              {t('page')}
            </th>
            <th scope="col" className="pb-1 pl-4 text-right type-table-header text-foreground-tertiary">
              {rank('rank')}
            </th>
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
              <td className="py-1.5 pl-4 text-right num type-table text-foreground">{page.rank}</td>
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
