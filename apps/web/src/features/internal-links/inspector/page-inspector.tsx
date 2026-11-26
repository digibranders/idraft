'use client';

import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink, Flag, Layers, Sparkles, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement } from 'react';

import { DrawerLinksTab } from './drawer-links-tab';
import { ExtrasSections, type ExtrasPart } from './extras-sections';
import { BulkTagDialog } from '../pages/bulk-tag-dialog';
import { usePageBulk, type BulkTarget } from '../pages/use-page-bulk';
import type { PageDrawerContext } from './page-drawer-context';
import { Inspector } from '@/components/app/inspector/inspector';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorFooter } from '@/components/app/inspector/inspector-footer';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InspectorBody, InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { LinkButton } from '@/components/ui/link-button';
import { Select } from '@/components/ui/select';
import { Tag } from '@/components/ui/tag';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { copyText } from '@/lib/dom/clipboard';
import { EMPTY_VALUE, formatTableDate } from '@/lib/format';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { pageFlags, type FlagKey } from '@/lib/internal-links/page-flags';
import { comparisonOf } from '@/lib/internal-links/page-extras';
import { changesSummaryQuery, DEFAULT_PAGE_QUERY, pageDetailQuery, tierRulesQuery } from '@/lib/internal-links/queries';
import type { PageTier } from '@/lib/internal-links/types';
import { PAGE_DRAWER_TABS, pageDrawerTab, type PageDrawerTab } from '@/lib/pages/drawer-tabs';

const NONE = 'none';
const NO_TIER_BULK = (): void => undefined;
/** The features of the page's own window. */
const NEW_WINDOW = ['_blank', 'noopener'] as const;
/** The key of each tab's name under `pages.drawer`. */
const TAB_KEY = {
  overview: 'tabs.overview',
  search: 'tabs.search',
  outline: 'tabs.outline',
  issues: 'tabs.issues',
  ai: 'tabs.ai',
  links: 'tabs.links',
  notes: 'tabs.notes',
} as const satisfies Record<PageDrawerTab, string>;

export interface PageInspectorProps {
  context: PageDrawerContext;
  /** A url id the API takes (the screen has checked it with `checkUrlId`). */
  urlId: string;
  positionText: string | null;
  navigation: InspectorNavigation | null;
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
  onClose: () => void;
}

/**
 * The tabbed drawer of one crawled page (spec 9, mock `il-drawer.js`). Overview holds the tier with its source and
 * tags and the flags; Search the tracked keywords and the Google data; Issues the flags; AI the citations; Links
 * the strip, the linking pages by tier and placement, the changes and anchors cards and the neighbors; Outline and
 * Notes hold a line until their tabs land. Equity share is never shown (decision W4).
 */
export function PageInspector({
  context,
  urlId,
  positionText,
  navigation,
  onStep,
  onClose,
}: PageInspectorProps): ReactElement {
  const t = useTranslations('internalLinks.inspector');
  const words = useTranslations('internalLinks');
  const drawer = useTranslations('pages.drawer');
  const extrasWords = useTranslations('internalLinks.inspectorExtras');
  const common = useTranslations('common');
  const { scope, linkScope, tiers, timeZone, canWrite } = context;
  const read = useQuery(pageDetailQuery(scope, urlId, linkScope, context.crawl.run));
  const rules = useQuery(tierRulesQuery(scope));
  const summary = useQuery(changesSummaryQuery(scope, context.crawl.run));
  // Until the summary has answered (or when it failed) nothing is known of the comparison: no Changes card, so a
  // first crawl never shows one for a moment
  const comparison =
    summary.data === undefined ? null : comparisonOf(summary.data.data.state, context.crawl.crawl?.enrich_state);
  const linksCompared = summary.data?.data.links_compared ?? true;
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
  // The tab is the address's `itab`; an unknown one reads as Overview
  const inspector = useInspector();
  const tab = pageDrawerTab(inspector.tab);

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
  const flagLabel = (key: FlagKey): string => words(`flags.${key}`);
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
    const flags = page === null ? [] : pageFlags(page, linkScope);
    const tierSection = (
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
    );
    // The flags have two homes until the Issues seam lands (spec 9.4): Needs attention in Overview, and Issues
    const flagsSection =
      detail === null ? null : (
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
      );
    const extras = (parts: readonly ExtrasPart[]): ReactElement | null =>
      detail === null ? null : (
        <ExtrasSections
          extras={detail.extras}
          comparison={comparison}
          linksAvailable={detail.links_available}
          linksCompared={linksCompared}
          parts={parts}
        />
      );
    const panels: Record<PageDrawerTab, ReactElement | null> = {
      overview: (
        <>
          {tierSection}
          {flagsSection}
        </>
      ),
      search: extras(['keywords', 'google']),
      outline: <p className="type-body text-foreground-tertiary">{drawer('outline.pending')}</p>,
      issues: flagsSection,
      ai:
        detail !== null && detail.extras.citations.total === 0 ? (
          <InspectorSection title={extrasWords('citations')} icon={Sparkles} status="ready">
            <p className="type-body text-foreground-tertiary">{drawer('ai.none')}</p>
          </InspectorSection>
        ) : (
          extras(['citations'])
        ),
      links: (
        <DrawerLinksTab
          context={context}
          urlId={urlId}
          page={page}
          detail={detail}
          comparison={comparison}
          linksCompared={linksCompared}
        />
      ),
      notes: <p className="type-body text-foreground-tertiary">{drawer('notes.pending')}</p>,
    };
    body = (
      <InspectorTabs<PageDrawerTab>
        label={drawer('tabsLabel')}
        value={tab}
        onValueChange={inspector.setTab}
        items={PAGE_DRAWER_TABS.map((id) => ({ value: id, label: drawer(TAB_KEY[id]) }))}
        overflowLabel={drawer('tabsMore')}
      >
        {PAGE_DRAWER_TABS.map((id) => (
          <InspectorPanel<PageDrawerTab> key={id} value={id}>
            {panels[id]}
          </InspectorPanel>
        ))}
      </InspectorTabs>
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
            <LinkButton variant="primary" icon={Workflow} render={<Link href={context.hrefs.journey(urlId)} />}>
              {t('openJourney')}
            </LinkButton>
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
        taxonomyHref={context.hrefs.taxonomy}
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
