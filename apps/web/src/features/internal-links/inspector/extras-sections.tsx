'use client';

import { Anchor, Globe, History, Search, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { Badge } from '@/components/ui/badge';
import { formatInteger, formatPercent } from '@/lib/format';
import { changeParts, type Comparison, type DepthPart } from '@/lib/internal-links/page-extras';
import type { PageDetailExtras } from '@/lib/internal-links/types';
import { cn } from '@/lib/utils';

type Translate = ReturnType<typeof useTranslations<'internalLinks.inspectorExtras'>>;

const TONE_CLASS = {
  positive: 'text-positive-text',
  negative: 'text-negative-text',
  warning: 'text-warning-text',
  neutral: 'text-foreground-tertiary',
} as const;

const HEAD = 'py-1 pr-2 text-left type-table-header text-foreground-tertiary last:pr-0';
const ROW_HEAD =
  'min-w-0 break-words border-t border-border-subtle py-1.5 pr-2 text-left type-table font-normal text-foreground';
const CELL = 'border-t border-border-subtle py-1.5 pr-2 type-table last:pr-0';

const muted = (text: string): ReactElement => <p className="type-body text-foreground-tertiary">{text}</p>;

function depthText(t: Translate, depth: DepthPart): string {
  switch (depth.state) {
    case 'lost':
      return t('unreachable');
    case 'found':
      return t('reachable');
    case 'closer':
      return t('shallower', { count: depth.levels });
    case 'deeper':
      return t('deeper', { count: depth.levels });
  }
}

/** Depth reads better as a move to a shallower page, so only that is positive. */
const depthTone = (depth: DepthPart): keyof typeof TONE_CLASS =>
  depth.state === 'closer' || depth.state === 'found' ? 'positive' : 'negative';

function ChangesBody({
  t,
  extras,
  comparison,
}: {
  t: Translate;
  extras: PageDetailExtras;
  comparison: Comparison;
}): ReactElement {
  // A crawl with a comparison in hand but no change for the page reads as not available, never as zero
  if (extras.change === null) return muted(comparison === 'updating' ? t('updating') : t('unavailable'));
  const parts = changeParts(extras.change);
  if (parts.kind === 'new') return <Badge tone="neutral">{t('newPage')}</Badge>;
  if (parts.kind === 'none') return muted(t('noChange'));
  return (
    <dl className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <dt className="type-table text-foreground-secondary">{t('editorialIn')}</dt>
        <dd className={cn('num type-table', parts.links === null ? TONE_CLASS.neutral : TONE_CLASS[parts.links.tone])}>
          {parts.links === null ? t('unchangedValue') : parts.links.text}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-2">
        <dt className="type-table text-foreground-secondary">{t('depth')}</dt>
        <dd
          className={cn('type-table', parts.depth === null ? TONE_CLASS.neutral : TONE_CLASS[depthTone(parts.depth)])}
        >
          {parts.depth === null ? t('unchangedValue') : depthText(t, parts.depth)}
        </dd>
      </div>
    </dl>
  );
}

function KeywordsBody({ t, rows }: { t: Translate; rows: PageDetailExtras['keywords'] }): ReactElement {
  if (rows.length === 0) return muted(t('noKeywords'));
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full">
        <caption className="sr-only">{t('keywordsCaption')}</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              {t('keyword')}
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              {t('rank')}
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              {t('moved')}
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              {t('volume')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.keyword}>
              <th scope="row" className={ROW_HEAD}>
                {row.keyword}
              </th>
              <td className={cn(CELL, 'text-right num')}>
                {row.rank === null ? (
                  <span className="text-foreground-tertiary">{t('noRank')}</span>
                ) : (
                  t('rankValue', { rank: formatInteger(row.rank) })
                )}
              </td>
              <td className={cn(CELL, 'text-right num')}>{moved(t, row.change)}</td>
              <td className={cn(CELL, 'text-right num')}>{formatInteger(row.volume)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="type-meta text-foreground-tertiary">{t('keywordsSource')}</p>
    </div>
  );
}

function moved(t: Translate, change: number | null): ReactNode {
  if (change === null || change === 0) return <span className="text-foreground-tertiary">{formatInteger(null)}</span>;
  return change > 0 ? (
    <span className="text-positive-text">{t('up', { count: change })}</span>
  ) : (
    <span className="text-negative-text">{t('down', { count: Math.abs(change) })}</span>
  );
}

function CitationsBody({ t, counts }: { t: Translate; counts: PageDetailExtras['citations'] }): ReactElement {
  const engines = [
    { id: 'chatgpt', label: t('chatgpt'), value: counts.chatgpt },
    { id: 'gemini', label: t('gemini'), value: counts.gemini },
    { id: 'aiMode', label: t('aiMode'), value: counts.ai_mode },
  ];
  return (
    <div className="flex flex-col gap-2">
      {counts.total === 0 ? null : (
        <dl className="grid grid-cols-3 rounded-md border border-border">
          {engines.map((engine) => (
            <div key={engine.id} className="flex flex-col px-2 py-2 not-last:border-r not-last:border-border">
              <dt className="type-label text-foreground-tertiary">{engine.label}</dt>
              <dd className="num type-body-strong text-foreground">{formatInteger(engine.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="type-body text-foreground">{t('cited', { count: counts.total })}</p>
      <p className="type-meta text-foreground-tertiary">{t('citationsSub')}</p>
    </div>
  );
}

function AnchorsBody({
  t,
  anchors,
  linksAvailable,
}: {
  t: Translate;
  anchors: PageDetailExtras['anchors'];
  linksAvailable: boolean;
}): ReactElement {
  // The crawl keeps counts only: no texts, no distinct count and no keyword match
  if (!linksAvailable || anchors.distinct === null || anchors.top === null) {
    return (
      <div className="flex flex-col gap-1">
        <p className="type-body text-foreground-tertiary">{t('notStored')}</p>
        <p className="type-meta text-foreground-tertiary">{t('notStoredReason')}</p>
      </div>
    );
  }
  if (anchors.total === 0) return muted(t('noAnchors'));
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full">
        <caption className="sr-only">{t('anchorsCaption')}</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              {t('anchorText')}
            </th>
            <th scope="col" className={cn(HEAD, 'text-right')}>
              {t('links')}
            </th>
          </tr>
        </thead>
        <tbody>
          {anchors.top.map((anchor) => (
            <tr key={anchor.text}>
              <th scope="row" className={ROW_HEAD}>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 break-words">{t('anchorQuoted', { anchor: anchor.text })}</span>
                  {anchor.generic ? <Badge tone="warning">{t('generic')}</Badge> : null}
                </span>
              </th>
              <td className={cn(CELL, 'text-right num text-foreground-secondary')}>{formatInteger(anchor.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="num type-meta text-foreground-secondary">
        {t('anchorSummary', {
          distinct: formatInteger(anchors.distinct),
          share: formatPercent(anchors.generic_share, { decimals: 0 }),
        })}
      </p>
      {anchors.matches_keyword === null ? null : (
        <p className={cn('type-meta', anchors.matches_keyword ? 'text-positive-text' : 'text-warning-text')}>
          {anchors.matches_keyword ? t('matches') : t('noMatch')}
        </p>
      )}
    </div>
  );
}

function GoogleBody({ t, gsc }: { t: Translate; gsc: PageDetailExtras['gsc'] }): ReactElement {
  if (gsc.state === 'pending') return muted(t('gscPending'));
  if (gsc.state === 'not_connected') return muted(t('gscOff'));
  return (
    <p className="num type-body text-foreground">
      {t('gscOk', { clicks: formatInteger(gsc.clicks), impressions: formatInteger(gsc.impressions) })}
    </p>
  );
}

export interface ExtrasSectionsProps {
  extras: PageDetailExtras;
  /**
   * Where the comparison with the previous crawl stands. A first crawl has no changes section, and neither has a
   * comparison that is not known yet (`null`: the summary is pending or failed), so the card never flashes.
   */
  comparison: Comparison | null;
  /** False for a crawl past the last four: its anchors are not stored. */
  linksAvailable: boolean;
}

/**
 * The inspector's sections that read the page's `extras` (spec 7.4, mock `il-drawer.js`): changes since the last
 * crawl, tracked keywords, AI citations, anchor text and Google data. No section shows link strength or equity.
 */
export function ExtrasSections({ extras, comparison, linksAvailable }: ExtrasSectionsProps): ReactElement {
  const t = useTranslations('internalLinks.inspectorExtras');
  return (
    <>
      {comparison === null || comparison === 'first_crawl' ? null : (
        <InspectorSection title={t('changes')} icon={History} status="ready">
          <ChangesBody t={t} extras={extras} comparison={comparison} />
        </InspectorSection>
      )}
      <InspectorSection title={t('keywords')} icon={Search} status="ready">
        <KeywordsBody t={t} rows={extras.keywords} />
      </InspectorSection>
      <InspectorSection title={t('citations')} icon={Sparkles} status="ready">
        <CitationsBody t={t} counts={extras.citations} />
      </InspectorSection>
      <InspectorSection title={t('anchors')} icon={Anchor} status="ready">
        <AnchorsBody t={t} anchors={extras.anchors} linksAvailable={linksAvailable} />
      </InspectorSection>
      <InspectorSection title={t('google')} icon={Globe} status="ready">
        <GoogleBody t={t} gsc={extras.gsc} />
      </InspectorSection>
    </>
  );
}
