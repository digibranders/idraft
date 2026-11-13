'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useAnswersFrame } from './answers-frame';
import { useCardMeta } from './card-meta';
import { engineLabel } from './engine-role';
import { funnelOf, funnelScale, type EngineFunnel, type FunnelStep, type FunnelStepId } from './funnel-model';
import { percentNumber } from './outcome-model';
import { useCardData } from './use-card-data';
import { useCardDensity } from './use-card-density';
import { useCardExport } from './use-card-seams';
import type { ExportBlock } from '../../export/export-model';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import {
  StepBars,
  StepBarsTable,
  stepBarsCsv,
  type Step,
  type StepBarsProps,
  type StepGroup,
  type StepShare,
} from '@/components/app/chart/step-bars';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import type { CardProps } from '@/features/layouts';
import type { CsvCell } from '@/lib/csv/csv-write';
import { formatInteger, formatPercent, formatSampleCount } from '@/lib/format';

const STEP_WORDS = {
  answers: 'stepAnswers',
  valid: 'stepValid',
  named: 'stepNamed',
  cited: 'stepCited',
} as const satisfies Record<FunnelStepId, string>;

const FILE_NAME = 'answer-funnel-by-engine';
const EXPORT_HEADER = ['engine', 'step', 'count', 'of', 'share_percent', 'status'] as const;

/** CH-36: where the answers of each engine drop out between collection and a citation of the site. */
export default function AnswerFunnelCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.funnel');
  const common = useTranslations('aiOverview.engines.common');
  const chart = useTranslations('chart');
  const insufficient = useTranslations('common.insufficient');
  const density = useCardDensity();
  const data = useCardData({ previous: 'none', subscribed: live });
  const metaOf = useCardMeta();
  const title = t('title');
  const frame = useAnswersFrame(data, title, (key, values) => t(key, values));

  const prompts = data.current.data?.prompts;
  const funnels = useMemo(() => (prompts === undefined ? [] : funnelOf(prompts, data.asked)), [prompts, data.asked]);
  const engineName = (code: string): string => engineLabel(code) ?? common('unknownEngine');

  /** The words of a step's share of the step before; `null` where there is none to say. */
  const shareOf = (funnel: EngineFunnel, step: FunnelStep): StepShare => {
    if (step.id === 'answers' || step.count === null || step.of === null) return null;
    if (step.thin) return { kind: 'thin', answers: step.of };
    const percent = formatPercent(step.share);
    const counts = formatSampleCount(step.count, step.of);
    if (step.id === 'valid') {
      return {
        kind: 'share',
        text:
          funnel.notValid > 0
            ? t('shareValidLoss', { percent, counts, lost: funnel.notValid })
            : t('shareValid', { percent, counts }),
      };
    }
    return { kind: 'share', text: t(step.id === 'named' ? 'shareNamed' : 'shareCited', { percent, counts }) };
  };

  const stepOf = (funnel: EngineFunnel, step: FunnelStep): Step => {
    const label = t(STEP_WORDS[step.id]);
    const share = shareOf(funnel, step);
    const known = step.count !== null;
    // No answer at all and no valid answer to count in are two different reasons
    const noneText = funnel.steps[0]?.count === null ? t('noAnswers') : t('noValid');
    const countText = step.count === null ? null : formatInteger(step.count);
    const shareWords =
      share === null ? null : share.kind === 'thin' ? insufficient('answers', { count: share.answers }) : share.text;
    return {
      id: step.id,
      label,
      count: step.count,
      countText,
      share,
      own: step.id === 'named' || step.id === 'cited',
      ...(known ? {} : { noneText }),
      accessibleText:
        shareWords === null
          ? t('stepTextFirst', { label, count: countText ?? noneText })
          : t('stepText', { label, count: countText ?? noneText, share: shareWords }),
    };
  };

  const groups: StepGroup[] = funnels.map((funnel) => ({
    id: funnel.engineCode,
    label: engineName(funnel.engineCode),
    // The mark alone: the label carries the name
    icon: <EngineLogo engine={funnel.engineCode} name="" />,
    steps: funnel.steps.map((step) => stepOf(funnel, step)),
  }));
  const bars: StepBarsProps = {
    caption: t('caption'),
    groups,
    scaleMax: funnelScale(funnels),
    groupHeader: t('groupHeader'),
    density,
  };

  const summary = [
    t('summaryIntro'),
    ...funnels.map((funnel) => {
      const engine = engineName(funnel.engineCode);
      const [answers, valid, named, cited] = funnel.steps.map((step) => step.count);
      if (answers === null || answers === undefined) return t('summaryNone', { engine });
      if (!valid) return t('summaryNoValid', { engine, answers });
      return t('summaryEngine', { engine, answers, valid, named: named ?? 0, cited: cited ?? 0 });
    }),
  ].join(' ');

  useCardExport(item.id, (): ExportBlock | null => {
    if (prompts === undefined) return null;
    const rows = funnels.flatMap((funnel) =>
      funnel.steps.map((step): CsvCell[] => [
        engineName(funnel.engineCode),
        t(STEP_WORDS[step.id]),
        step.count,
        step.of,
        step.share === null ? null : percentNumber(step.share),
        step.count === null ? 'none' : step.thin ? 'insufficient' : 'ok',
      ]),
    );
    return { id: item.id, header: EXPORT_HEADER, rows };
  });

  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      meta={metaOf({
        range: data.scope.range,
        prompts: data.aggregates?.promptCount ?? null,
        answers: null,
        branded: data.scope.branded,
      })}
      footnote={t('footnote')}
      height={180}
      summary={summary}
      menu={{
        fileName: FILE_NAME,
        csv: stepBarsCsv(bars, {
          thin: (answers) => insufficient('answers', { count: answers }),
          step: chart('stepBars.step'),
          count: chart('stepBars.count'),
          share: chart('stepBars.share'),
        }),
      }}
      body={<StepBars {...bars} />}
      table={<StepBarsTable {...bars} />}
      {...frame}
    />
  );
}
