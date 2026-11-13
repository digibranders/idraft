'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import { gateComparison } from './compare-gate';
import type { EngineValue } from './engine-values';
import { promptHref, promptsTabHref, type LinkContext } from './links';
import { countOf, enumOf } from './options';
import {
  topPromptsExport,
  topPromptsFileName,
  topPromptsModel,
  type PromptRank,
  type PromptShow,
} from './top-prompts-model';
import { useTopicPeriods } from './use-topic-reads';
import { useTopicWords } from './use-topic-words';
import { useOverview } from '../../overview-context';
import { BarList, type ComparisonRow } from '@/components/app/chart/bar-list';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import type { CardProps } from '@/features/layouts';
import { deltaInput, type RateChange } from '@/lib/compare/change-model';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import { EMPTY_VALUE, formatList, formatMetricDelta } from '@/lib/format';
import { projectPath } from '@/lib/routes/paths';
import { MIN_OBSERVATIONS } from '@/lib/stats';

const SHOWS: readonly PromptShow[] = ['most_named', 'least_named', 'largest_change'];
const DEFAULT_ROWS = 5;

interface TableRow {
  id: string;
  prompt: string;
  value: string;
  change: string;
}

/** A listed prompt as the list draws it and as the Table form words it. */
interface Shown {
  row: ComparisonRow;
  table: TableRow;
}

/**
 * Prompts to look at (`ai.top_prompts`): the prompts named most or least, by the equal weight average of the engines
 * that show a rate, or the ones whose rate moved most against the previous window. A prompt with no rate (or no change)
 * is counted in the footnote and never ranked as 0. A change is over the engines with a rate in both windows, so the
 * same engines stand on both sides, and it is coloured only when larger than normal variation.
 */
export default function TopPromptsCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.topPrompts');
  const common = useTranslations('aiOverview.topics.common');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { workspaceSlug, project, setScope } = useOverview();
  const show = enumOf(options.show ?? '', SHOWS, 'least_named');
  const count = countOf(options.rows ?? '', DEFAULT_ROWS);
  const changing = show === 'largest_change';
  const { data, compareOff } = gateComparison(useTopicPeriods({ subscribed: live }), changing);
  const { engines, scope } = data;
  const codes = engines.map((engine) => engine.code);
  const labels = engines.map((engine) => engine.label);
  const nameOf = (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code;
  const model = topPromptsModel(
    { prompts: data.prompts, previousPrompts: data.previousPrompts, codes },
    { show, rows: count },
  );

  const context: LinkContext = { workspaceSlug, projectSlug: project.slug, scope };
  // A link carries the engine filter of the scope, and the Prompts page cannot show an engine that is off
  const holdsOffEngine =
    scope.engines !== null && scope.engines.some((code) => !engines.some((engine) => engine.code === code));
  const openPrompts: Route = promptsTabHref(context) ?? projectPath(workspaceSlug, project.slug, '/ai/prompts');
  const open = (
    <LinkButton variant="secondary" size="sm" render={<Link href={openPrompts} />}>
      {common('openTopics')}
    </LinkButton>
  );

  const engineText = (value: EngineValue): string =>
    value.successes === null
      ? t('engineAnswers', { engine: nameOf(value.code), answers: value.answers })
      : t('engineCounted', { engine: nameOf(value.code), successes: value.successes, answers: value.answers });
  const sideText = (side: RateChange['now']): string => {
    const percent = words.percent(side.value);
    return side.successes === null
      ? t('sideAnswers', { percent, answers: side.answers })
      : t('sideCounted', { percent, successes: side.successes, answers: side.answers });
  };
  const noteOf = (codesTaking: readonly string[], whole: 'averageNote' | 'changeNote'): string => {
    const names = formatList(codesTaking.map(nameOf));
    return codesTaking.length === 1 ? t('only', { engines: names }) : t(whole, { engines: names });
  };
  const verdictOf = (change: RateChange): string =>
    change.detectable === true
      ? t('verdict.detectable')
      : change.detectable === false
        ? t('verdict.within')
        : t('verdict.untested');

  const shownOf = (rank: PromptRank): Shown => {
    const label = rank.prompt.text;
    const href = holdsOffEngine ? undefined : (promptHref(context, rank.id) ?? undefined);
    const { change } = rank;
    // Only the largest change view gives a prompt a change: the named views leave it `null`
    if (change !== null) {
      const input = { ...deltaInput(change), unit: 'points' as const };
      const changeText = formatMetricDelta(input).text;
      const verdict = verdictOf(change);
      const tip = t('changeTip', {
        before: sideText(change.before),
        now: sideText(change.now),
        note: noteOf(rank.took, 'changeNote'),
      });
      return {
        row: {
          id: rank.id,
          label,
          own: false,
          value: {
            kind: 'value',
            value: change.now.value,
            valueText: words.percent(change.now.value),
            contextText: t('context', { count: change.engines }),
          },
          accessibleText: t('accessibleChange', { label, change: changeText, verdict, tip }),
          tip,
          delta: { input, test: 'interim', text: changeText },
          href,
        },
        table: {
          id: rank.id,
          prompt: label,
          value: sideText(change.now),
          change: t('changeCell', { change: changeText, verdict }),
        },
      };
    }
    const taking = rank.values.filter((value) => value.state === 'ok');
    const percent = words.percent(rank.average.value);
    const tip = t('named', {
      percent,
      counts: formatList(taking.map(engineText)),
      note: noteOf(
        taking.map((value) => value.code),
        'averageNote',
      ),
    });
    return {
      row: {
        id: rank.id,
        label,
        own: false,
        value: {
          kind: 'value',
          value: rank.average.value ?? 0,
          valueText: percent,
          contextText: t('context', { count: rank.average.engines }),
        },
        accessibleText: t('accessible', { label, detail: tip }),
        tip,
        href,
      },
      table: { id: rank.id, prompt: label, value: tip, change: '' },
    };
  };
  const shown = model.listed.map(shownOf);

  const answeredAny = model.answered;
  const empty = ((): TopicEmpty | null => {
    if (data.prompts.length === 0) {
      return scope.topic !== null
        ? empties.noTopics
        : { title: t('noPromptsTitle'), reason: t('noPromptsReason'), action: open };
    }
    if (changing && compareOff) {
      return {
        title: t('compareOffTitle'),
        reason: t('compareOffReason'),
        action: (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setScope({ compare: true });
            }}
          >
            {t('compareOn')}
          </Button>
        ),
      };
    }
    if (!answeredAny) return empties.noAnswers(labels, scope.range.days);
    if (model.ranked.length === 0) {
      return changing
        ? { title: t('noChangeTitle'), reason: t('noChangeReason'), action: open }
        : { title: t('noRateTitle'), reason: t('noRateReason', { min: MIN_OBSERVATIONS }), action: open };
    }
    return null;
  })();

  const caption = t('listCaption', { show });
  const headers = { prompt: t('labelHeader'), value: t('valueHeader'), change: t('changeHeader') };
  const columns: PlainColumn<TableRow>[] = [
    { id: 'prompt', header: headers.prompt, wrap: true, cell: (row) => row.prompt },
    { id: 'value', header: headers.value, wrap: true, cell: (row) => row.value },
    ...(changing ? [{ id: 'change', header: headers.change, wrap: true, cell: (row: TableRow) => row.change }] : []),
  ];
  const tableRows = shown.map(({ table }) => table);
  const csv: CsvTable = {
    header: [headers.prompt, headers.value, ...(changing ? [headers.change] : [])].map(safeText),
    rows: tableRows.map((row): CsvCell[] => [
      safeText(row.prompt),
      safeText(row.value),
      ...(changing ? [safeText(row.change)] : []),
    ]),
  };

  return (
    <TopicCardFrame
      cardKey="ai.top_prompts"
      title={t('title')}
      meta={words.window(scope.range)}
      summary={t('summary', { show, engines: formatList(labels) })}
      data={data}
      empty={empty}
      partialEngines={answeredAny ? model.unanswered.map(nameOf) : []}
      footnote={
        <div>
          <span>{common('smallSample', { min: MIN_OBSERVATIONS })}</span>{' '}
          <span>{changing ? t('footnoteChange', { test: common('compareTest') }) : t('footnoteNamed')}</span>{' '}
          {changing ? <span>{common('compareTestNote')}</span> : null}{' '}
          {model.left.length === 0 ? null : (
            <span>{t(changing ? 'notCompared' : 'tooFew', { count: model.left.length })}</span>
          )}
        </div>
      }
      menu={{ fileName: topPromptsFileName(show), csv }}
      exportBlock={{ id: item.id, build: () => ({ id: item.id, ...topPromptsExport(model, show) }) }}
      body={
        <BarList
          mode="comparison"
          caption={caption}
          labelHeader={headers.prompt}
          valueHeader={headers.value}
          contextHeader={t('contextHeader')}
          rows={shown.map(({ row }) => row)}
          max={1}
          limit={count}
          density="compact"
        />
      }
      table={
        <PlainTable<TableRow>
          caption={caption}
          columns={columns}
          rows={tableRows}
          rowKey={(row) => row.id}
          status="ready"
          errorState={null}
          emptyText={EMPTY_VALUE}
        />
      }
    />
  );
}
