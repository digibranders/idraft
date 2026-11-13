'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { useOverview } from '../../overview-context';
import { TopicCardFrame, useTopicEmpty, type TopicEmpty } from './card-frame';
import { gateComparison } from './compare-gate';
import {
  changeModel,
  CONTRIBUTION_EXPORT_HEADER,
  contributionFileName,
  formatPoints,
  levelModel,
  type ChangeModel,
  type ContributionBar,
  type LevelModel,
} from './contribution-model';
import { topicDrawerHref } from './links';
import { engineOf, enumOf } from './options';
import { TopicFootnote } from './topic-footnote';
import { NO_TOPIC } from './topic-nodes';
import { useTopicPeriods } from './use-topic-reads';
import { useTopicWords } from './use-topic-words';
import {
  BarList,
  BarListTable,
  barListCsv,
  type BarListProps,
  type ComparisonRow,
} from '@/components/app/chart/bar-list';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';
import { ENGINES } from '@/lib/layouts/catalog';
import { projectPath } from '@/lib/routes/paths';
import { MIN_OBSERVATIONS } from '@/lib/stats';

const VIEWS = ['level', 'change'] as const;

/** What each top level topic adds to the mention rate of one engine, or to its change (CH-46, `ai.topic_contribution`). */
export default function TopicContributionCard({ item, options }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.topics.contribution');
  const common = useTranslations('aiOverview.topics.common');
  const words = useTopicWords();
  const empties = useTopicEmpty();
  const { workspaceSlug, project, setScope, enabledEngines, canManageEngines } = useOverview();
  const view = enumOf(options.view ?? '', VIEWS, 'level');
  const code = engineOf(options.engine ?? '');
  const { data, compareOff } = gateComparison(useTopicPeriods(), view === 'change');
  const { scope } = data;
  const asked = data.engines.some((engine) => engine.code === code);
  const engineLabel = ENGINES.find((engine) => engine.code === code)?.label ?? code;
  const context = { workspaceSlug, projectSlug: project.slug, scope };

  // The models read the prompt rows, which are of the paired windows only: the change view waits for the gate
  const level: LevelModel | null = asked ? levelModel(data.nodes, data.prompts, code) : null;
  const change: ChangeModel | null =
    asked && view === 'change' && data.compared
      ? changeModel(data.nodes, data.prompts, data.previousPrompts ?? [], code)
      : null;
  const bars: readonly ContributionBar[] = (view === 'change' ? change?.bars : level?.bars) ?? [];
  const signed = view === 'change';

  const topicsHref: Route = projectPath(workspaceSlug, project.slug, '/ai/prompts');
  const openTopics = (
    <LinkButton variant="secondary" size="sm" render={<Link href={topicsHref} />}>
      {common('openTopics')}
    </LinkButton>
  );
  const engineOut = (): TopicEmpty => {
    const title = t('engineOutTitle', { engine: engineLabel });
    if (scope.engines !== null && enabledEngines.some((enabled) => enabled === code)) {
      return {
        title,
        reason: t('engineOutFiltered', { engine: engineLabel }),
        action: (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setScope({ engines: null });
            }}
          >
            {common('useAllEngines')}
          </Button>
        ),
      };
    }
    if (!canManageEngines) return { title, reason: t('engineOutAdmin', { engine: engineLabel }), action: null };
    return {
      title,
      reason: t('engineOutOff', { engine: engineLabel }),
      action: (
        <LinkButton
          variant="secondary"
          size="sm"
          render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}
        >
          {common('turnOnEngines')}
        </LinkButton>
      ),
    };
  };
  const empty = ((): TopicEmpty | null => {
    if (data.phase === 'idle') return null;
    if (!asked) return engineOut();
    if (data.nodes.length === 0) return empties.noTopics;
    if (view === 'change' && compareOff) {
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
    if (level?.state === 'none') return empties.noAnswers([engineLabel], scope.range.days);
    if (change?.state === 'none') {
      return {
        title: t('noPreviousTitle', { days: scope.range.days }),
        reason: t('noPreviousReason'),
        action: openTopics,
      };
    }
    return null;
  })();

  const nameOf = (bar: ContributionBar): string => (bar.key === NO_TOPIC ? common('noTopic') : bar.node.name);
  const rate = words.percent(level?.headline.value ?? null);
  const rowOf = (bar: ContributionBar): ComparisonRow => {
    const topic = nameOf(bar);
    const href = topicDrawerHref(context, bar.key) ?? undefined;
    if (bar.points === null) {
      return {
        id: bar.key,
        label: topic,
        own: false,
        value: { kind: 'none' },
        accessibleText: t('accessibleNone', { topic, value: words.percent(null) }),
        href,
      };
    }
    const points = formatPoints(bar.points, signed);
    const contextText = t('context', { count: bar.prompts ?? 0 });
    const value = signed ? t('changeText', { points }) : t('levelText', { points, rate });
    return {
      id: bar.key,
      label: topic,
      own: false,
      // A bar is as long as the move is large: its sign is in the words
      value: { kind: 'value', value: Math.abs(bar.points), valueText: t('changeText', { points }), contextText },
      accessibleText: t('accessible', { topic, value, context: contextText }),
      href,
    };
  };
  const rows = bars.map(rowOf);
  const barProps: BarListProps = {
    mode: 'comparison',
    caption: signed ? t('changeCaption', { engine: engineLabel }) : t('listCaption', { engine: engineLabel }),
    labelHeader: t('labelHeader'),
    valueHeader: signed ? t('changeHeader') : t('valueHeader'),
    contextHeader: t('contextHeader'),
    rows,
  };

  const body = ((): ReactNode => {
    const basis = (model: ChangeModel): ReactNode => (
      <>
        <p className="type-meta">
          {t('changeBasis', {
            count: model.common,
            engine: engineLabel,
            points: formatPoints(model.headlinePoints ?? 0, true),
          })}
        </p>
        {model.remainderPoints === null || model.totalPoints === null ? null : (
          <p className="type-meta">
            {t('remainder', {
              points: formatPoints(model.remainderPoints, true),
              total: formatPoints(model.totalPoints, true),
            })}
          </p>
        )}
      </>
    );
    if (view === 'level' && level !== null) {
      if (level.state === 'insufficient') {
        return (
          <p className="type-body text-foreground-secondary">
            {t('insufficient', { engine: engineLabel, count: level.headline.answers, min: MIN_OBSERVATIONS })}
          </p>
        );
      }
      return <BarList {...barProps} />;
    }
    if (change === null) return null;
    if (change.state === 'insufficient') {
      return (
        <p className="type-body text-foreground-secondary">
          {t('insufficientChange', { engine: engineLabel, min: MIN_OBSERVATIONS })}
        </p>
      );
    }
    if (change.common === 0) {
      return <p className="type-body text-foreground-secondary">{t('noCommon', { engine: engineLabel })}</p>;
    }
    return (
      <div className="flex flex-col gap-3">
        <BarList {...barProps} />
        {basis(change)}
      </div>
    );
  })();

  const model = view === 'change' ? change : level;
  return (
    <TopicCardFrame
      cardKey="ai.topic_contribution"
      title={t('title')}
      meta={words.window(scope.range)}
      summary={signed ? t('summaryChange', { engine: engineLabel }) : t('summaryLevel', { engine: engineLabel })}
      data={data}
      empty={empty}
      partialEngines={[]}
      footnote={
        <TopicFootnote
          overlapPrompts={data.promptsRead && model !== null ? model.overlapping : null}
          pooled={false}
          weighting="prompt"
          extra={
            <>
              {view === 'level' && level?.state === 'ok' ? (
                <span>{t('sumNote', { sum: formatPoints(level.sumPoints, false), rate })}</span>
              ) : null}
              {view === 'change' && change?.state === 'ok' ? <span>{t('changeNote')}</span> : null}
            </>
          }
        />
      }
      menu={{
        fileName: contributionFileName(view, code),
        csv: barListCsv(barProps, (answers) => words.answers(answers)),
      }}
      exportBlock={{
        id: item.id,
        build: () => ({
          id: item.id,
          header: CONTRIBUTION_EXPORT_HEADER,
          rows: bars.map((bar): CsvCell[] => [
            safeText(nameOf(bar)),
            bar.prompts,
            bar.points === null ? null : Math.round(bar.points * 100) / 100,
          ]),
        }),
      }}
      body={body}
      table={<BarListTable {...barProps} />}
    />
  );
}
