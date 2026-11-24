'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiProblem, retryMinutes } from '@/lib/api/problem';
import { engineLabel } from '@/lib/layouts/catalog';
import { formatBusinessDate, formatDateRange, formatInteger, formatPercent } from '@/lib/format';
import { publicReportQuery } from '@/lib/reports/queries';
import { figureOf, shareOfVoiceOf, trendOf, type ShareFigure } from '@/lib/reports/report-model';
import type { ClientReport, ReportEngine } from '@/lib/reports/types';

type Unit = 'answers' | 'mentions';

/** "37% (71 of 192 answers)": a percent always comes with its counts; too few answers is not a rate. */
function useFigureText(): (figure: ShareFigure, unit: Unit) => string {
  const t = useTranslations('reports.guest.figure');
  const locale = useLocale();
  return (figure, unit) => {
    if (figure.state === 'unavailable') return t(figure.reason);
    const counts = {
      successes: figure.successes === null ? '' : formatInteger(figure.successes, { locale }),
      answers: formatInteger(figure.answers, { locale }),
    };
    if (figure.state === 'none') return t(unit === 'answers' ? 'noAnswers' : 'noMentions');
    if (figure.state === 'insufficient') return t(`${unit}.tooFew`, counts);
    return t(`${unit}.rate`, { percent: formatPercent(figure.value, { locale }), ...counts });
  };
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactElement }): ReactElement {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="type-section-title">{title}</h2>
        {note === undefined ? null : <p className="type-meta">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const plain = <TRow,>(
  caption: string,
  columns: readonly PlainColumn<TRow>[],
  rows: readonly TRow[],
  rowKey: (row: TRow) => string,
): ReactElement => (
  <PlainTable
    caption={caption}
    columns={columns}
    rows={rows}
    rowKey={rowKey}
    status="ready"
    errorState={null}
    emptyText=""
  />
);

function Trend({ engine, name }: { engine: ReportEngine; name: string }): ReactElement {
  const t = useTranslations('reports.guest');
  const text = useFigureText();
  const weeks = trendOf(engine);
  const label = (weekStart: string, pooledWeeks: number | null, figure: ShareFigure): string =>
    pooledWeeks === null
      ? t('weekLabel', { date: weekStart, figure: text(figure, 'answers') })
      : t('weekPooledLabel', { date: weekStart, weeks: pooledWeeks, figure: text(figure, 'answers') });
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <p className="type-body-strong">{name}</p>
      <ul className="flex h-16 items-end gap-2">
        {weeks.map(({ weekStart, pooledWeeks, figure, height }) => (
          <li
            key={weekStart}
            className="flex-1 rounded-sm bg-primary"
            style={{ height: `${String(Math.max(6, Math.round(height * 100)))}%` }}
            role="img"
            aria-label={label(weekStart, pooledWeeks, figure)}
            title={label(weekStart, pooledWeeks, figure)}
          />
        ))}
      </ul>
      <ul className="flex gap-2">
        {weeks.map(({ weekStart }) => (
          <li key={weekStart} className="flex-1 text-center type-meta">
            {formatBusinessDate(weekStart, { withYear: false })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The report as a guest reads it: read only, with no way into the app, and no costs, prompts or answers. */
export function GuestReportView({ report }: { report: ClientReport }): ReactElement {
  const t = useTranslations('reports.guest');
  const locale = useLocale();
  const text = useFigureText();
  const name = (code: string): string => engineLabel(code);

  const platformColumns: PlainColumn<ReportEngine>[] = [
    { id: 'platform', header: t('columns.platform'), cell: (engine) => name(engine.engine_code) },
    { id: 'mention', header: t('columns.mentionRate'), cell: (engine) => text(figureOf(engine.mentioned), 'answers') },
    { id: 'citation', header: t('columns.citationRate'), cell: (engine) => text(figureOf(engine.cited), 'answers') },
    {
      id: 'voice',
      header: t('columns.shareOfVoice'),
      cell: (engine) => text(shareOfVoiceOf(report, engine.engine_code), 'mentions'),
    },
  ];
  const brandColumns: PlainColumn<ClientReport['brands'][number]>[] = [
    {
      id: 'brand',
      header: t('columns.brand'),
      cell: (brand) =>
        brand.role === 'own' ? (
          brand.name
        ) : (
          <span className="flex items-center gap-2">
            {brand.name}
            <Badge tone="neutral">{t('competitor')}</Badge>
          </span>
        ),
    },
    ...report.engines.flatMap((engine): PlainColumn<ClientReport['brands'][number]>[] => [
      {
        id: `${engine.engine_code}-mention`,
        header: t('columns.platformMention', { platform: name(engine.engine_code) }),
        cell: (brand) => {
          const cell = brand.engines.find((entry) => entry.engine_code === engine.engine_code)?.mentioned;
          return cell === undefined ? '' : text(figureOf(cell), 'answers');
        },
      },
    ]),
  ];
  const domainColumns: PlainColumn<ClientReport['cited_domains'][number]>[] = [
    { id: 'domain', header: t('columns.domain'), cell: (domain) => domain.registrable_domain },
    {
      id: 'type',
      header: t('columns.type'),
      cell: (domain) => t(`domainType.${domain.domain_role === 'third_party' ? 'thirdParty' : domain.domain_role}`),
    },
    {
      id: 'citations',
      header: t('columns.citations'),
      cell: (domain) => formatInteger(domain.citation_units, { locale }),
    },
    {
      id: 'share',
      header: t('columns.citationShare'),
      cell: (domain) => text(figureOf(domain.source_share), 'answers'),
    },
  ];

  return (
    <article className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="type-page-title">{t('title', { host: report.host })}</h1>
        <p className="type-body text-foreground-secondary">
          {t('period', { range: formatDateRange(report.window_from, report.window_to), prompts: report.prompt_count })}
        </p>
      </header>
      {report.engines.length === 0 ? (
        <EmptyState variant="card" title={t('emptyTitle')} reason={t('emptyText')} headingLevel={2} />
      ) : (
        <>
          <Section title={t('numbers')} note={t('numbersNote')}>
            {plain(t('numbers'), platformColumns, report.engines, (engine) => engine.engine_code)}
          </Section>
          <Section title={t('weekly')} note={t('weeklyNote')}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {report.engines.map((engine) => (
                <Trend key={engine.engine_code} engine={engine} name={name(engine.engine_code)} />
              ))}
            </div>
          </Section>
          <Section title={t('brands')} note={t('brandsNote')}>
            {plain(t('brands'), brandColumns, report.brands, (brand) => brand.name)}
          </Section>
          <Section title={t('domains')} note={t('domainsNote')}>
            {plain(t('domains'), domainColumns, report.cited_domains, (domain) => domain.registrable_domain)}
          </Section>
        </>
      )}
      <footer className="border-t border-border pt-3 type-meta">{t('footer')}</footer>
    </article>
  );
}

/** The page a report link opens. Unknown, expired and revoked links all answer 404 and read the same here. */
export function GuestReport({ token }: { token: string }): ReactElement {
  const t = useTranslations('reports.guest');
  const common = useTranslations('common');
  const read = useQuery(publicReportQuery(token));
  if (read.data !== undefined) return <GuestReportView report={read.data.data} />;
  if (read.isPending) {
    return (
      <div role="status" aria-label={t('loading')} className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-6">
        <Skeleton shape="block" height="row" />
        <Skeleton shape="block" height="row" />
        <Skeleton shape="block" height="row" />
      </div>
    );
  }
  const error = read.error;
  if (isApiProblem(error, 'not_found')) {
    return (
      <div className="m-auto p-6">
        <EmptyState title={t('goneTitle')} reason={t('goneText')} headingLevel={1} />
      </div>
    );
  }
  const busy = isApiProblem(error) && error.status === 429;
  return (
    <div className="m-auto p-6">
      <EmptyState
        title={busy ? t('busyTitle') : t('failedTitle')}
        reason={
          busy
            ? error.retryAfterSeconds === null
              ? t('busyText')
              : t('busyTextWait', { minutes: retryMinutes(error) })
            : t('failedText')
        }
        primaryAction={
          <Button variant="secondary" loading={read.isFetching} onClick={() => void read.refetch()}>
            {common('retry')}
          </Button>
        }
        headingLevel={1}
      />
    </div>
  );
}
