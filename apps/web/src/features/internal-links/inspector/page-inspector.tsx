'use client';

import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink, Flag, Layers, ListTree, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement } from 'react';

import { ExtrasSections } from './extras-sections';
import { NeighborSection } from './neighbor-section';
import { BulkTagDialog } from '../pages/bulk-tag-dialog';
import { usePageBulk, type BulkTarget } from '../pages/use-page-bulk';
import type { LinksTabContext } from '../tabs';
import { Inspector } from '@/components/app/inspector/inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorFooter } from '@/components/app/inspector/inspector-footer';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import { MetricStrip } from '@/components/app/metric/metric-strip';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Tag } from '@/components/ui/tag';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { copyText } from '@/lib/dom/clipboard';
import { EMPTY_VALUE, formatInteger, formatTableDate } from '@/lib/format';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { pageFlags, type FlagKey } from '@/lib/internal-links/page-flags';
import { comparisonOf } from '@/lib/internal-links/page-extras';
import { changesSummaryQuery, DEFAULT_PAGE_QUERY, pageDetailQuery, tierRulesQuery } from '@/lib/internal-links/queries';
import { PLACEMENT_KEY, SCOPE_KEY, type Placement } from '@/lib/internal-links/scopes';
import { tierPosition } from '@/lib/internal-links/tiers';
import type { PageTier } from '@/lib/internal-links/types';

const NONE = 'none';
const NO_TIER_BULK = (): void => undefined;
/** Ids of the strip's group and cells, and the target and features of the page's own window. */
const STRIP = { group: 'links', depth: 'depth', in: 'in', out: 'out' } as const;
const NEW_WINDOW = ['_blank', 'noopener'] as const;
const TAXONOMY_PATH = '/settings/taxonomy';

export interface PageInspectorProps {
  context: LinksTabContext;
  /** A url id the API takes (the screen has checked it with `checkUrlId`). */
  urlId: string;
  canWrite: boolean;
  positionText: string | null;
  navigation: InspectorNavigation | null;
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
  onClose: () => void;
}

/**
 * The inspector of one crawled page (spec 7.4, mock `il-drawer.js`): its tier with the source and tags, a strip
 * (depth, links in, links out), linking pages by tier and by placement, the top anchors, the linking pages and
 * outlinks, flags with what they mean, and Open in journey. Equity share is never shown (decision W4).
 */
export function PageInspector({
  context,
  urlId,
  canWrite,
  positionText,
  navigation,
  onStep,
  onClose,
}: PageInspectorProps): ReactElement {
  const t = useTranslations('internalLinks.inspector');
  const words = useTranslations('internalLinks');
  const common = useTranslations('common');
  const { scope, state, tiers, timeZone } = context;
  const read = useQuery(pageDetailQuery(scope, urlId, state.scope, context.crawl.run));
  const rules = useQuery(tierRulesQuery(scope));
  const summary = useQuery(changesSummaryQuery(scope, context.crawl.run));
  // Until the summary has answered nothing is known of the comparison, so it reads as updating, not as a verdict
  const comparison = summary.isPending
    ? 'updating'
    : comparisonOf(summary.data?.data.state, context.crawl.crawl?.enrich_state);
  const vocabularies = useVocabularies(scope);
  const tags = useMemo(
    () =>
      vocabularies.loaded
        .filter((entry) => entry.vocabulary.kind === 'tag')
        .flatMap((entry) => entry.terms.map((term) => ({ termId: term.termId, name: term.path }))),
    [vocabularies.loaded],
  );
  const bulk = usePageBulk(scope, DEFAULT_PAGE_QUERY, NO_TIER_BULK);
  const [tagMode, setTagMode] = useState<'add' | 'remove' | null>(null);
  const target: BulkTarget = { ids: [urlId], allMatching: false };
  const detail = read.data?.data ?? null;
  const page = detail?.page ?? null;
  const scopeWord = words(`scope.${SCOPE_KEY[state.scope]}`).toLowerCase();

  const ruleText = (ruleId: string | null): string | null => {
    const rule = rules.data?.data.find((candidate) => candidate.rule_id === ruleId);
    if (rule === undefined) return null;
    const key = rule.match_type === 'exact' ? 'ruleExact' : rule.match_type === 'prefix' ? 'rulePrefix' : 'rulePattern';
    return t(key, { value: rule.value });
  };
  const sourceLine = (): string => {
    if (page === null) return '';
    if (page.tier_source === 'manual') {
      const date = page.tier_set_at === null ? EMPTY_VALUE : formatTableDate(page.tier_set_at, timeZone);
      return page.tier_set_by === null
        ? t('sourceManualNoName', { date })
        : t('sourceManual', { name: page.tier_set_by.name, date });
    }
    if (page.tier_source === 'rule') return t('sourceRule', { rule: ruleText(page.tier_rule_id) ?? EMPTY_VALUE });
    return t('sourceNone');
  };
  const placementLabel = (placement: Placement): string => words(`placement.${PLACEMENT_KEY[placement]}`);
  const flagLabel = (key: FlagKey): string => words(`flags.${key}`);
  const viewAll = (filter: 'src' | 'tgt'): void =>
    context.setSearch(
      {
        tab: 'links',
        src: filter === 'src' ? urlId : null,
        tgt: filter === 'tgt' ? urlId : null,
        inspect: null,
        itab: null,
      },
      { history: 'push' },
    );
  const copyUrl = (): void => {
    if (page === null) return;
    void copyText(page.url).then((copied) =>
      toast(copied ? { type: 'success', title: t('copied') } : { type: 'error', title: common('copy.failed') }),
    );
  };

  let body: ReactElement;
  if (read.isError && isApiProblem(read.error, 'not_found')) {
    body = (
      <InspectorBody>
        <EmptyState variant="inline" title={t('notFoundTitle')} reason={t('notInCrawl')} headingLevel={3} />
      </InspectorBody>
    );
  } else if (read.isError) {
    body = (
      <InspectorBody>
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={null}
          onRetry={() => void read.refetch()}
          retrying={read.isFetching}
          retryLabel={common('retry')}
        />
      </InspectorBody>
    );
  } else {
    const flags = page === null ? [] : pageFlags(page, state.scope);
    const inScope = (all: number): string => t('inScope', { scope: scopeWord, count: all });
    body = (
      <InspectorBody>
        <InspectorSection title={t('tier')} icon={Layers} status={page === null ? 'loading' : 'ready'}>
          {page === null ? null : (
            <div className="flex flex-col gap-2">
              <Field>
                <FieldLabel display="visually-hidden">{t('tierField')}</FieldLabel>
                <Select<string>
                  value={page.tier?.tier_id ?? NONE}
                  disabled={!canWrite || bulk.pending}
                  placeholder={t('tierField')}
                  options={[
                    ...tiers.map((tier) => ({ value: tier.tier_id, label: tier.label })),
                    { value: NONE, label: words('filters.untiered') },
                  ]}
                  onValueChange={(value) =>
                    void bulk.setTier(target, tiers.find((tier: PageTier) => tier.tier_id === value) ?? null, 'key')
                  }
                />
              </Field>
              <p className="flex flex-wrap items-baseline gap-x-2 type-meta text-foreground-secondary">
                {sourceLine()}
                {page.tier_source === 'manual' && canWrite ? (
                  <Button
                    variant="link"
                    size="sm"
                    disabled={bulk.pending}
                    onClick={() => void bulk.resetToRule(target, 'key')}
                  >
                    {t('resetToRule')}
                  </Button>
                ) : null}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {page.tags.length === 0 ? (
                  <span className="type-meta text-foreground-tertiary">{t('noTags')}</span>
                ) : null}
                {page.tags.map((tag) => (
                  <Tag
                    key={tag.term_id}
                    label={tag.name}
                    {...(canWrite
                      ? {
                          removeLabel: t('removeTag', { tag: tag.name }),
                          onRemove: () =>
                            void bulk.changeTag(target, { termId: tag.term_id, name: tag.name }, false, 'key'),
                        }
                      : {})}
                  />
                ))}
                {canWrite ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      bulk.clearError();
                      setTagMode('add');
                    }}
                  >
                    {t('addTag')}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </InspectorSection>
        <MetricStrip
          size="sm"
          label={t('stripLabel')}
          status={page === null ? 'loading' : 'ready'}
          groups={[
            {
              id: STRIP.group,
              items: [
                {
                  id: STRIP.depth,
                  label: t('depth'),
                  value:
                    page === null || page.click_depth === null ? t('notReachable') : formatInteger(page.click_depth),
                },
                {
                  id: STRIP.in,
                  label: t('linksIn'),
                  value: formatInteger(page?.linking_pages ?? 0),
                  context: inScope(page?.linking_pages_all ?? 0),
                },
                {
                  id: STRIP.out,
                  label: t('linksOut'),
                  value: formatInteger(page?.outlinks ?? 0),
                  context: inScope(page?.outlinks_all ?? 0),
                },
              ],
            },
          ]}
        />
        {detail === null ? null : (
          <>
            <InspectorSection title={t('byTier')} icon={ListTree} status="ready">
              {detail.linking_by_tier.length === 0 ? (
                <p className="type-body text-foreground-tertiary">{t('noLinksIn')}</p>
              ) : (
                <dl className="flex flex-col gap-1">
                  {[...detail.linking_by_tier]
                    .sort((a, b) => tierPosition(a.tier) - tierPosition(b.tier))
                    .map((entry) => (
                      <div key={entry.tier?.tier_id ?? NONE} className="flex items-center justify-between gap-2">
                        <dt>
                          <TierBadge tier={entry.tier} withName />
                        </dt>
                        <dd className="num type-table">{formatInteger(entry.pages)}</dd>
                      </div>
                    ))}
                </dl>
              )}
              {detail.linking_by_placement.length === 0 ? null : (
                <>
                  <h4 className="pt-2 type-label text-foreground-tertiary">{t('byPlacement')}</h4>
                  <dl className="flex flex-col gap-1">
                    {detail.linking_by_placement.map((entry) => (
                      <div key={entry.placement} className="flex items-center justify-between gap-2">
                        <dt className="type-table">{placementLabel(entry.placement)}</dt>
                        <dd className="num type-table">{formatInteger(entry.pages)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </InspectorSection>
            <ExtrasSections
              extras={detail.extras}
              comparison={comparison}
              linksAvailable={context.crawl.linksAvailable}
            />
            <NeighborSection
              scope={scope}
              urlId={urlId}
              direction="in"
              run={context.crawl.run}
              linksAvailable={context.crawl.linksAvailable}
              linkScope={state.scope}
              total={detail.linking_pages_total}
              title={t('linkingPages', { count: detail.linking_pages_total })}
              onOpen={context.inspect.open}
              onViewAll={() => viewAll('tgt')}
            />
            <NeighborSection
              scope={scope}
              urlId={urlId}
              direction="out"
              run={context.crawl.run}
              linksAvailable={context.crawl.linksAvailable}
              linkScope={state.scope}
              total={detail.outlinks_total}
              title={t('outlinks', { count: detail.outlinks_total })}
              onOpen={context.inspect.open}
              onViewAll={() => viewAll('src')}
            />
            <InspectorSection title={t('flags')} icon={Flag} status="ready">
              {flags.length === 0 ? (
                <p className="type-body text-foreground-tertiary">{t('noFlags')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {flags.map((flag) => (
                    <li key={flag.key} className="flex flex-col items-start gap-1">
                      <Badge tone={flag.tone}>{flagLabel(flag.key)}</Badge>
                      <span className="type-meta text-foreground-secondary">{t(`flagText.${flag.key}`)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </InspectorSection>
          </>
        )}
      </InspectorBody>
    );
  }

  return (
    <Inspector
      type="page"
      header={{
        title: page?.path ?? '',
        typeLabel: t('typeLabel'),
        typeNoun: t('typeNoun'),
        positionText,
        navigation,
        ...(page === null || page.title === null
          ? {}
          : { freshness: <span className="type-meta text-foreground-secondary">{page.title}</span> }),
      }}
      backLabel={t('back')}
      onClose={onClose}
      onStep={onStep}
      footer={
        <InspectorFooter
          start={
            page === null ? undefined : (
              <Button variant="secondary" size="sm" icon={Copy} onClick={copyUrl}>
                {t('copyUrl')}
              </Button>
            )
          }
          secondary={
            page === null ? undefined : (
              <Button variant="secondary" icon={ExternalLink} onClick={() => window.open(page.url, ...NEW_WINDOW)}>
                {t('visit')}
              </Button>
            )
          }
          primary={
            <Button variant="primary" icon={Workflow} onClick={() => context.openJourney(urlId)}>
              {t('openJourney')}
            </Button>
          }
        />
      }
    >
      {body}
      <BulkTagDialog
        mode={tagMode}
        onClose={() => setTagMode(null)}
        count={1}
        tags={tags}
        vocabularies={vocabularies}
        taxonomyHref={context.hrefOf(TAXONOMY_PATH)}
        pending={bulk.pending}
        alert={bulk.error}
        onApply={async (tag, add) => {
          const done = await bulk.changeTag(target, tag, add, 'dialog');
          if (done) setTagMode(null);
          return done;
        }}
      />
    </Inspector>
  );
}

/** The inspector of an id the address names that is no page id: nothing to read, so it says so (spec 7.4). */
export function PageNotFoundInspector({ onClose }: { onClose: () => void }): ReactElement {
  const t = useTranslations('internalLinks.inspector');
  return (
    <Inspector
      type="page"
      header={{ title: '', typeLabel: t('typeLabel'), typeNoun: t('typeNoun') }}
      backLabel={t('back')}
      onClose={onClose}
      footer={
        <InspectorFooter
          primary={
            <Button variant="secondary" onClick={onClose}>
              {t('back')}
            </Button>
          }
        />
      }
    >
      <InspectorBody>
        <EmptyState variant="inline" title={t('notFoundTitle')} reason={t('notInCrawl')} headingLevel={3} />
      </InspectorBody>
    </Inspector>
  );
}
