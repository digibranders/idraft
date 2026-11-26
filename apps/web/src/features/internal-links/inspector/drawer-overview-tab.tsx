'use client';

import { AlertTriangle, Copy, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import type { PageDrawerContext } from './page-drawer-context';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { KeyValues } from '@/components/app/inspector/key-values';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '../status-badge';
import { formatDetailDateTime, formatInteger } from '@/lib/format';
import { pageFlags, type FlagKey } from '@/lib/internal-links/page-flags';
import { SCOPE_KEY } from '@/lib/internal-links/scopes';
import type { LinkScope } from '@/lib/internal-links/scopes';
import type { PageDetail, PageRow } from '@/lib/internal-links/types';
import type { PageDrawerTab } from '@/lib/pages/drawer-tabs';
import { drawerTiles, sortIssues, type DrawerTile, type DrawerTileNote } from '@/lib/pages/drawer-tiles';
import { checkLabel, type IssueSeverity, type PageIssue, type Seam } from '@/lib/pages/issue-source';
import { cn } from '@/lib/utils';

/** Most issues the card lists before it sends the reader to the Issues tab. */
const MOST_ISSUES = 5;
const SEVERITY_TONE = { error: 'negative', warning: 'warning', notice: 'neutral' } as const satisfies Record<
  IssueSeverity,
  'negative' | 'warning' | 'neutral'
>;
/** The message under `tiles` that counts the issues of a severity. */
const ISSUES_NOTE_KEY = {
  error: 'issuesNote',
  warning: 'issuesWarnings',
  notice: 'issuesNotices',
} as const satisfies Record<IssueSeverity, string>;
/** The tiles of a page with the Issues tile. */
const SKELETON_TILES = 8;

/** The flags of a page with what each means (spec 9.4, Needs attention and, until the Issues seam lands, Issues). */
export function FlagsList({ page, linkScope }: { page: PageRow; linkScope: LinkScope }): ReactElement {
  const t = useTranslations('internalLinks.inspector');
  const words = useTranslations('internalLinks');
  const flagLabel = (key: FlagKey): string => words(`flags.${key}`);
  const flags = pageFlags(page, linkScope);
  if (flags.length === 0) return <p className="type-body text-foreground-tertiary">{t('noFlags')}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {flags.map((flag) => (
        <li key={flag.key} className="flex flex-col items-start gap-1">
          <Badge tone={flag.tone}>{flagLabel(flag.key)}</Badge>
          <span className="type-meta text-foreground-secondary">{t(`flagText.${flag.key}`)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The words of one issue: its label (or, until the Issues session has labels, its detail) first, then the other of
 * the two; the raw check id appears only as the small fallback line while there is no label.
 */
export function IssueText({ issue }: { issue: PageIssue }): ReactElement {
  const label = checkLabel(issue.checkId);
  const title = label ?? issue.detail;
  const note = label === null ? issue.checkId : issue.detail;
  return (
    <>
      {title === null ? null : <span className="type-body wrap-anywhere">{title}</span>}
      {note === null ? null : (
        <span
          className={cn(
            'type-meta wrap-anywhere',
            label === null ? 'text-foreground-tertiary' : 'text-foreground-secondary',
          )}
        >
          {note}
        </span>
      )}
    </>
  );
}

export interface DrawerOverviewTabProps {
  context: PageDrawerContext;
  /** Null while the read is pending: every part then draws its skeleton. */
  detail: PageDetail | null;
  issues: Seam<readonly PageIssue[]>;
  onTab: (tab: PageDrawerTab) => void;
  onCopyAddress: () => void;
  /** The tier and tags section, which the page drawer owns with its dialogs. */
  tierSection: ReactNode;
}

/**
 * The Overview tab of the page drawer (spec 9.4): the page's facts as chips, the tiles that open a tab, what needs
 * attention, About, and the tier and tags.
 */
export function DrawerOverviewTab({
  context,
  detail,
  issues,
  onTab,
  onCopyAddress,
  tierSection,
}: DrawerOverviewTabProps): ReactElement {
  const t = useTranslations('pages.drawer.overview');
  if (detail === null) {
    return (
      <>
        <TilesSkeleton label={t('tiles.label')} />
        <InspectorSection title={t('attention.title')} icon={AlertTriangle} status="loading" />
        <InspectorSection title={t('about.title')} icon={Info} status="loading" />
        {tierSection}
      </>
    );
  }
  return (
    <>
      <Chips page={detail.page} />
      <Tiles detail={detail} issues={issues} linkScope={context.linkScope} onTab={onTab} />
      <Attention page={detail.page} linkScope={context.linkScope} issues={issues} onTab={onTab} />
      <About context={context} page={detail.page} onCopyAddress={onCopyAddress} />
      {tierSection}
    </>
  );
}

function Chips({ page }: { page: PageRow }): ReactElement {
  const t = useTranslations('pages.drawer.overview.chips');
  return (
    <ul aria-label={t('label')} className="flex flex-wrap items-center gap-1.5">
      {page.status_code === null ? null : (
        <li>
          {page.status_code === 200 ? (
            <Badge tone="positive">{String(page.status_code)}</Badge>
          ) : (
            <StatusBadge status={page.status_code} />
          )}
        </li>
      )}
      <li>
        {page.is_indexable ? (
          <Badge tone="positive">{t('indexable')}</Badge>
        ) : (
          <Badge tone="warning">{page.non_indexable_reason ?? t('indexable')}</Badge>
        )}
      </li>
      <li>
        <Badge tone="neutral">{page.in_sitemap ? t('inSitemap') : t('notInSitemap')}</Badge>
      </li>
      <li>
        <TierBadge tier={page.tier} withName />
      </li>
      {page.flags.includes('variant') ? (
        <li>
          <Badge tone="neutral">{t('variant')}</Badge>
        </li>
      ) : null}
    </ul>
  );
}

/** One joined panel: the gaps show the border colour. Two columns, four once the drawer's body is 36 rem wide. */
const TILES_GRID = 'grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border @xl:grid-cols-4';

function TilesSkeleton({ label }: { label: string }): ReactElement {
  return (
    <div role="group" aria-label={label} aria-busy="true" className="@container">
      <div className={TILES_GRID}>
        {Array.from({ length: SKELETON_TILES }, (_, index) => (
          <div key={index} className="flex flex-col gap-1.5 bg-surface p-3">
            <Skeleton shape="text-12" widthPct={56} />
            <Skeleton shape="text-14" widthPct={48} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Tiles({
  detail,
  issues,
  linkScope,
  onTab,
}: {
  detail: PageDetail;
  issues: Seam<readonly PageIssue[]>;
  linkScope: LinkScope;
  onTab: (tab: PageDrawerTab) => void;
}): ReactElement {
  const t = useTranslations('pages.drawer.overview.tiles');
  const drawer = useTranslations('pages.drawer');
  const words = useTranslations('internalLinks');
  const tabName = (tab: PageDrawerTab): string => drawer(`tabs.${tab}`);
  const tiles = drawerTiles(detail, issues);
  const scopeWord = words(`scope.${SCOPE_KEY[linkScope]}`).toLowerCase();
  const valueText = (tile: DrawerTile): string => {
    switch (tile.state) {
      case 'ok':
        return tile.note.kind === 'issuesNone' ? t('issuesNone') : formatInteger(tile.value ?? 0);
      case 'not_connected':
        return t('notConnected');
      case 'unreachable':
        return t('notReachable');
      case 'pending':
        return t('notCollected');
      case 'error':
        return t('couldNotLoad');
    }
  };
  const noteText = (note: DrawerTileNote): string | null => {
    switch (note.kind) {
      case 'last28':
        return t('last28');
      case 'bestRank':
        return t('bestRank', { rank: note.rank });
      case 'noRank':
        return t('noRank');
      case 'links':
        return t('linksNote', { scope: scopeWord, count: note.all });
      case 'depth':
        return t('depthNote');
      case 'issues':
        return t(ISSUES_NOTE_KEY[note.severity], { count: note.count });
      case 'issuesNone':
      case 'none':
        return null;
    }
  };
  return (
    <div role="group" aria-label={t('label')} className="@container">
      <div className={TILES_GRID}>
        {tiles.map((tile, index) => {
          const value = valueText(tile);
          const note = noteText(tile.note);
          const label = t(tile.id);
          const tab = tabName(tile.tab);
          return (
            <button
              key={tile.id}
              type="button"
              aria-label={
                note === null ? t('opensNoNote', { label, value, tab }) : t('opens', { label, value, note, tab })
              }
              onClick={() => onTab(tile.tab)}
              // An odd count stretches the last tile, so the panel stays joined with no empty cell
              className={cn(
                'flex min-w-0 flex-col items-start gap-0.5 bg-surface p-3 text-left hover:bg-surface-subtle focus-visible:focus-ring-inset',
                tiles.length % 2 === 1 && index === tiles.length - 1 && 'col-span-2',
              )}
            >
              <span className="type-label text-foreground-tertiary">{label}</span>
              <span className={cn('num wrap-anywhere', tile.value === null ? 'type-body' : 'type-metric-sm')}>
                {value}
              </span>
              {note === null ? null : <span className="type-meta text-foreground-secondary">{note}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Attention({
  page,
  linkScope,
  issues,
  onTab,
}: {
  page: PageRow;
  linkScope: LinkScope;
  issues: Seam<readonly PageIssue[]>;
  onTab: (tab: PageDrawerTab) => void;
}): ReactElement {
  const t = useTranslations('pages.drawer.overview');
  const found = issues.state === 'ready' ? sortIssues(issues.data) : null;
  return (
    <InspectorSection
      title={t('attention.title')}
      icon={AlertTriangle}
      status="ready"
      action={
        found !== null && found.length > MOST_ISSUES ? (
          <Button variant="link" size="sm" onClick={() => onTab('issues')}>
            {t('attention.seeAll')}
          </Button>
        ) : undefined
      }
    >
      {found === null ? (
        <FlagsList page={page} linkScope={linkScope} />
      ) : found.length === 0 ? (
        <p className="type-body text-foreground-tertiary">{t('attention.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {found.slice(0, MOST_ISSUES).map((issue) => (
            <li key={issue.checkId} className="flex flex-col items-start gap-1">
              <Badge tone={SEVERITY_TONE[issue.severity]}>{t(`severity.${issue.severity}`)}</Badge>
              <IssueText issue={issue} />
            </li>
          ))}
        </ul>
      )}
    </InspectorSection>
  );
}

function About({
  context,
  page,
  onCopyAddress,
}: {
  context: PageDrawerContext;
  page: PageRow;
  onCopyAddress: () => void;
}): ReactElement {
  const t = useTranslations('pages.drawer.overview');
  const finished = context.crawl.crawl?.finished_at ?? null;
  const items = [
    { id: 'title', label: t('about.pageTitle'), value: page.title ?? t('about.noTitle') },
    {
      id: 'address',
      label: t('about.address'),
      value: (
        <span className="flex items-start gap-1">
          <span className="min-w-0 flex-1 wrap-anywhere">{page.url}</span>
          <IconButton icon={Copy} label={t('about.copyUrl')} size="icon-xs" onClick={onCopyAddress} />
        </span>
      ),
    },
    { id: 'canonical', label: t('about.canonical'), value: page.canonical_url ?? t('about.noCanonical') },
    ...(page.redirect_url === null
      ? []
      : [{ id: 'redirect', label: t('about.redirectsTo'), value: page.redirect_url }]),
    {
      id: 'crawled',
      label: t('about.lastCrawled'),
      value: finished === null ? t('about.notCrawled') : formatDetailDateTime(finished, context.timeZone),
    },
  ];
  return (
    <InspectorSection title={t('about.title')} icon={Info} status="ready">
      <KeyValues items={items} />
    </InspectorSection>
  );
}
