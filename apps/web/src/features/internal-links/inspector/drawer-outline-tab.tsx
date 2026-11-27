'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement } from 'react';

import type { PageDrawerContext } from './page-drawer-context';
import { HeadingsBlock, ListingBlock } from './outline-blocks';
import { ContentBlock, LanguagesBlock, SharingBlock, StructuredBlock } from './outline-more-blocks';
import { InlineError } from '@/components/app/status/inline-error';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInteger } from '@/lib/format';
import type { PageOutline, PageOutlineBody, PageRow } from '@/lib/internal-links/types';
import type { PageIssue, Seam } from '@/lib/pages/issue-source';
import { usePageOutline } from '@/lib/pages/outline';
import { outlineModel, type OutlineBlockId, type OutlineStripCell } from '@/lib/pages/outline-model';
import { cn } from '@/lib/utils';

export interface DrawerOutlineTabProps {
  context: PageDrawerContext;
  urlId: string;
  /** The row of the crawl in view, or null while the page read is pending. */
  page: PageRow | null;
  /** Whether the tab is selected: the outline is asked only then. */
  active: boolean;
  issues: Seam<readonly PageIssue[]>;
  /** The open blocks, held by the drawer so they survive stepping from page to page. */
  openBlocks: ReadonlySet<OutlineBlockId>;
  onToggleBlock: (id: OutlineBlockId) => void;
}

/** What a row says on its own when the crawl in view is the latest one (spec 9.6.3). */
type NotLive = { kind: 'redirect'; path: string | null } | { kind: 'error'; status: number | null };

const isRedirect = (status: number | null): boolean => status !== null && status >= 300 && status < 400;

function pathOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function notLiveOf(page: PageRow | null): NotLive | null {
  if (page === null || page.status_code === 200) return null;
  if (isRedirect(page.status_code)) return { kind: 'redirect', path: pathOf(page.redirect_url) };
  return { kind: 'error', status: page.status_code };
}

/**
 * The Outline tab of the page drawer (spec 9.6.3): four numbers, then the folding blocks, then what the outline was
 * read from. Every string of the page is rendered as text.
 */
export function DrawerOutlineTab({
  context,
  urlId,
  page,
  active,
  issues,
  openBlocks,
  onToggleBlock,
}: DrawerOutlineTabProps): ReactElement {
  const t = useTranslations('pages.drawer.outline');
  const common = useTranslations('common');
  const inspector = useTranslations('internalLinks.inspector');
  // Only the latest crawl's row may decide for the read: an older row is not the outline's crawl
  const fromRow = context.crawl.older ? null : notLiveOf(page);
  const read = usePageOutline(context.scope, urlId, active && fromRow === null);
  // The choice to show every heading belongs to one page: stepping to another resets it
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  if (expandedFor !== null && expandedFor !== urlId) setExpandedFor(null);

  const redirectText = (path: string | null): string =>
    path === null ? t('state.redirectUnknown') : t('state.redirect', { path });
  const errorText = (status: number | null): string =>
    status === null ? t('state.errorNoStatus') : t('state.error', { status });
  const sentence = (text: string): ReactElement => <p className="type-body text-foreground-secondary">{text}</p>;

  if (fromRow !== null) {
    return sentence(fromRow.kind === 'redirect' ? redirectText(fromRow.path) : errorText(fromRow.status));
  }
  if (read.state === 'loading') return <OutlineSkeleton />;
  if (read.state === 'error') {
    if (read.notFound) return sentence(t('state.notInCrawl'));
    return (
      <InlineError
        title={t('loadFailed')}
        reason={inspector('loadFailedReason')}
        errorId={null}
        onRetry={read.retry}
        retrying={false}
        retryLabel={common('retry')}
      />
    );
  }
  const answer: PageOutline = read.data;
  if (answer.outline === null) {
    switch (answer.state) {
      case 'redirect':
        return sentence(redirectText(pathOf(page?.redirect_url ?? null)));
      case 'error':
        return sentence(errorText(answer.status_code));
      case 'not_html':
        return sentence(t('state.notHtml'));
      default:
        return sentence(t('state.noHtml'));
    }
  }
  return (
    <OutlineBody
      older={context.crawl.older}
      outline={answer.outline}
      outlinks={page?.outlinks ?? null}
      issues={issues}
      issueCheck={context.hrefs.issueCheck}
      openBlocks={openBlocks}
      onToggleBlock={onToggleBlock}
      showAll={expandedFor === urlId}
      onToggleAll={() => setExpandedFor((current) => (current === urlId ? null : urlId))}
    />
  );
}

function OutlineBody({
  older,
  outline,
  issues,
  issueCheck,
  openBlocks,
  onToggleBlock,
  showAll,
  onToggleAll,
  outlinks,
}: {
  older: boolean;
  outline: PageOutlineBody;
  /** The links out of the page row, which the outline does not carry. */
  outlinks: number | null;
  issues: Seam<readonly PageIssue[]>;
  issueCheck: PageDrawerContext['hrefs']['issueCheck'];
  openBlocks: ReadonlySet<OutlineBlockId>;
  onToggleBlock: (id: OutlineBlockId) => void;
  showAll: boolean;
  onToggleAll: () => void;
}): ReactElement {
  const t = useTranslations('pages.drawer.outline');
  const found = issues.state === 'ready' ? issues.data : null;
  const model = useMemo(() => outlineModel(outline, found), [outline, found]);
  const issueHref = (checkId: string | null): ReturnType<typeof issueCheck> =>
    checkId === null ? null : issueCheck(checkId);
  return (
    <>
      {older ? <p className="type-meta text-foreground-secondary">{t('olderCrawl')}</p> : null}
      {outline.truncated ? <p className="type-meta text-foreground-secondary">{t('truncated')}</p> : null}
      <Strip cells={model.strip} />
      <ListingBlock
        outline={outline}
        part={model.listing}
        open={openBlocks.has('listing')}
        onToggle={onToggleBlock}
        issueHref={issueHref}
      />
      <HeadingsBlock
        outline={outline}
        part={model.headings}
        open={openBlocks.has('headings')}
        onToggle={onToggleBlock}
        issueHref={issueHref}
        showAll={showAll}
        onToggleAll={onToggleAll}
      />
      <LanguagesBlock
        outline={outline}
        part={model.languages}
        open={openBlocks.has('languages')}
        onToggle={onToggleBlock}
        issueHref={issueHref}
      />
      <SharingBlock
        outline={outline}
        part={model.sharing}
        open={openBlocks.has('sharing')}
        onToggle={onToggleBlock}
        issueHref={issueHref}
      />
      <StructuredBlock
        outline={outline}
        part={model.structured}
        open={openBlocks.has('structured')}
        onToggle={onToggleBlock}
        issueHref={issueHref}
      />
      <ContentBlock
        outline={outline}
        part={model.content}
        open={openBlocks.has('content')}
        onToggle={onToggleBlock}
        issueHref={issueHref}
        outlinks={outlinks}
      />
      <p className="type-meta text-foreground-tertiary">{t('footer')}</p>
    </>
  );
}

/** One joined panel: the gaps show the border colour. Two columns, four once the drawer's body is 36 rem wide. */
const STRIP_GRID = 'grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border @xl:grid-cols-4';

function Strip({ cells }: { cells: readonly OutlineStripCell[] }): ReactElement {
  const t = useTranslations('pages.drawer.outline.strip');
  return (
    <div role="group" aria-label={t('label')} className="@container">
      <dl className={STRIP_GRID}>
        {cells.map((cell) => (
          <div key={cell.id} className="flex min-w-0 flex-col items-start gap-0.5 bg-surface p-3">
            <dt className="type-label text-foreground-tertiary">{t(cell.id)}</dt>
            <dd className="num type-metric-sm wrap-anywhere">
              {cell.value === null ? t('h1None') : formatInteger(cell.value)}
            </dd>
            <dd className={cn('type-meta', cell.warn ? 'text-warning-text' : 'text-foreground-secondary')}>
              {/* The ids are those of `OutlineStripCell.note`, all under `strip` */}
              {t(cell.note.id as 'thin', cell.note.values)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OutlineSkeleton(): ReactElement {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <div className={STRIP_GRID}>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex flex-col gap-1.5 bg-surface p-3">
            <Skeleton shape="text-12" widthPct={56} />
            <Skeleton shape="text-14" widthPct={48} />
          </div>
        ))}
      </div>
      <Skeleton shape="block" height="chart-140" />
      <Skeleton shape="block" height="chart-180" />
    </div>
  );
}
