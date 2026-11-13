'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type ReactNode } from 'react';

import { useSourceChanges, useSourceDiversity } from './data/source-reads';
import { changeRows, newSourcesCount, type ChangeFigures, type ChangeKind } from './model/changes-model';
import { useCitationsDrill } from './parts/drill';
import { useFrameState, type DataSituation, type ReadFacts } from './parts/frame-state';
import { engineNames } from './parts/source-meta';
import { useCardDensity } from '../engines/use-card-density';
import { useCardExport } from '../engines/use-card-seams';
import type { Say } from '../../numbers/number-model';
import { BarList, BarListTable, type BarListProps, type ComparisonRow } from '@/components/app/chart/bar-list';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { DomainRoleBadge } from '@/components/app/cells/domain-cell';
import { visibleUrlText } from '@/components/app/cells/visible-text';
import { CountTabs } from '@/components/app/feed/count-tabs';
import { MetricInfo } from '@/components/app/metric/metric-info';
import type { CardProps } from '@/features/layouts';
import { announce } from '@/lib/a11y/announcer';
import { METHODOLOGY_HREF } from '@/lib/citations/methodology';
import type { SourceChangePage } from '@/lib/citations/types';
import type { CsvTable } from '@/lib/csv/csv-write';
import { displayDomain, EMPTY_VALUE, formatDateRange, formatInteger, formatList } from '@/lib/format';

/** Rows asked of each list; one list shows them all, both lists together show `BOTH_ROWS` each. */
const LIST_ROWS = 5;
const BOTH_ROWS = 3;
const KINDS: readonly ChangeKind[] = ['new', 'lost'];
const ROLE_KEY = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const;

/** The status the frame shows for several reads: an error beats a read under way, which beats a refetch. */
function mergeFacts(reads: readonly ReadFacts[]): ReadFacts {
  const failed = reads.find((read) => read.status === 'error');
  const status = failed
    ? 'error'
    : reads.some((read) => read.status === 'loading' || read.status === 'idle')
      ? 'loading'
      : reads.some((read) => read.status === 'refetching')
        ? 'refetching'
        : 'ready';
  return {
    status,
    errorId: failed?.errorId ?? null,
    stale: reads.some((read) => read.stale),
    refetch: () => {
      for (const read of reads) read.refetch();
    },
  };
}

/**
 * CH-22 and WB-OV-12: the domains answers started citing (new) and stopped citing (lost), with the count of new
 * domains as the headline. Counts are `page.total` of one list each. New domains can only be told against a window
 * before that has answers, and never show as 0 without it; lost shows what the route returns, whose rule needs 2
 * windows after the last citation. The units of every engine in scope are one pool, as the route aggregates them.
 */
export default function NewLostCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sources.newLost');
  const say = useTranslations('aiOverview.sources.common') as Say;
  const roleWords = useTranslations('common.domainCell.roles');
  const density = useCardDensity();
  const citations = useCitationsDrill();
  const reads = useSourceChanges({ limit: LIST_ROWS, subscribed: live });
  const diversity = useSourceDiversity({ subscribed: live });
  const [choice, setChoice] = useState<readonly ChangeKind[]>(['new']);

  const newPage = reads.newer.data;
  const lostPage = reads.lost.data;
  const previousAnswers = reads.before?.data ?? null;
  const newCount = newSourcesCount(newPage, previousAnswers);
  const lostCount = lostPage?.page.total ?? null;
  const newReason =
    newCount !== null
      ? null
      : reads.before?.status === 'error'
        ? 'unread'
        : previousAnswers === 0
          ? 'no_answers'
          : null;
  const unknownText = newReason === 'unread' ? t('unknownUnread') : t('unknownNoAnswers');
  const domainsCited = diversity.current.data?.meta.distinct_domains ?? null;

  const gating = reads.before === null || reads.before.status === 'error' ? [] : [reads.before];
  const frame = useFrameState({
    subject: t('subject'),
    read: mergeFacts([reads.newer, reads.lost, ...gating]),
    previous: reads.before,
    previousEmpty: false,
    situation: ((): DataSituation => (reads.askable === 'ok' ? { kind: 'ready' } : { kind: reads.askable }))(),
  });
  const shown = frame.status === 'ready' || frame.status === 'refetching';

  // New cannot be pressed while it cannot be told; a choice of New alone falls to Lost
  const requested = choice.filter((kind) => kind === 'lost' || newReason === null);
  const pressed: readonly ChangeKind[] = choice.length > 0 && requested.length === 0 ? ['lost'] : requested;
  const visible = pressed.length === 0 ? KINDS : pressed;
  const rowsShown = visible.length === 2 ? BOTH_ROWS : LIST_ROWS;

  const pageOf = (kind: ChangeKind): SourceChangePage | undefined => (kind === 'new' ? newPage : lostPage);
  const figuresOf = (kind: ChangeKind): ChangeFigures[] => {
    const page = pageOf(kind);
    return page === undefined ? [] : changeRows(page, kind);
  };

  const rowOf = (figure: ChangeFigures, kind: ChangeKind): ComparisonRow => {
    const name = visibleUrlText(displayDomain(figure.domain));
    const role = roleWords(ROLE_KEY[figure.role]);
    return {
      id: figure.id,
      label: name,
      own: figure.own,
      href: citations({ tab: 'new-lost', kind }) ?? undefined,
      badge: <DomainRoleBadge role={figure.role} />,
      value: {
        kind: 'value',
        value: figure.units,
        valueText: t('units', { units: figure.units }),
        contextText: t('nowBefore', { now: formatInteger(figure.unitsNow), before: formatInteger(figure.unitsBefore) }),
      },
      accessibleText: t('rowText', { name, role, kind, now: figure.unitsNow, before: figure.unitsBefore }),
    };
  };
  const listOf = (kind: ChangeKind): BarListProps => {
    const rows = figuresOf(kind).map((figure) => rowOf(figure, kind));
    return {
      mode: 'comparison',
      rows,
      caption: t(kind === 'new' ? 'captionNew' : 'captionLost'),
      labelHeader: t('labelHeader'),
      valueHeader: t('valueHeader'),
      contextHeader: t('contextHeader'),
      limit: rowsShown,
      density,
    };
  };

  // Both lists as one table for the export and the frame's download: the rows the route sent, new only when it can be told
  const table: CsvTable | undefined =
    newPage === undefined && lostPage === undefined
      ? undefined
      : {
          header: [t('kindHeader'), t('labelHeader'), t('roleHeader'), t('unitsNowHeader'), t('unitsBeforeHeader')],
          rows: KINDS.filter((kind) => kind === 'lost' || newReason === null).flatMap((kind) =>
            figuresOf(kind).map((figure) => [
              t(kind === 'new' ? 'kindNew' : 'kindLost'),
              figure.domain,
              roleWords(ROLE_KEY[figure.role]),
              figure.unitsNow,
              figure.unitsBefore,
            ]),
          ),
        };
  useCardExport(item.id, () => (shown && table !== undefined ? { id: item.id, ...table } : null));

  const choose = (next: readonly ChangeKind[]): void => {
    const added = next.find((kind) => !pressed.includes(kind));
    const value = next.length === 0 || added === undefined ? next : [added];
    setChoice(value);
    const view = value.length === 1 ? (value[0] ?? 'both') : 'both';
    const count =
      view === 'new'
        ? newCount
        : view === 'lost'
          ? lostCount
          : newCount === null || lostCount === null
            ? null
            : newCount + lostCount;
    announce(count === null ? t('announceNone', { view }) : t('announce', { view, count }), {
      key: 'sources-new-lost-view',
    });
  };

  const section = (kind: ChangeKind): ReactNode => {
    const page = pageOf(kind);
    if (page === undefined || (kind === 'new' && newReason !== null)) return null;
    const list = listOf(kind);
    if (list.rows.length === 0) {
      return (
        <div key={kind} className="flex flex-col gap-1 py-2">
          <p className="type-body-strong">{t(kind === 'new' ? 'emptyNewTitle' : 'emptyLostTitle')}</p>
          <p className="type-meta">
            {t(kind === 'new' ? 'emptyNewReason' : 'emptyLostReason', { min: page.meta.min_support })}
          </p>
        </div>
      );
    }
    const hidden = page.page.total - Math.min(list.rows.length, rowsShown);
    return (
      <div key={kind} className="flex flex-col gap-2">
        <BarList {...list} />
        {hidden > 0 ? <p className="type-meta">{t('moreRows', { count: hidden })}</p> : null}
      </div>
    );
  };

  const flaggedNote = say('footnoteFlagged');
  const countText = (count: number | null): string => (count === null ? EMPTY_VALUE : formatInteger(count));
  const meta =
    newPage === undefined || !shown
      ? null
      : t('meta', {
          window: formatDateRange(newPage.meta.window.from, newPage.meta.window.to),
          engines: formatList(engineNames(newPage.meta.engine_codes)),
          branded: String(newPage.meta.include_branded),
        });
  const summary =
    lostCount === null
      ? t('summaryNone')
      : newCount === null
        ? t('summaryUnknown', { lostCount })
        : t('summary', { newCount, lostCount });

  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={280}
      title={t('title')}
      meta={meta}
      summary={summary}
      footnote={
        newPage === undefined ? undefined : (
          <div className="flex flex-col gap-1">
            <p>{t('footnotePooled', { engines: formatList(engineNames(newPage.meta.engine_codes)) })}</p>
            <p>{t('footnoteRule', { min: newPage.meta.min_support })}</p>
            <p>{flaggedNote}</p>
          </div>
        )
      }
      body={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {newCount !== null ? (
              <>
                <p className="num type-metric-sm">{t('headlineNew', { count: newCount })}</p>
                {domainsCited === null ? null : (
                  <p className="type-meta text-foreground-secondary">{t('headlineOf', { total: domainsCited })}</p>
                )}
              </>
            ) : newReason === null ? null : (
              <p className="type-body-strong">{unknownText}</p>
            )}
            <MetricInfo
              name={t('infoName')}
              definition={t('infoDefinition')}
              formula={t('infoFormula')}
              {...(previousAnswers === null ? {} : { denominatorText: t('infoSample', { answers: previousAnswers }) })}
              methodologyHref={METHODOLOGY_HREF}
            />
          </div>
          <CountTabs<ChangeKind>
            label={t('toolbar')}
            allLabel={t('tabAll')}
            allCountText={countText(newCount === null || lostCount === null ? null : newCount + lostCount)}
            size="sm"
            items={[
              {
                value: 'new',
                label: t('tabNew'),
                countText: countText(newCount),
                ...(newReason === null ? {} : { disabledReason: unknownText }),
              },
              { value: 'lost', label: t('tabLost'), countText: countText(lostCount) },
            ]}
            value={pressed}
            onValueChange={choose}
          />
          {visible.map(section)}
        </div>
      }
      table={
        <div className="flex flex-col gap-3">
          {visible.flatMap((kind) =>
            pageOf(kind) === undefined || (kind === 'new' && newReason !== null)
              ? []
              : [<BarListTable key={kind} {...listOf(kind)} />],
          )}
        </div>
      }
      menu={{ fileName: t('fileName'), ...(table === undefined ? {} : { csv: table }) }}
      {...frame}
    />
  );
}
