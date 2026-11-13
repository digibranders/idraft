'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { agreementOf } from './agreement-model';
import { useCardMeta } from './card-meta';
import type { CardPhase } from './card-phase';
import { engineLabel } from './engine-role';
import { useCardData } from './use-card-data';
import { useCardDensity } from './use-card-density';
import { useCardExport } from './use-card-seams';
import { useFrameState } from './use-frame-state';
import type { ExportBlock } from '../../export/export-model';
import { BarList, type DistributionRow } from '@/components/app/chart/bar-list';
import { ChartFrame, type ChartEmpty } from '@/components/app/chart/chart-frame';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { LinkButton } from '@/components/ui/link-button';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';
import { EMPTY_VALUE, formatList } from '@/lib/format';
import { projectPath } from '@/lib/routes/paths';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** One line of the card, for the bars, the Table view, the file and the export: one set of words and numbers. */
interface Line extends DistributionRow {
  /** The engines that name the prompts of the line; `null` for the prompts that were left out. */
  named: number | null;
  count: number;
  /** The prompts the count is of: the compared ones, or every prompt in scope for the left out line. */
  of: number;
  valueText: string;
  contextText: string;
  status: 'ok' | 'left_out';
}

const FILE_NAME = 'engine-agreement';
const EXPORT_HEADER = ['measure', 'engines_naming', 'of_engines', 'prompts', 'of_prompts', 'status'] as const;
const SAMPLE = { min: MIN_OBSERVATIONS } as const;

/** Engine agreement (CH-18): how many of the asked engines name the brand on the same prompt. */
export default function EngineAgreementCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.agreement');
  const common = useTranslations('aiOverview.engines.common');
  const density = useCardDensity();
  const data = useCardData({ previous: 'none', subscribed: live });
  const metaOf = useCardMeta();
  const { scope, asked, workspaceSlug, project } = data;
  const title = t('title');

  const prompts = data.current.data?.prompts;
  const model = useMemo(() => agreementOf({ prompts: prompts ?? [], asked }), [prompts, asked]);
  // The model judges the engines and the prompts; the read only says whether an answer is still on its way
  const phase: CardPhase =
    data.phase === 'loading' || data.phase === 'error'
      ? data.phase
      : model.kind === 'ok'
        ? data.phase === 'refetching'
          ? 'refetching'
          : 'ready'
        : 'empty';

  // The settings help only when the project itself has fewer than 2 engines on; a narrow filter is fixed on the page
  const needsEngines = data.engines.enabled.length < 2;
  const empty = ((): ChartEmpty | null => {
    switch (model.kind) {
      case 'tooFewEngines':
        return {
          title: t('emptyTooFewTitle'),
          reason: needsEngines && !data.canManageEngines ? common('askAdmin') : t('emptyTooFewReason'),
          action:
            needsEngines && data.canManageEngines ? (
              <LinkButton
                size="sm"
                render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}
              >
                {common('toEngines')}
              </LinkButton>
            ) : undefined,
        };
      case 'noPrompts':
        return { title: t('emptyNoPromptsTitle'), reason: t('emptyNoPromptsReason') };
      case 'nothingComparable':
        return {
          title: t('emptyNoneTitle'),
          reason: t('emptyNoneReason', { count: model.leftOut, ...SAMPLE }),
        };
      case 'ok':
        return null;
    }
  })();
  const frame = useFrameState({ ...data, phase }, { name: title, empty });

  const lines = useMemo((): Line[] => {
    if (model.kind !== 'ok') return [];
    const steps = model.steps.map((step): Line => {
      const label = t('named', { named: step.named, total: model.engines });
      const valueText = t('prompts', { count: step.prompts });
      const contextText = t('of', { total: model.compared });
      return {
        id: `named-${String(step.named)}`,
        label,
        scale: step.scale,
        named: step.named,
        count: step.prompts,
        of: model.compared,
        status: 'ok',
        valueText,
        contextText,
        value: { kind: 'value', value: step.prompts, valueText, contextText },
        accessibleText: t('accessible', { label, count: step.prompts, total: model.compared }),
      };
    });
    if (model.leftOut === 0) return steps;
    // Words with no bar: the count is outside the compared prompts the bars are scaled to
    const label = t('leftOutLabel');
    const text = t('leftOutText', { count: model.leftOut, total: model.compared });
    return [
      ...steps,
      {
        id: 'left-out',
        label,
        scale: 'chart-other',
        named: null,
        count: model.leftOut,
        of: model.prompts,
        status: 'left_out',
        valueText: t('prompts', { count: model.leftOut }),
        contextText: t('leftOutContext', { total: model.compared }),
        value: { kind: 'none', text },
        accessibleText: t('accessibleText', { label, text }),
      },
    ];
  }, [model, t]);

  const columns: PlainColumn<Line>[] = [
    { id: 'step', header: t('stepHeader'), cell: (line) => line.label },
    { id: 'prompts', header: t('valueHeader'), cell: (line) => line.valueText },
    { id: 'of', header: t('contextHeader'), cell: (line) => line.contextText },
  ];

  const intro = t('summaryIntro', {
    engines: formatList(asked.map((code) => engineLabel(code) ?? common('unknownEngine'))),
  });
  const summary =
    model.kind === 'ok'
      ? [
          intro,
          ...model.steps.map((step) =>
            t('summaryStep', {
              label: t('named', { named: step.named, total: model.engines }),
              count: step.prompts,
              total: model.compared,
            }),
          ),
          ...(model.leftOut === 0 ? [] : [t('summaryLeftOut', { count: model.leftOut })]),
        ].join(' ')
      : intro;

  useCardExport(item.id, (): ExportBlock | null => {
    if (model.kind !== 'ok') return null;
    return {
      id: item.id,
      header: EXPORT_HEADER,
      rows: lines.map((line): CsvCell[] => [line.label, line.named, model.engines, line.count, line.of, line.status]),
    };
  });

  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      meta={metaOf({
        range: scope.range,
        prompts: data.aggregates?.promptCount ?? null,
        answers: null,
        branded: scope.branded,
      })}
      footnote={t('footnote', SAMPLE)}
      height={180}
      summary={summary}
      menu={{
        fileName: FILE_NAME,
        csv: {
          header: columns.map((column) => safeText(column.header)),
          rows: lines.map((line) => [line.label, line.valueText, line.contextText].map(safeText)),
        },
      }}
      body={
        model.kind === 'ok' ? (
          <BarList
            mode="distribution"
            caption={t('caption')}
            labelHeader={t('stepHeader')}
            valueHeader={t('valueHeader')}
            contextHeader={t('contextHeader')}
            rows={lines}
            max={model.compared}
            density={density}
          />
        ) : null
      }
      table={
        <PlainTable<Line>
          caption={t('caption')}
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
