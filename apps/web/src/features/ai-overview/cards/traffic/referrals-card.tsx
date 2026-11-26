'use client';

import { Plug } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type ReactNode } from 'react';

import {
  assistantMark,
  DEFAULT_CLASSIFIER,
  referralBars,
  referralChange,
  referralsStanding,
  type Classifier,
  type ReferralBar,
  type ReferralsStanding,
} from './referrals-model';
import { useAiReferrals } from './referrals-read';
import { ReferralsTable, referralsCsv, useReferralHeaders } from './referrals-table';
import { useOverview } from '../../overview-context';
import { singlePlatform } from '../../scope/scope-model';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { BarList, type BarListProps, type ComparisonRow } from '@/components/app/chart/bar-list';
import { ChartFrame, type ChartEmpty, type ChartError, type ChartNotice } from '@/components/app/chart/chart-frame';
import { EngineMark } from '@/components/app/engine/engine-logo';
import { EmptyState } from '@/components/app/status/empty-state';
import { Icon } from '@/components/ui/icon';
import { LinkButton } from '@/components/ui/link-button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { apiAllPagesQuery } from '@/lib/api/query';
import { formatBusinessDate, formatDateRange, formatInteger, formatList, formatMetricDelta } from '@/lib/format';
import { integrationsPath } from '@/lib/routes/paths';

/** The platforms whose visits Google Analytics cannot tell apart from Google organic (the info text says so). */
const NOT_MEASURED = ['google_ai_mode', 'google_ai_overview'];

/** The properties linked to the project (the integrations page reads the same route). */
const INTEGRATIONS = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/integrations' as const;

/** The bars drawn; every platform the answer lists is in the Table view. */
const MAX_BARS = 5;

/** What the frame shows: one status, with its empty state, error or notice. */
type FrameState = (
  | { status: 'loading' | 'ready' | 'refetching'; empty?: undefined; error?: undefined }
  | { status: 'empty'; empty: ChartEmpty; error?: undefined }
  | { status: 'error'; error: ChartError; empty?: undefined }
) & { notice?: ChartNotice | undefined };

/** The body when the chosen way of counting has no platform: what is missing, and the way to see the rest. */
function NoneCounted({ classifier }: { classifier: Classifier }): ReactElement {
  const t = useTranslations('aiOverview.sourcesTracking.referrals');
  return (
    <EmptyState
      variant="card"
      title={t('noneCountedTitle', { classifier })}
      reason={t('noneCountedReason')}
      headingLevel={3}
    />
  );
}

/**
 * OV-TRF-01 and OV-NOPORT-06: the visits that come from AI platforms, from Google Analytics (WP-69, route
 * `fp/ai-referrals`). Until the project has a live GA4 property the card says GA4 is not connected, with the way to
 * connect it; with one and nothing collected it says the visits are not collected yet. Collected, it draws one flat
 * bar per platform, largest first, with the change against the compared period, counted either by our rules or by the
 * GA4 channel (the person chooses; the Table view lists both, with their difference). A period collected in full with
 * no row is a real zero and is said so; a period collected only in part says up to which day, and is never a zero.
 * On Google AI Mode and Google AI Overview it says the visits are not measured there. Nothing is estimated.
 */
export default function ReferralsCard(): ReactElement {
  const t = useTranslations('aiOverview.sourcesTracking.referrals');
  const status = useTranslations('status.error');
  const common = useTranslations('common');
  const { workspaceId, workspaceSlug, project, scope } = useOverview();
  const [classifier, setClassifier] = useState<Classifier>(DEFAULT_CLASSIFIER);
  const headers = useReferralHeaders();
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
  const read = useAiReferrals(measured && linked);

  const notConnected: ChartEmpty = { title: t('notConnectedTitle'), reason: t('notConnectedReason') };
  const notCollected: ChartEmpty = { title: t('linkedTitle'), reason: t('linkedReason') };
  const errorOf = (id: string | null, retry: () => void): ChartError => ({
    title: t('errorTitle'),
    reason: t('errorReason'),
    errorId:
      id === null
        ? null
        : { id, label: status('errorId', { id }), copyLabel: status('copyErrorId'), copiedLabel: status('copied') },
    onRetry: retry,
    retrying: false,
    retryLabel: common('retry'),
  });

  const response = read.data;
  const standing: ReferralsStanding | null = response === undefined ? null : referralsStanding(response);
  const rows = response?.data ?? [];

  let frame: FrameState;
  let summary: string;
  if (!measured) {
    frame = { status: 'empty', empty: unavailable };
    summary = unavailable.reason;
  } else if (integrations.isPending) {
    frame = { status: 'loading' };
    summary = t('summary');
  } else if (integrations.isError) {
    frame = { status: 'error', error: errorOf(null, () => void integrations.refetch()) };
    summary = t('errorTitle');
  } else if (!linked) {
    frame = { status: 'empty', empty: notConnected };
    summary = t('summary');
  } else if (standing === null) {
    frame =
      read.status === 'error' ? { status: 'error', error: errorOf(read.errorId, read.refetch) } : { status: 'loading' };
    summary = read.status === 'error' ? t('errorTitle') : t('summaryLinked');
  } else {
    switch (standing.kind) {
      case 'not_connected':
        frame = { status: 'empty', empty: notConnected };
        summary = t('summary');
        break;
      case 'not_collected':
        frame = { status: 'empty', empty: notCollected };
        summary = t('summaryLinked');
        break;
      case 'zero':
        frame = { status: 'empty', empty: { title: t('zeroTitle'), reason: t('zeroReason') } };
        summary = t('summaryZero');
        break;
      case 'before_period_end': {
        const through = formatBusinessDate(standing.through);
        if (standing.since === null) {
          frame = {
            status: 'empty',
            empty: { title: t('throughTitle', { date: through }), reason: t('throughReason') },
          };
          summary = t('summaryThrough', { date: through });
        } else {
          const since = formatBusinessDate(standing.since);
          frame = {
            status: 'empty',
            empty: { title: t('fromThroughTitle', { since, through }), reason: t('fromThroughReason') },
          };
          summary = t('summaryFromThrough', { since, through });
        }
        break;
      }
      case 'rows': {
        // The last figures read and the days collected are both said, neither hiding the other
        const collected =
          standing.through === null
            ? null
            : standing.since === null
              ? t('partialNotice', { date: formatBusinessDate(standing.through) })
              : t('partialFromNotice', {
                  since: formatBusinessDate(standing.since),
                  through: formatBusinessDate(standing.through),
                });
        const texts = [read.stale ? t('stale') : null, collected].filter((text) => text !== null);
        const notice: ChartNotice | undefined =
          texts.length === 0 ? undefined : { kind: read.stale ? 'stale' : 'partial', text: texts.join('. ') };
        frame = {
          status: read.status === 'refetching' ? 'refetching' : 'ready',
          ...(notice === undefined ? {} : { notice }),
        };
        summary = '';
        break;
      }
    }
  }

  const connect: ReactNode =
    measured && !linked && !integrations.isPending && !integrations.isError ? (
      <LinkButton variant="secondary" size="sm" render={<Link href={integrationsPath(workspaceSlug, project.slug)} />}>
        <Icon icon={Plug} size="sm" />
        {t('connect')}
      </LinkButton>
    ) : undefined;

  const shown = frame.status === 'ready' || frame.status === 'refetching';
  const bars = shown ? referralBars(rows, classifier) : [];
  const drawn = bars.slice(0, MAX_BARS);
  // Rows exist, and none has a count under the chosen way of counting: the Table view still has them all
  const noneCounted = shown && bars.length === 0;
  const rowOf = (bar: ReferralBar): ComparisonRow => {
    const input = referralChange(bar);
    const delta = input === null ? undefined : { input, test: 'interim' as const, text: formatMetricDelta(input).text };
    const mark = assistantMark(bar.key);
    const count = formatInteger(bar.sessions);
    return {
      id: bar.key,
      label: bar.name,
      own: false,
      icon: mark === null ? undefined : <EngineMark engine={mark} />,
      value: { kind: 'value', value: bar.sessions, valueText: count, contextText: null },
      delta,
      accessibleText:
        delta === undefined
          ? t('rowText', { name: bar.name, count: bar.sessions })
          : t('rowTextChange', { name: bar.name, count: bar.sessions, change: delta.text }),
      tip: bar.previous === null ? t('tipNoPrevious') : t('tipPrevious', { count: bar.previous }),
    };
  };
  const list: BarListProps = {
    mode: 'comparison',
    rows: drawn.map(rowOf),
    caption: t('caption'),
    labelHeader: headers.platform,
    valueHeader: classifier === 'own_rules' ? headers.ownVisits : headers.ga4Visits,
    contextHeader: '',
    limit: MAX_BARS,
  };
  const classifierControl = (
    <SegmentedControl<Classifier>
      semantics="view"
      label={t('classifierLabel')}
      size="sm"
      value={classifier}
      onValueChange={setClassifier}
      items={[
        { value: 'own_rules', label: t('classifierOwnRules') },
        { value: 'ga4_ai_assistant_channel', label: t('classifierGa4') },
      ]}
    />
  );
  const notes = response?.meta.notes ?? [];
  const footnote: ReactNode = shown ? (
    <div className="flex flex-col gap-1">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      {bars.length > MAX_BARS ? <p>{t('moreRows', { shown: MAX_BARS, total: bars.length })}</p> : null}
    </div>
  ) : (
    t('footnote')
  );
  const period = response === undefined ? null : formatDateRange(response.meta.window.from, response.meta.window.to);
  const leaders = formatList(drawn.slice(0, 3).map((bar) => `${bar.name} ${formatInteger(bar.sessions)}`));
  return (
    <ChartFrame
      kind="html"
      keepHeaderWhenEmpty
      variant="panel"
      {...frame}
      title={title}
      info={{ what: t('infoWhat'), how: t('infoHow') }}
      meta={shown && period !== null ? t('meta', { period, classifier }) : null}
      footnote={footnote}
      controls={shown ? classifierControl : connect}
      height={180}
      summary={
        !shown
          ? summary
          : noneCounted
            ? t('summaryNoneCounted', { classifier })
            : t('summaryRows', { classifier, list: leaders })
      }
      body={shown ? noneCounted ? <NoneCounted classifier={classifier} /> : <BarList {...list} /> : null}
      table={shown ? <ReferralsTable rows={rows} caption={t('caption')} /> : null}
      menu={shown ? { fileName: t('fileName'), csv: referralsCsv(rows, headers) } : undefined}
    />
  );
}
