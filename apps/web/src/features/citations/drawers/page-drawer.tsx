'use client';

import { Copy, ExternalLink, Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useCitedPage, type BoardEngine, type BoardRead } from '../board-reads';
import { slotDay, type CitationsTranslate } from '../board-text';
import { BrandLabel, DRAWER_ROW, DrawerCard, DrawerTable, type DrawerColumn } from './drawer-parts';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { Inspector } from '@/components/app/inspector/inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import type { InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { DEFAULT_INSPECTOR_TAB } from '@/components/app/inspector/use-inspector';
import { SparklineCell } from '@/components/app/sparkline/sparkline-cell';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge, badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import type { BoardScopeParams, CitedPageDetail, CitedPageRow } from '@/lib/citations/board-queries';
import type { SourceScope } from '@/lib/citations/types';
import { copyText } from '@/lib/dom/clipboard';
import { displayUrl, EMPTY_VALUE, formatInteger, formatPercent, formatSignedInteger, webHref } from '@/lib/format';
import { cn } from '@/lib/utils';

export type PageDrawerTab = 'prompts' | 'page-overview';

export interface PageDrawerProps {
  project: SourceScope;
  scope: BoardScopeParams;
  urlId: number;
  engines: readonly BoardEngine[];
  /** The scope's platform, group and runs label, the header's badges (I 36 to 39). */
  scopeParts: readonly string[];
  scopeText: string;
  /** `useInspectorStepping` over the table's order. */
  stepping: {
    positionText: string | null;
    navigation: InspectorNavigation | null;
    onStep: ((direction: 'next' | 'previous') => void) | undefined;
  };
  /** The address's `itab`; `overview` (no tab given) is Prompts. */
  tab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
  /** Opens the prompt inspector in place, with the drawer's prompts for J and K (I 66 to 69). */
  onOpenPrompt: (promptId: string, ids: readonly string[]) => void;
  timeZone: string;
}

type PageRead = BoardRead<CitedPageDetail>;

const ownerTextOf = (page: CitedPageRow, t: CitationsTranslate): string => {
  if (page.domain_role === 'own') return t('pageDrawer.yourPage');
  if (page.domain_role === 'competitor') return page.entity_name ?? page.host;
  return t('pageDrawer.thirdParty');
};

const swatchOf = (row: {
  domain_role: CitedPageRow['domain_role'];
  color_index: number | null;
}): { own: boolean; colorIndex: number | null } => ({
  own: row.domain_role === 'own',
  colorIndex: row.domain_role === 'competitor' ? row.color_index : null,
});

/**
 * The drawer of one cited page (I 71 to 207): which prompts cite it (Prompts), and its trend, platforms and the
 * domains cited beside it (Overview). A page no answer of the window cites is a 404 of the API, and an answer: the body
 * says "Not cited in this scope" (plan open point 7).
 */
export function PageDrawer(props: PageDrawerProps): ReactElement {
  const t = useTranslations('citations');
  const read = useCitedPage(props.project, props.scope, props.urlId);
  const page = read.data?.page;
  const tab: PageDrawerTab = props.tab === 'page-overview' ? 'page-overview' : 'prompts';
  const title = page === undefined ? '' : (page.title ?? displayUrl(page.url).display);
  const badges =
    page === undefined ? null : (
      <>
        <span className={cn(badgeVariants({ variant: 'subtle', tone: 'neutral' }), 'gap-1.5')}>
          <EntitySwatch shape="dot" {...swatchOf(page)} />
          {ownerTextOf(page, t)}
        </span>
        {props.scopeParts.map((part) => (
          <Badge key={part}>{part}</Badge>
        ))}
      </>
    );
  return (
    <Inspector
      type="cited-page"
      header={{
        title,
        typeLabel: t('pageDrawer.type'),
        typeNoun: t('pageDrawer.noun'),
        positionText: props.stepping.positionText,
        navigation: props.stepping.navigation,
        badges,
        freshness:
          page === undefined ? null : (
            <span className="num">{t('pageDrawer.citations', { count: page.citations })}</span>
          ),
      }}
      backLabel={t('pageDrawer.back')}
      onClose={props.onClose}
      onStep={props.stepping.onStep}
      hideMoreActions
    >
      <InspectorTabs<PageDrawerTab>
        label={t('pageDrawer.tabsLabel')}
        value={tab}
        onValueChange={(next) => props.onTabChange(next === 'prompts' ? DEFAULT_INSPECTOR_TAB : next)}
        items={[
          { value: 'prompts', label: t('pageDrawer.promptsTab') },
          { value: 'page-overview', label: t('pageDrawer.overviewTab') },
        ]}
      >
        <InspectorPanel value="prompts">
          <PromptsCard {...props} read={read} />
        </InspectorPanel>
        <InspectorPanel value="page-overview">
          <OverviewCards {...props} read={read} />
        </InspectorPanel>
      </InspectorTabs>
    </Inspector>
  );
}

function LoadError({ read }: { read: PageRead }): ReactElement {
  const t = useTranslations('citations');
  return (
    <InlineError
      title={t('pageDrawer.loadFailed')}
      reason={t('board.loadFailedReason')}
      errorId={read.errorId}
      onRetry={read.retry}
      retrying={read.retrying}
      retryLabel={t('board.retry')}
    />
  );
}

function NotCited({ scopeText }: { scopeText: string }): ReactElement {
  const t = useTranslations('citations');
  return (
    <EmptyState
      variant="card"
      headingLevel={3}
      title={t('pageDrawer.notCitedTitle')}
      reason={t('pageDrawer.notCitedReason', { scope: scopeText })}
    />
  );
}

function PromptsCard({ read, engines, scopeText, onOpenPrompt }: PageDrawerProps & { read: PageRead }): ReactElement {
  const t = useTranslations('citations');
  const detail = read.data;
  const prompts = detail?.prompts ?? [];
  const ids = prompts.map((prompt) => prompt.prompt_id);
  let status: InspectorSectionStatus = 'ready';
  if (read.notFound) status = 'empty';
  else if (read.status === 'loading') status = 'loading';
  else if (read.status === 'error') status = 'error';
  else if (prompts.length === 0) status = 'empty';
  const columns: DrawerColumn[] = [
    { id: 'prompt', label: t('pageDrawer.columnPrompt') },
    { id: 'platforms', label: t('pageDrawer.columnPlatforms'), className: engines.length > 1 ? 'w-24' : 'w-20' },
    { id: 'cited', label: t('pageDrawer.columnCited'), className: 'w-20 text-right' },
  ];
  return (
    <DrawerCard
      title={t('pageDrawer.promptsTitle')}
      meta={
        detail === undefined
          ? undefined
          : t('pageDrawer.promptsMeta', { prompts: prompts.length, answers: detail.page.citations })
      }
      status={status}
      flush
      error={<LoadError read={read} />}
      empty={
        read.notFound ? (
          <NotCited scopeText={scopeText} />
        ) : (
          <EmptyState
            variant="card"
            headingLevel={3}
            title={t('pageDrawer.noPromptsTitle')}
            reason={t('pageDrawer.noPromptsReason')}
          />
        )
      }
    >
      <DrawerTable caption={t('pageDrawer.promptsTitle')} columns={columns}>
        {prompts.map((prompt) => {
          const cellOf = (code: string): (typeof prompt.engines)[number] | undefined =>
            prompt.engines.find((entry) => entry.engine_code === code);
          return (
            <tr key={prompt.prompt_id} className={cn(DRAWER_ROW, 'hover:bg-surface-hover')}>
              <td className="min-w-0 pr-2 pl-4">
                <Tooltip content={t('pageDrawer.promptTip', { text: prompt.text })}>
                  <button
                    type="button"
                    className="w-full min-w-0 truncate rounded-sm text-left text-foreground outline-none hover:underline focus-visible:focus-ring"
                    onClick={() => onOpenPrompt(prompt.prompt_id, ids)}
                  >
                    {prompt.text}
                  </button>
                </Tooltip>
              </td>
              <td className="px-2">
                <Tooltip
                  content={engines
                    .map((engine) => {
                      const cell = cellOf(engine.code);
                      return cell === undefined || cell.answers === 0
                        ? t('pageDrawer.engineNone', { engine: engine.label })
                        : t('pageDrawer.engineAnswers', { engine: engine.label, k: cell.cited, n: cell.answers });
                    })
                    .join('. ')}
                  purpose="label"
                >
                  <span className="flex items-center gap-1">
                    {engines.map((engine) => (
                      <span
                        key={engine.code}
                        className={cn('inline-flex', (cellOf(engine.code)?.cited ?? 0) === 0 && 'opacity-25')}
                      >
                        <EngineLogo engine={engine.code} name={engine.label} nameDisplay="visually-hidden" />
                      </span>
                    ))}
                  </span>
                </Tooltip>
              </td>
              <td className="px-2 pr-4 text-right num whitespace-nowrap">
                <Tooltip content={t('pageDrawer.citedTip', { k: prompt.cited, n: prompt.answers })} purpose="label">
                  <span>
                    <span className="text-foreground">{formatInteger(prompt.cited)}</span>
                    <span className="text-foreground-tertiary">{`/${formatInteger(prompt.answers)}`}</span>
                  </span>
                </Tooltip>
              </td>
            </tr>
          );
        })}
      </DrawerTable>
    </DrawerCard>
  );
}

function OverviewCards({ read, engines, scopeText, timeZone }: PageDrawerProps & { read: PageRead }): ReactElement {
  const t = useTranslations('citations');
  if (read.notFound) return <NotCited scopeText={scopeText} />;
  if (read.status === 'error') return <LoadError read={read} />;
  const detail = read.data;
  const sectionStatus: InspectorSectionStatus = read.status === 'loading' ? 'loading' : 'ready';
  const page = detail?.page;
  const trend = detail?.window.trend ?? [];
  const firstSlot = trend[0];
  const lastSlot = trend[trend.length - 1];
  const latest = detail?.window.latest_answer_at ?? null;
  const copy = (): void => {
    if (page === undefined) return;
    void copyText(page.url).then((copied) =>
      toast(
        copied
          ? { type: 'success', title: t('pageDrawer.copied') }
          : { type: 'error', title: t('pageDrawer.copyFailed'), description: t('pageDrawer.copyFailedHint') },
      ),
    );
  };
  // An address that is not a web address (a script, a relative path) is never opened; it can still be copied
  const href = page === undefined ? null : webHref(page.url);
  const alongside = detail?.alongside ?? [];
  const openPage = (): void => {
    if (href !== null) window.open(href, '_blank', 'noopener');
  };
  const platformColumns: DrawerColumn[] = [
    { id: 'platform', label: t('pageDrawer.columnPlatform') },
    { id: 'citations', label: t('pageDrawer.columnCitations'), className: 'w-24 text-right' },
    { id: 'share', label: t('pageDrawer.columnShare'), className: 'w-20 text-right' },
  ];
  const alongsideColumns: DrawerColumn[] = [
    { id: 'domain', label: t('pageDrawer.columnDomain') },
    { id: 'answers', label: t('pageDrawer.columnAnswers'), className: 'w-24 text-right' },
  ];
  return (
    <>
      <DrawerCard title={t('pageDrawer.summaryTitle')} meta={t('pageDrawer.summaryMeta')} status={sectionStatus}>
        {page === undefined ? null : (
          <>
            <dl className="grid grid-cols-3 gap-3">
              <div className="flex min-w-0 flex-col">
                <dt className="type-label text-foreground-tertiary">{t('pageDrawer.summaryCitations')}</dt>
                <dd className="flex items-baseline gap-1.5 num type-body-strong text-foreground">
                  {formatInteger(page.citations)}
                  <span className="type-meta">{formatSignedInteger(page.citations - page.previous_citations)}</span>
                </dd>
              </div>
              <div className="flex min-w-0 flex-col">
                <dt className="type-label text-foreground-tertiary">{t('pageDrawer.summaryPrompts')}</dt>
                <dd className="num type-body-strong text-foreground">{formatInteger(page.prompts)}</dd>
              </div>
              <div className="flex min-w-0 flex-col">
                <dt className="type-label text-foreground-tertiary">{t('pageDrawer.summaryLastCited')}</dt>
                <dd className="num type-body-strong text-foreground">
                  {slotDay(page.last_cited_at, timeZone, latest)}
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex h-control-sm min-w-0 items-center gap-2 rounded-md border border-border-subtle bg-surface-subtle px-2">
              <Icon icon={Link2} size="sm" className="shrink-0 text-foreground-tertiary" />
              <span className="min-w-0 flex-1 truncate type-body text-foreground">{displayUrl(page.url).display}</span>
              <IconButton icon={Copy} variant="ghost" size="icon-xs" label={t('pageDrawer.copy')} onClick={copy} />
              {href === null ? null : (
                // The preview's tooltip says "Open the page" and the name "Open the page in a new tab" (I 148 to 150)
                <Tooltip content={t('pageDrawer.openTip')} purpose="label">
                  <Button variant="ghost" size="icon-xs" aria-label={t('pageDrawer.openLabel')} onClick={openPage}>
                    <Icon icon={ExternalLink} size="sm" />
                  </Button>
                </Tooltip>
              )}
            </div>
          </>
        )}
      </DrawerCard>
      <DrawerCard
        title={t('pageDrawer.trendTitle')}
        meta={trend.length >= 8 ? t('pageDrawer.trendMeta') : t('pageDrawer.trendMetaShort', { count: trend.length })}
        status={sectionStatus}
      >
        {page === undefined ? null : (
          <div className="flex flex-col gap-1">
            <SparklineCell
              values={page.trend}
              label={t('pageDrawer.trendLabel', { values: page.trend.map((value) => formatInteger(value)).join(', ') })}
              width="fill"
              height={56}
              entity={swatchOf(page)}
              endDot={false}
            />
            <div className="flex justify-between num type-meta">
              <span>{firstSlot === undefined ? EMPTY_VALUE : slotDay(firstSlot.first_at, timeZone, latest)}</span>
              <span>{lastSlot === undefined ? EMPTY_VALUE : slotDay(lastSlot.last_at, timeZone, latest)}</span>
            </div>
          </div>
        )}
      </DrawerCard>
      <DrawerCard
        title={t('pageDrawer.platformsTitle')}
        meta={t('pageDrawer.platformsMeta')}
        status={sectionStatus}
        flush
      >
        {page === undefined ? null : (
          <DrawerTable caption={t('pageDrawer.platformsTitle')} columns={platformColumns}>
            {engines.map((engine) => {
              const count = page.engines.find((cell) => cell.engine_code === engine.code)?.citation_units ?? 0;
              return (
                <tr key={engine.code} className={DRAWER_ROW}>
                  <td className="pr-2 pl-4">
                    <EngineLogo engine={engine.code} name={engine.label} truncate />
                  </td>
                  <td className="px-2 text-right num">{formatInteger(count)}</td>
                  <td className="px-2 pr-4 text-right num text-foreground-secondary">
                    {page.citations > 0 ? formatPercent(count / page.citations, { decimals: 0 }) : EMPTY_VALUE}
                  </td>
                </tr>
              );
            })}
          </DrawerTable>
        )}
      </DrawerCard>
      <DrawerCard
        title={t('pageDrawer.alongsideTitle')}
        meta={t('pageDrawer.alongsideMeta')}
        status={sectionStatus === 'ready' && alongside.length === 0 ? 'empty' : sectionStatus}
        flush
        empty={
          <EmptyState
            variant="card"
            headingLevel={3}
            title={t('pageDrawer.aloneTitle')}
            reason={t('pageDrawer.aloneReason')}
          />
        }
      >
        {page === undefined ? null : (
          <DrawerTable caption={t('pageDrawer.alongsideTitle')} columns={alongsideColumns}>
            {alongside.map((entry) => (
              <tr key={entry.registrable_domain} className={DRAWER_ROW}>
                <td className="min-w-0 pr-2 pl-4">
                  <span className="flex min-w-0 items-center gap-2">
                    <BrandLabel name={entry.registrable_domain} swatch={swatchOf(entry)} />
                    {entry.domain_role === 'third_party' ? null : (
                      <Badge>
                        {entry.domain_role === 'own' ? t('pageDrawer.yourSite') : t('pageDrawer.competitor')}
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="px-2 pr-4 text-right num text-foreground-secondary">
                  <Tooltip
                    content={t('pageDrawer.alongsideTip', { k: entry.answers, n: page.citations })}
                    purpose="label"
                  >
                    <span>
                      {t('pageDrawer.alongsideCount', {
                        k: formatInteger(entry.answers),
                        n: formatInteger(page.citations),
                      })}
                    </span>
                  </Tooltip>
                </td>
              </tr>
            ))}
          </DrawerTable>
        )}
      </DrawerCard>
    </>
  );
}
