'use client';

import { ListTree } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ExtrasSections } from './extras-sections';
import { NeighborSection } from './neighbor-section';
import type { PageDrawerContext } from './page-drawer-context';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { MetricStrip } from '@/components/app/metric/metric-strip';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { formatInteger } from '@/lib/format';
import type { Comparison } from '@/lib/internal-links/page-extras';
import { PLACEMENT_KEY, SCOPE_KEY, type Placement } from '@/lib/internal-links/scopes';
import { tierPosition } from '@/lib/internal-links/tiers';
import type { PageDetail, PageRow } from '@/lib/internal-links/types';

const NONE = 'none';
/** Ids of the strip's group and cells. */
const STRIP = { group: 'links', depth: 'depth', in: 'in', out: 'out' } as const;

export interface DrawerLinksTabProps {
  context: PageDrawerContext;
  urlId: string;
  /** Null while the read is pending: the strip then draws its skeleton and the cards are left out. */
  page: PageRow | null;
  detail: PageDetail | null;
  comparison: Comparison | null;
  linksCompared: boolean;
}

/**
 * The Links tab of the page drawer (spec 9.4): the strip (depth, links in, links out), linking pages by tier and by
 * placement, the changes and anchors cards, then the linking pages and the outlinks with "View all in Links".
 */
export function DrawerLinksTab({
  context,
  urlId,
  page,
  detail,
  comparison,
  linksCompared,
}: DrawerLinksTabProps): ReactElement {
  const t = useTranslations('internalLinks.inspector');
  const words = useTranslations('internalLinks');
  const { scope, linkScope } = context;
  const scopeWord = words(`scope.${SCOPE_KEY[linkScope]}`).toLowerCase();
  const inScope = (all: number): string => t('inScope', { scope: scopeWord, count: all });
  const placementLabel = (placement: Placement): string => words(`placement.${PLACEMENT_KEY[placement]}`);
  return (
    <>
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
                value: page === null || page.click_depth === null ? t('notReachable') : formatInteger(page.click_depth),
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
            linksAvailable={detail.links_available}
            linksCompared={linksCompared}
            parts={['changes', 'anchors']}
          />
          <NeighborSection
            scope={scope}
            urlId={urlId}
            direction="in"
            run={context.crawl.run}
            linksAvailable={detail.links_available}
            linkScope={linkScope}
            host={context.host ?? ''}
            total={detail.linking_pages_total}
            title={t('linkingPages', { count: detail.linking_pages_total })}
            onOpen={context.openPage}
            viewAllHref={context.hrefs.linksTo(urlId)}
          />
          <NeighborSection
            scope={scope}
            urlId={urlId}
            direction="out"
            run={context.crawl.run}
            linksAvailable={detail.links_available}
            linkScope={linkScope}
            host={context.host ?? ''}
            total={detail.outlinks_total}
            title={t('outlinks', { count: detail.outlinks_total })}
            onOpen={context.openPage}
            viewAllHref={context.hrefs.linksFrom(urlId)}
          />
        </>
      )}
    </>
  );
}
