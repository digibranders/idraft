'use client';

import { Ban } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { InsightCard } from './insight-card';
import { DomainCell } from '@/components/app/cells/domain-cell';
import { EngineBadge } from '@/components/app/engine/engine-badge';
import { EmptyState } from '@/components/app/status/empty-state';
import type { PlainColumn } from '@/components/app/table/plain-table';
import { LinkButton } from '@/components/ui/link-button';
import { Tooltip } from '@/components/ui/tooltip';
import { useInsights, type InsightLines } from './use-insights';
import { OverviewProvider, useOverview, type OverviewProject } from '../overview-context';
import type { EngineCode } from '@/lib/api/types';
import { formatInteger, formatList, formatTableDate } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { projectPath, promptPath, promptsPath, withQuery } from '@/lib/routes/paths';

export interface InsightsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: OverviewProject;
}

/** AI > Insights: the four findings of the Overview's old Insights box, each with the rows it counted. */
export function InsightsScreen(props: InsightsScreenProps): ReactElement {
  const t = useTranslations('aiInsights');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE}>
        <h1 className="sr-only">{t('title')}</h1>
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return (
    <OverviewProvider {...props}>
      <InsightsContent />
    </OverviewProvider>
  );
}

const PAGE = 'flex flex-col gap-3 px-3 pt-3 pb-8 md:px-4 lg:px-5';
const ROLE_KEY = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const;

/** A value the API did not give: "n/a", with the reason on hover and for assistive technology. */
function NotAvailable({ reason }: { reason: string }): ReactElement {
  const t = useTranslations('aiInsights');
  return (
    <Tooltip content={reason} purpose="label">
      <span className="text-foreground-secondary">
        {t('na')}
        <span className="sr-only"> {reason}</span>
      </span>
    </Tooltip>
  );
}

function InsightsContent(): ReactElement {
  const t = useTranslations('aiInsights');
  const tSection = useTranslations('aiInsights.sections');
  const tRole = useTranslations('common.domainCell.roles');
  const { workspaceSlug, project, engines } = useOverview();
  const { reads, competitorNames } = useInsights();
  const labelOf = useMemo(() => {
    const labels = new Map((engines.data ?? []).map((row) => [row.engine.engine_code, row.engine.label] as const));
    return (code: EngineCode): string => labels.get(code) ?? code;
  }, [engines.data]);
  const namesOf = (ids: readonly string[]): string => formatList(ids.flatMap((id) => competitorNames.get(id) ?? []));
  const href = (path: `/${string}`, query = ''): Route =>
    withQuery(projectPath(workspaceSlug, project.slug, path), query);
  const viewAll = (section: keyof InsightLines, path: `/${string}`, query = ''): ReactElement => {
    const label = tSection(`${section}.viewAll`);
    return (
      <LinkButton render={<Link href={href(path, query)} />} size="sm">
        {label}
      </LinkButton>
    );
  };
  const links = {
    untracked: viewAll('untracked', '/ai/prompts'),
    gaps: viewAll('gaps', '/ai/citations/gaps'),
    citingCompetitors: viewAll('citingCompetitors', '/ai/citations', 'owner=third'),
    newDomains: viewAll('newDomains', '/ai/citations'),
  };

  const untracked = useMemo(
    (): PlainColumn<InsightLines['untracked']['rows'][number]>[] => [
      { id: 'keyword', header: tSection('untracked.columns.keyword'), wrap: true, cell: (row) => row.text },
      {
        id: 'volume',
        header: tSection('untracked.columns.volume'),
        cell: (row) =>
          row.volume === null ? (
            <NotAvailable reason={tSection('untracked.volumeUnknown')} />
          ) : (
            <span className="num">{formatInteger(row.volume)}</span>
          ),
      },
      {
        id: 'cited',
        header: tSection('untracked.columns.cited'),
        cell: (row) => tSection(row.cited ? 'untracked.cited.yes' : 'untracked.cited.no'),
      },
      {
        id: 'action',
        header: tSection('untracked.columns.action'),
        actions: true,
        cell: (row) => (
          <LinkButton
            render={<Link href={promptsPath(workspaceSlug, project.slug)} />}
            size="sm"
            aria-label={tSection('untracked.startTrackingFor', { keyword: row.text })}
          >
            {tSection('untracked.startTracking')}
          </LinkButton>
        ),
      },
    ],
    [tSection, workspaceSlug, project.slug],
  );

  const gaps = useMemo(
    (): PlainColumn<InsightLines['gaps']['rows'][number]>[] => [
      { id: 'prompt', header: tSection('gaps.columns.prompt'), wrap: true, cell: (row) => row.text },
      {
        id: 'platforms',
        header: tSection('gaps.columns.platforms'),
        cell: (row) => (
          <span className="flex flex-wrap gap-1">
            {row.lost_on.map((code) => (
              <EngineBadge key={code} engine={code} name={labelOf(code)} />
            ))}
          </span>
        ),
      },
      {
        id: 'competitors',
        header: tSection('gaps.columns.competitors'),
        wrap: true,
        cell: (row) => {
          const names = namesOf(row.lost_to);
          return names === '' ? <NotAvailable reason={t('na')} /> : names;
        },
      },
      {
        id: 'action',
        header: tSection('gaps.columns.action'),
        actions: true,
        cell: (row) => (
          <LinkButton
            render={<Link href={promptPath(workspaceSlug, project.slug, row.prompt_id)} />}
            size="sm"
            aria-label={tSection('gaps.viewGapFor', { prompt: row.text })}
          >
            {tSection('gaps.viewGap')}
          </LinkButton>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `namesOf` follows `competitorNames`
    [tSection, t, labelOf, competitorNames, workspaceSlug, project.slug],
  );

  const citing = useMemo(
    (): PlainColumn<InsightLines['citingCompetitors']['rows'][number]>[] => [
      {
        id: 'domain',
        header: tSection('citingCompetitors.columns.domain'),
        cell: (row) => (
          <DomainCell
            host={row.registrable_domain}
            registrable={row.registrable_domain}
            favicon="show"
            context="list"
          />
        ),
      },
      {
        id: 'role',
        header: tSection('citingCompetitors.columns.role'),
        cell: (row) => tRole(ROLE_KEY[row.domain_role as keyof typeof ROLE_KEY] ?? 'thirdParty'),
      },
      {
        id: 'answers',
        header: tSection('citingCompetitors.columns.answers'),
        cell: (row) => <span className="num">{formatInteger(row.observations)}</span>,
      },
      {
        id: 'competitors',
        header: tSection('citingCompetitors.columns.competitors'),
        wrap: true,
        cell: (row) => competitorNames.get(row.cited_with?.entity_id ?? '') ?? <NotAvailable reason={t('na')} />,
      },
    ],
    [tSection, tRole, t, competitorNames],
  );

  const added = useMemo(
    (): PlainColumn<InsightLines['newDomains']['rows'][number]>[] => [
      {
        id: 'domain',
        header: tSection('newDomains.columns.domain'),
        cell: (row) => (
          <DomainCell
            host={row.registrable_domain}
            registrable={row.registrable_domain}
            favicon="show"
            context="list"
          />
        ),
      },
      {
        id: 'firstSeen',
        header: tSection('newDomains.columns.firstSeen'),
        cell: (row) =>
          row.first_seen_at === null ? (
            <NotAvailable reason={tSection('newDomains.firstSeenUnknown')} />
          ) : (
            formatTableDate(row.first_seen_at, project.timeZone)
          ),
      },
      {
        id: 'citations',
        header: tSection('newDomains.columns.citations'),
        cell: (row) => <span className="num">{formatInteger(row.current_units)}</span>,
      },
    ],
    [tSection, project.timeZone],
  );

  if (engines.status === 'idle' || (engines.status === 'ready' && engines.enabled.length === 0)) {
    return (
      <div className={PAGE}>
        <h1 className="sr-only">{t('title')}</h1>
        <EmptyState title={t('noPlatformTitle')} reason={t('noPlatformReason')} headingLevel={2} />
      </div>
    );
  }

  return (
    <div className={PAGE}>
      <div className="flex min-h-control items-center gap-2">
        <h1 className="type-page-title">{t('title')}</h1>
        <span className="type-meta">{t('meta')}</span>
      </div>
      <InsightCard
        section="untracked"
        read={reads.untracked}
        columns={untracked}
        rowKey={(row) => row.text}
        viewAll={links.untracked}
        unknownText={tSection('untracked.unknown')}
      />
      <InsightCard
        section="gaps"
        read={reads.gaps}
        columns={gaps}
        rowKey={(row) => row.prompt_id}
        viewAll={links.gaps}
      />
      <InsightCard
        section="citingCompetitors"
        read={reads.citingCompetitors}
        columns={citing}
        rowKey={(row) => `${row.registrable_domain}:${row.domain_role}`}
        viewAll={links.citingCompetitors}
        unknownText={tSection('citingCompetitors.unknown')}
      />
      <InsightCard
        section="newDomains"
        read={reads.newDomains}
        columns={added}
        rowKey={(row) => `${row.registrable_domain}:${row.domain_role}`}
        viewAll={links.newDomains}
      />
    </div>
  );
}
