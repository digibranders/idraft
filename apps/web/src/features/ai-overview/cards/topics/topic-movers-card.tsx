'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useOverview } from '../../overview-context';
import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import { gateComparison } from './compare-gate';
import { engineValue } from './engine-values';
import { topicDrawerHref, topicsTabHref } from './links';
import { CELL_OF, type TopicNode } from './model-types';
import {
  changePointsOf,
  MOVERS_EXPORT_HEADER,
  moversFileName,
  moversModel,
  readingOf,
  type Direction,
  type MoverRow,
} from './movers-model';
import { enumOf, metricOf, countOf } from './options';
import { TopicFootnote } from './topic-footnote';
import { leavesOf, overlapCount } from './topic-nodes';
import { exportCells } from './topic-rows';
import { useTopicPeriods } from './use-topic-reads';
import { useTopicWords } from './use-topic-words';
import {
  changeDomain,
  IntervalBar,
  IntervalBarTable,
  intervalBarCsv,
  type ChangeInterval,
  type DivergingRow,
  type IntervalBarProps,
} from '@/components/app/chart/interval-bar';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import type { CardProps } from '@/features/layouts';
import { deltaInput, type RateChange } from '@/lib/compare/change-model';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';
import { formatList, formatMetricDelta, formatPointsDelta } from '@/lib/format';
import { projectPath } from '@/lib/routes/paths';

const DIRECTIONS: readonly Direction[] = ['both', 'up', 'down'];

/** Topics gaining or losing against the previous window, by engine (CH-42, `ai.topic_movers`). */
export default function TopicMoversCard({ item, options }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.movers');
  const common = useTranslations('aiOverview.topics.common');
  const chart = useTranslations('chart');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { workspaceSlug, project, setScope } = useOverview();
  const { data, compareOff } = gateComparison(useTopicPeriods(), true);
  const metric = metricOf(options.metric ?? '');
  const cellMetric = CELL_OF[metric];
  const direction = enumOf(options.direction ?? '', DIRECTIONS, 'both');
  const count = countOf(options.rows ?? '', 5);
  const { engines, scope } = data;
  const codes = engines.map((engine) => engine.code);
  const labels = engines.map((engine) => engine.label);
  const nameOf = (code: string): string => engines.find((engine) => engine.code === code)?.label ?? code;
  const context = { workspaceSlug, projectSlug: project.slug, scope };

  const model = moversModel(data.nodes, data.previousNodes, codes, cellMetric, direction, count);
  const hasAnswers = (nodes: Iterable<TopicNode>): boolean =>
    [...nodes].some((node) => codes.some((code) => engineValue(node.engines, code, cellMetric).answers > 0));
  const leaves = leavesOf(data.nodes);
  const silent = engines.filter((engine) =>
    leaves.every((node) => engineValue(node.engines, engine.code, cellMetric).state !== 'ok'),
  );

  const topicsHref: Route =
    topicsTabHref(context, { view: 'heatmap', metric }) ?? projectPath(workspaceSlug, project.slug, '/ai/prompts');
  const openTopics = (
    <LinkButton variant="secondary" size="sm" render={<Link href={topicsHref} />}>
      {common('openTopics')}
    </LinkButton>
  );
  const empty = ((): TopicEmpty | null => {
    if (leaves.length === 0) return empties.noTopics;
    if (compareOff) {
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
    if (!hasAnswers(leaves)) return empties.noAnswers(labels, scope.range.days);
    if (!hasAnswers(data.previousNodes?.values() ?? [])) {
      return {
        title: t('noPreviousTitle', { days: scope.range.days }),
        reason: t('noPreviousReason'),
        action: openTopics,
      };
    }
    if (model.listed.length === 0 && model.quiet === 0) {
      return { title: t('noneTitle'), reason: t('noneReason'), action: openTopics };
    }
    return null;
  })();

  const sideText = (side: RateChange['now']): string => {
    const percent = words.percent(side.value);
    return side.successes === null
      ? t('sideShare', { percent, n: side.answers })
      : t('sideCounted', { percent, k: side.successes, n: side.answers });
  };
  const rowOf = (row: MoverRow): DivergingRow => {
    const label = t('row', { topic: row.node.name, engine: nameOf(row.code) });
    const change = { ...deltaInput(row.change), unit: 'points' as const };
    const changeText = formatMetricDelta(change).text;
    const promptsText =
      row.prompts === null
        ? null
        : row.prompts.both === row.prompts.now
          ? t('samePrompts', { count: row.prompts.now })
          : t('somePrompts', { both: row.prompts.both, now: row.prompts.now });
    const verdict = row.change.detectable === true ? t('verdict.detectable') : t('verdict.untested');
    const { interval } = row;
    const intervalText =
      interval === null
        ? null
        : t('interval', { low: formatPointsDelta(interval.low), high: formatPointsDelta(interval.high) });
    const detail = [
      intervalText === null ? null : t('intervalWords', { interval: intervalText }),
      verdict,
      promptsText,
    ].filter((part): part is string => part !== null);
    return {
      id: row.id,
      label,
      accessibleText: t('accessible', { label, change: changeText, detail: formatList(detail) }),
      tip: formatList(
        [t('tip', { before: sideText(row.change.before), now: sideText(row.change.now) }), promptsText].filter(
          (part): part is string => part !== null,
        ),
      ),
      href: topicDrawerHref(context, row.node.key) ?? undefined,
      value:
        interval === null || intervalText === null
          ? { kind: 'none', text: t('noInterval', { change: changeText }) }
          : {
              kind: 'compare',
              interval: { estimate: row.change.points, low: interval.low, high: interval.high },
              change,
              test: 'interim',
              changeText,
              intervalText,
            },
    };
  };
  const rows = model.listed.map(rowOf);
  const intervals: ChangeInterval[] = model.listed.flatMap((row) =>
    row.interval === null ? [] : [{ estimate: row.change.points, low: row.interval.low, high: row.interval.high }],
  );
  const metricLabel = words.metricLabel(metric);
  const barProps: IntervalBarProps = {
    form: 'diverging',
    caption: t('listCaption', { metric: metricLabel }),
    labelHeader: t('labelHeader'),
    rows,
    domain: changeDomain(intervals),
  };
  const csv = intervalBarCsv(barProps, {
    change: chart('intervalBar.change'),
    interval: chart('intervalBar.interval'),
    previous: chart('intervalBar.previous'),
    current: chart('intervalBar.current'),
    thin: chart('intervalBar.thin'),
    noValue: chart('noValue'),
  });

  return (
    <TopicCardFrame
      cardKey="ai.topic_movers"
      title={t('title')}
      meta={words.window(scope.range)}
      summary={t('summary', { metric: metricLabel, engines: formatList(labels) })}
      data={data}
      empty={empty}
      partialEngines={silent.map((engine) => engine.label)}
      footnote={
        <TopicFootnote
          overlapPrompts={data.promptsRead ? overlapCount(data.prompts, data.nodes) : null}
          pooled={false}
          weighting="prompt"
          compareTest
          extra={<span>{t('scope', { test: common('compareTest') })}</span>}
        />
      }
      menu={{ fileName: moversFileName(metric), csv }}
      exportBlock={{
        id: item.id,
        build: () => ({
          id: item.id,
          header: MOVERS_EXPORT_HEADER,
          rows: model.all.map((pair): CsvCell[] => [
            safeText(pair.node.name),
            pair.code,
            ...exportCells(engineValue(pair.node.engines, pair.code, cellMetric)),
            ...exportCells(engineValue(pair.before?.engines, pair.code, cellMetric)),
            changePointsOf(pair.change),
            readingOf(pair),
          ]),
        }),
      }}
      body={
        <div className="flex flex-col gap-3">
          {rows.length > 0 ? <IntervalBar {...barProps} /> : null}
          {model.hidden > 0 ? <p className="type-meta">{t('hidden', { count: model.hidden })}</p> : null}
          {model.quiet > 0 ? <p className="type-meta">{t('quiet', { count: model.quiet })}</p> : null}
          {model.incomparable > 0 ? (
            <p className="type-meta">{t('incomparable', { count: model.incomparable })}</p>
          ) : null}
        </div>
      }
      table={<IntervalBarTable {...barProps} />}
    />
  );
}
