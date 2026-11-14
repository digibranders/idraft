'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { useCardMeta } from './card-meta';
import type { CardPhase } from './card-phase';
import {
  countryModel,
  isCountryMetric,
  MAX_COUNTRY_GROUPS,
  type CountryGroup,
  type CountryMetric,
  type EngineFigure,
} from './country-model';
import { engineLabel } from './engine-role';
import { useCardData } from './use-card-data';
import { useCardDensity } from './use-card-density';
import { useCountryReads, type CountryReadState } from './use-country-reads';
import { useCardDrill, useCardExport } from './use-card-seams';
import { useFrameState } from './use-frame-state';
import type { ExportBlock } from '../../export/export-model';
import { ChartFrame, type ChartEmpty } from '@/components/app/chart/chart-frame';
import { TopicEnginePanel, type EnginePanelRow } from '@/components/app/chart/topic-engine-panel';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { LinkButton } from '@/components/ui/link-button';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';
import { EMPTY_VALUE, formatInteger, formatList, formatPercent } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

type Translate = ReturnType<typeof useTranslations<'aiOverview.engines.country'>>;

const FILE_NAME = 'by-country';
const NO_COUNTRIES: readonly string[] = [];
const EXPORT_HEADER = ['country', 'engine', 'metric', 'value', 'successes', 'answers', 'prompts', 'status'] as const;

const METRIC_KEY = {
  mention: 'metricMention',
  citation: 'metricCitation',
  share_of_voice: 'metricShareOfVoice',
} as const satisfies Record<CountryMetric, string>;

const REASON_KEY = { noAnswers: 'noAnswers', noneValid: 'noneValid', noBrandNamed: 'noBrandNamed' } as const;
const NONE_STATUS = { noAnswers: 'no_answers', noneValid: 'no_valid_answers', noBrandNamed: 'no_brand_named' } as const;

/** One engine of one country, in the words of the bars, the Table view, the file and the export. */
interface Line {
  id: string;
  country: string;
  countryName: string;
  engineName: string;
  valueText: string;
  answersText: string;
  promptsText: string;
  /** The raw figures of the export; `null` where they are unknown or do not apply. */
  percent: number | null;
  successes: number | null;
  answers: number | null;
  prompts: number | null;
  status: string;
}

/** The name of a country in the reader's language: "Germany" for `DE`; the code itself when it is not a country. */
function useCountryName(): (code: string) => string {
  const locale = useLocale();
  const names = useMemo(() => new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }), [locale]);
  return useCallback(
    (code) => {
      try {
        return names.of(code) ?? code;
      } catch (error) {
        if (error instanceof RangeError) return code;
        throw error;
      }
    },
    [names],
  );
}

/** What a row of the bars says: the rate with its counts, the answers of a thin row, or why there is nothing. */
function panelRow(figure: EngineFigure, metric: CountryMetric, engine: string, t: Translate): EnginePanelRow {
  const reason = t(REASON_KEY[figure.reason ?? 'noAnswers']);
  const base = {
    code: figure.engineCode,
    label: engine,
    state: figure.state,
    value: figure.value,
    answers: figure.answers,
    noneText: reason,
  };
  if (figure.state === 'insufficient') {
    return {
      ...base,
      valueText: '',
      contextText: null,
      accessibleText: t('rowThin', { engine, count: figure.answers }),
    };
  }
  if (figure.state === 'none') {
    return { ...base, valueText: '', contextText: null, accessibleText: t('rowNone', { engine, reason }) };
  }
  const valueText = formatPercent(figure.value, { decimals: 0 });
  const context =
    metric === 'share_of_voice' || figure.successes === null
      ? t('contextShare', { n: figure.answers, prompts: figure.prompts })
      : t('context', { k: figure.successes, n: figure.answers, prompts: figure.prompts });
  return {
    ...base,
    valueText,
    contextText: context,
    accessibleText: t('rowName', { engine, value: valueText, context }),
  };
}

function lineOf(
  country: string,
  countryName: string,
  figure: EngineFigure,
  metric: CountryMetric,
  engine: string,
  t: Translate,
): Line {
  const common = { id: `${country}-${figure.engineCode}`, country, countryName, engineName: engine };
  if (figure.state === 'none') {
    const reason = figure.reason ?? 'noAnswers';
    return {
      ...common,
      valueText: t(REASON_KEY[reason]),
      answersText: EMPTY_VALUE,
      promptsText: EMPTY_VALUE,
      percent: null,
      successes: null,
      answers: null,
      prompts: null,
      status: NONE_STATUS[reason],
    };
  }
  const shared = {
    ...common,
    promptsText: formatInteger(figure.prompts),
    successes: figure.successes,
    answers: figure.answers,
    prompts: figure.prompts,
  };
  if (figure.state === 'insufficient') {
    const words = t('thin', { count: figure.answers });
    return { ...shared, valueText: words, answersText: words, percent: null, status: 'insufficient' };
  }
  return {
    ...shared,
    valueText: formatPercent(figure.value, { decimals: 0 }),
    answersText:
      metric === 'share_of_voice' || figure.successes === null
        ? t('answersShare', { n: figure.answers })
        : t('answers', { k: figure.successes, n: figure.answers }),
    percent: figure.value === null ? null : Math.round(figure.value * 10_000) / 100,
    status: 'ok',
  };
}

/**
 * By country (CH-23): the metric of the card's option for each asked engine, one group per country the project asks
 * in, on one scale. Each country is read on its own with the other filters of the page, and the page's own country
 * filter is ignored on purpose, which the meta line says. One country that fails to read leaves the others.
 */
export default function CountryBreakdownCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.country');
  const common = useTranslations('aiOverview.engines.common');
  const status = useTranslations('status.error');
  const density = useCardDensity();
  const drill = useCardDrill();
  const nameOf = useCountryName();
  const metaOf = useCardMeta();
  const metric = options.metric !== undefined && isCountryMetric(options.metric) ? options.metric : 'mention';
  const data = useCardData({ previous: 'none', subscribed: live });
  const { countries, reads } = useCountryReads({ subscribed: live });
  const { scope, asked } = data;
  const title = t('title');
  const metricLabel = t(METRIC_KEY[metric]);

  const list = countries.data ?? NO_COUNTRIES;
  const model = useMemo(() => countryModel({ countries: list, reads, asked, metric }), [list, reads, asked, metric]);

  // The page's engines and its own read come first, as on every card; then the countries, then each country's read
  let phase: CardPhase;
  if (data.phase === 'loading' || data.phase === 'error') phase = data.phase;
  else if (asked.length === 0) phase = 'empty';
  else if (countries.status === 'error') phase = 'error';
  else if (!countries.complete || reads.some((read) => read.status === 'loading')) phase = 'loading';
  else if (model.kind === 'tooFewCountries') phase = 'empty';
  else phase = reads.some((read) => read.status === 'refetching') ? 'refetching' : 'ready';

  const retry = useCallback((): void => {
    data.retry();
    countries.refetch();
    for (const read of reads) if (read.status === 'error') read.retry();
  }, [data, countries, reads]);
  const prompts = useCardPrompts(reads);
  const hasGroups = model.kind === 'groups';
  const promptsLink = drill('prompts');
  const empty: ChartEmpty | null =
    asked.length === 0
      ? { title: t('emptyNoEnginesTitle'), reason: t('emptyNoEnginesReason') }
      : model.kind === 'tooFewCountries'
        ? {
            title: t('emptyOneTitle'),
            reason: t('emptyOneReason'),
            action:
              promptsLink === null ? undefined : (
                <LinkButton size="sm" render={<Link href={promptsLink} />}>
                  {t('emptyOneAction')}
                </LinkButton>
              ),
          }
        : null;
  const frame = useFrameState(
    {
      phase,
      stale: data.stale || countries.stale || reads.some((read) => read.stale),
      partialPrevious: false,
      errorId: data.phase === 'error' ? data.errorId : countries.errorId,
      retry,
    },
    { name: title, empty },
  );

  const groups = model.kind === 'groups' ? model.groups : [];
  const readOf = (country: string): CountryReadState | undefined => reads.find((read) => read.country === country);
  const engineName = (code: string): string => engineLabel(code) ?? common('unknownEngine');
  const lines: Line[] = groups.flatMap((group): Line[] => {
    const countryName = nameOf(group.country);
    if (group.kind === 'failed') {
      return [
        {
          id: group.country,
          country: group.country,
          countryName,
          engineName: EMPTY_VALUE,
          valueText: EMPTY_VALUE,
          answersText: EMPTY_VALUE,
          promptsText: EMPTY_VALUE,
          percent: null,
          successes: null,
          answers: null,
          prompts: null,
          status: 'failed',
        },
      ];
    }
    return group.rows.map((figure) =>
      lineOf(group.country, countryName, figure, metric, engineName(figure.engineCode), t),
    );
  });

  const columns: PlainColumn<Line>[] = [
    { id: 'country', header: t('countryHeader'), cell: (line) => line.countryName },
    { id: 'engine', header: t('engineHeader'), cell: (line) => line.engineName },
    { id: 'value', header: t('valueHeader', { metric: metricLabel }), cell: (line) => line.valueText },
    { id: 'answers', header: t('answersHeader'), cell: (line) => line.answersText },
    { id: 'prompts', header: t('promptsHeader'), cell: (line) => line.promptsText },
  ];

  const summary = [
    t('summaryIntro', { metric: metricLabel, countries: formatList(groups.map((group) => nameOf(group.country))) }),
    ...groups.map((group) =>
      group.kind === 'failed'
        ? t('summaryFailed', { country: nameOf(group.country) })
        : t('summaryCountry', {
            country: nameOf(group.country),
            parts: group.rows
              .map((figure) => panelRow(figure, metric, engineName(figure.engineCode), t).accessibleText)
              .join('; '),
          }),
    ),
  ].join(' ');

  useCardExport(item.id, (): ExportBlock | null => {
    if (!hasGroups) return null;
    return {
      id: item.id,
      header: EXPORT_HEADER,
      rows: lines.map((line): CsvCell[] => [
        line.country,
        line.engineName === EMPTY_VALUE ? null : line.engineName,
        metric,
        line.percent,
        line.successes,
        line.answers,
        line.prompts,
        line.status,
      ]),
    };
  });

  const errorWords = (read: CountryReadState | undefined): Parameters<typeof InlineError>[0]['errorId'] => {
    const id = read?.errorId ?? null;
    return id === null
      ? null
      : {
          id,
          label: status('errorId', { id }),
          copyLabel: status('copyErrorId'),
          copiedLabel: status('copied'),
        };
  };

  const hidden = model.kind === 'groups' ? model.hidden : 0;
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      meta={`${metaOf({ range: scope.range, prompts, answers: null, branded: scope.branded })}, ${t('metaCountries')}`}
      footnote={[
        t('footnote', { min: MIN_OBSERVATIONS }),
        ...(hidden === 0 ? [] : [t('footnoteHidden', { count: hidden, max: MAX_COUNTRY_GROUPS })]),
      ].join(' ')}
      height={240}
      summary={summary}
      menu={{
        fileName: FILE_NAME,
        csv: {
          header: columns.map((column) => safeText(column.header)),
          rows: lines.map((line) =>
            [line.countryName, line.engineName, line.valueText, line.answersText, line.promptsText].map(safeText),
          ),
        },
      }}
      body={
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <CountryGroupView
              key={group.country}
              group={group}
              name={nameOf(group.country)}
              metricLabel={metricLabel}
              density={density}
              rowsOf={(figures) => figures.map((figure) => panelRow(figure, metric, engineName(figure.engineCode), t))}
              failed={
                group.kind === 'failed' ? (
                  <InlineError
                    title={common('errorTitle', { name: nameOf(group.country) })}
                    reason={common('errorReason')}
                    errorId={errorWords(readOf(group.country))}
                    onRetry={() => {
                      readOf(group.country)?.retry();
                    }}
                    retrying={readOf(group.country)?.status === 'refetching'}
                    retryLabel={common('retry')}
                  />
                ) : null
              }
            />
          ))}
        </div>
      }
      table={
        <PlainTable<Line>
          caption={t('tableCaption', { metric: metricLabel })}
          columns={columns}
          rows={lines}
          rowKey={(line) => line.id}
          status="ready"
          errorState={null}
          emptyText={EMPTY_VALUE}
        />
      }
      {...frame}
    />
  );
}

/** The prompts of every country that was read; `null` while one has not answered, which leaves the fact out. */
function useCardPrompts(reads: readonly CountryReadState[]): number | null {
  return useMemo(
    () =>
      reads.length > 0 && reads.every((read) => read.prompts !== null)
        ? reads.reduce((total, read) => total + (read.prompts?.length ?? 0), 0)
        : null,
    [reads],
  );
}

interface CountryGroupViewProps {
  group: CountryGroup;
  name: string;
  metricLabel: string;
  density: ReturnType<typeof useCardDensity>;
  rowsOf: (figures: readonly EngineFigure[]) => EnginePanelRow[];
  /** The group's error with its Retry; `null` for a group that was read. */
  failed: ReactElement | null;
}

/** One country: its name as a heading of level 3, the prompts behind it, and its engines (or why it failed). */
function CountryGroupView({ group, name, metricLabel, density, rowsOf, failed }: CountryGroupViewProps): ReactElement {
  const t = useTranslations('aiOverview.engines.country');
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="type-subsection-title text-foreground">{name}</h3>
        {group.kind === 'ready' ? (
          <span className="type-meta text-foreground-tertiary">{t('groupPrompts', { count: group.prompts })}</span>
        ) : null}
      </div>
      {group.kind === 'ready' ? (
        <TopicEnginePanel
          caption={t('caption', { metric: metricLabel, country: name })}
          labelHeader={t('labelHeader')}
          valueHeader={t('valueHeader', { metric: metricLabel })}
          contextHeader={t('contextHeader')}
          rows={rowsOf(group.rows)}
          density={density}
        />
      ) : (
        failed
      )}
    </div>
  );
}
