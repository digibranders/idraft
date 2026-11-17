'use client';

import { Globe, Radar } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { LinkButton } from '@/components/ui/link-button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelative, formatTableDate } from '@/lib/format';
import type { CrawlRun } from '@/lib/internal-links/types';

type StatesTranslate = ReturnType<typeof useTranslations<'internalLinks.states'>>;

/**
 * The words of a failed crawl, by its error code: every code the backend sets (`collectors/crawl_runs.py`), and a
 * generic sentence for any other. The run's own `error_message` is never shown: for a provider error it is the
 * provider's text.
 */
export function failedText(t: StatesTranslate, run: CrawlRun, host: string): string {
  switch (run.error_code) {
    case 'site_blocked':
      return t('failedSiteBlocked', { host });
    case 'site_unreachable':
      return t('failedUnreachable', { host });
    case 'budget_exceeded':
      return t('failedBudget');
    case 'provider_error':
      return t('failedProvider');
    case 'submit_unknown':
      return t('failedSubmitUnknown');
    default:
      return t('failedOther');
  }
}

/**
 * Crawls are not switched on yet (the API's `503 crawls_disabled`). A condition, not a failure: a neutral banner,
 * no error styling and no role. The press that learned it said it once through `announce()`; a later press that
 * meets it again (Check again, a Try again, a higher limit) answers with a toast, not a second announcement. Check again starts
 * the crawl once more: it is the way out when the deployment switches crawls on while the page is open.
 */
export function CrawlsOffNotice({
  onCheckAgain,
  pending,
}: {
  onCheckAgain: () => void;
  pending: boolean;
}): ReactElement {
  const t = useTranslations('internalLinks.states');
  return (
    <Banner
      tone="neutral"
      placement="region"
      lead={t('crawlsOffLead')}
      message={t('crawlsOffText')}
      actions={
        <Button variant="secondary" size="sm" loading={pending} onClick={onCheckAgain}>
          {t('crawlsOffRetry')}
        </Button>
      }
    />
  );
}

export function NoWebsite({ settingsHref }: { settingsHref: Route }): ReactElement {
  const t = useTranslations('internalLinks.states');
  return (
    <EmptyState
      icon={Globe}
      title={t('noWebsiteTitle')}
      reason={t('noWebsiteReason')}
      headingLevel={2}
      primaryAction={
        <LinkButton variant="primary" size="sm" render={<Link href={settingsHref} />}>
          {t('noWebsiteAction')}
        </LinkButton>
      }
    />
  );
}

export function NeverCrawled({ host, crawlNow }: { host: string; crawlNow: ReactNode }): ReactElement {
  const t = useTranslations('internalLinks.states');
  return (
    <EmptyState
      icon={Radar}
      title={t('neverTitle')}
      reason={t('neverReason', { host })}
      headingLevel={2}
      primaryAction={crawlNow}
    />
  );
}

/**
 * The first crawl of a website (mock `firstCrawlPanel`, spec 9 "First crawl running"): progress with the pages found
 * so far, the lead to tag pages meanwhile with its actions, and skeleton rows, never an empty table. Nothing here is
 * a live region: the progress changes every poll, and the end of the crawl is announced once by the page.
 */
export function FirstCrawl({
  run,
  host,
  timeZone,
  actions,
}: {
  run: CrawlRun;
  host: string;
  timeZone: string;
  /** Set up tier rules and Import tiers from CSV (Task 13). */
  actions?: ReactNode;
}): ReactElement {
  const t = useTranslations('internalLinks.states');
  const time = formatRelative(run.created_at, timeZone);
  const share = run.ceiling === 0 ? 0 : Math.min(1, run.pages_found / run.ceiling);
  return (
    <section aria-labelledby="first-crawl-title" className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
        <Icon icon={Radar} className="text-primary-text" />
        <h2 id="first-crawl-title" className="type-body-strong">
          {t('firstTitle', { host })}
        </h2>
        <span className="num type-meta text-foreground-secondary">
          {run.trigger === 'website_added'
            ? t('firstProgress', { count: run.pages_found, time })
            : t('firstProgressManual', { count: run.pages_found, time })}
        </span>
      </div>
      <div
        className="h-0.5 bg-surface-subtle"
        role="progressbar"
        aria-label={t('progressLabel')}
        aria-valuemin={0}
        aria-valuemax={run.ceiling}
        aria-valuenow={Math.min(run.pages_found, run.ceiling)}
      >
        <div className="h-full bg-primary" style={{ width: `${String(Math.round(share * 100))}%` }} />
      </div>
      <div className="flex flex-col gap-2 border-b border-border-subtle px-4 py-3">
        <p className="type-body text-foreground">{t('firstLead')}</p>
        {actions === undefined ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <SkeletonRows />
    </section>
  );
}

/** Eight rows where the table will be: the first crawl, and the crawl list while it loads. */
export function SkeletonRows(): ReactElement {
  return (
    <div className="flex flex-col gap-2 p-4" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} shape="block" height="row" />
      ))}
    </div>
  );
}

/** The banners above the tabs while a crawl runs, after one failed, when one stopped at its ceiling, or found few pages (spec 9). */
export function CrawlBanners({
  latest,
  active,
  failed,
  host,
  timeZone,
  settingsHref,
  onRetry,
  onHigherLimit,
  canCrawl,
}: {
  latest: CrawlRun;
  active: CrawlRun | null;
  failed: CrawlRun | null;
  host: string;
  timeZone: string;
  settingsHref: Route;
  onRetry: () => void;
  onHigherLimit: () => void;
  canCrawl: boolean;
}): ReactElement {
  const t = useTranslations('internalLinks.states');
  const shown = formatTableDate(latest.finished_at ?? latest.created_at, timeZone);
  return (
    <>
      {active === null ? null : (
        <Banner
          tone="info"
          placement="region"
          lead={t('runningLead', { count: active.pages_found })}
          message={t('runningText', { date: shown })}
        />
      )}
      {failed === null ? null : (
        <Banner
          tone="negative"
          placement="region"
          lead={t('failedLead')}
          message={t('failedBanner', { reason: failedText(t, failed, host), date: shown })}
          actions={
            canCrawl ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                {t('retry')}
              </Button>
            ) : null
          }
        />
      )}
      {latest.state !== 'stopped_at_ceiling' || active !== null ? null : (
        <Banner
          tone="warning"
          placement="region"
          lead={t('ceilingLead', { count: latest.ceiling })}
          message={t('ceilingText')}
          actions={
            canCrawl ? (
              <Button variant="secondary" size="sm" onClick={onHigherLimit}>
                {t('ceilingAction')}
              </Button>
            ) : null
          }
        />
      )}
      {!latest.hints.includes('render_javascript') ? null : (
        <Banner
          tone="info"
          placement="region"
          lead={t('hintLead')}
          message={t('hintText')}
          actions={
            <Link href={settingsHref} className="type-body text-link underline-offset-2 hover:underline">
              {t('hintAction')}
            </Link>
          }
        />
      )}
    </>
  );
}
