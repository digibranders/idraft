'use client';

import { Plug } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useOverview } from '../../overview-context';
import { singlePlatform } from '../../scope/scope-model';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { ChartFrame, type ChartEmpty } from '@/components/app/chart/chart-frame';
import { Icon } from '@/components/ui/icon';
import { LinkButton } from '@/components/ui/link-button';
import { apiAllPagesQuery } from '@/lib/api/query';
import { integrationsPath } from '@/lib/routes/paths';

/** The platforms whose visits Google Analytics cannot tell apart from Google organic (the info text says so). */
const NOT_MEASURED = ['google_ai_mode', 'google_ai_overview'];

/** The properties linked to the project (the integrations page reads the same route). */
const INTEGRATIONS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/integrations' as const;

/**
 * OV-TRF-01 and OV-NOPORT-06: the visits that come from AI platforms, from Google Analytics. The API has no route for
 * them yet (backend request 5), so the card draws no chart and no landing page: nothing is estimated and no sample
 * value ships. It says GA4 is not connected, with the way to connect it, until the project has a live GA4 property;
 * then it says the property is linked and the visits are not collected yet. On Google AI Mode and Google AI Overview it says
 * the visits are not measured there, as the preview does; on ChatGPT and Gemini it keeps its place and says the rest.
 */
export default function ReferralsCard(): ReactElement {
  const t = useTranslations('aiOverview.sourcesTracking.referrals');
  const { workspaceId, workspaceSlug, project, scope } = useOverview();
  const integrations = useQuery({
    ...apiAllPagesQuery(INTEGRATIONS, (integration) => integration.integration_id, {
      params: { path: { workspace_id: workspaceId, project_id: project.id } },
    }),
    staleTime: 0,
  });
  // A switched off property is history, not state
  const linked = (integrations.data?.data ?? []).some(
    (integration) => integration.kind === 'ga4' && integration.status !== 'disabled',
  );
  const title = t('title');
  const unavailable = useScopeUnavailable(title);
  const platform = singlePlatform(scope);
  const measured = platform === null || !NOT_MEASURED.includes(platform);
  const empty: ChartEmpty = !measured
    ? unavailable
    : linked
      ? { title: t('linkedTitle'), reason: t('linkedReason') }
      : { title: t('notConnectedTitle'), reason: t('notConnectedReason') };
  const connect =
    measured && !linked ? (
      <LinkButton variant="secondary" size="sm" render={<Link href={integrationsPath(workspaceSlug, project.slug)} />}>
        <Icon icon={Plug} size="sm" />
        {t('connect')}
      </LinkButton>
    ) : undefined;
  return (
    <ChartFrame
      kind="html"
      keepHeaderWhenEmpty
      variant="panel"
      status="empty"
      empty={empty}
      title={title}
      info={{ what: t('infoWhat'), how: t('infoHow') }}
      footnote={t('footnote')}
      controls={connect}
      height={180}
      summary={!measured ? unavailable.reason : linked ? t('summaryLinked') : t('summary')}
      body={null}
      table={null}
    />
  );
}
