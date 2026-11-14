'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ChangeInline, useChangeWords, useComparedWindow, useCompare } from './compare';
import type { PromptCounts } from './inspector-reads';
import { useRateWords } from './rate-view';
import { MetricStrip, type MetricStripGroup, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import type { ProjectEngine } from '@/lib/api/types';
import { engineChangeOf } from '@/lib/compare/change-model';
import { formatDateRange } from '@/lib/format';
import { averageRate, cellFigure } from '@/lib/rates/rate-model';

export interface InspectorStripProps {
  /** The enabled engines, in order. */
  engines: readonly ProjectEngine[];
  counts: PromptCounts;
  /** Why the summary has no row for the prompt, when it has none. */
  noCountsReason: string;
}

/**
 * The strip above the prompt inspector's tabs (parity spec G92): the Mention rate of each enabled engine with the
 * valid answers behind it, and one Citation rate, the equal weight average of the engines that show a rate. A rate
 * over fewer than `MIN_OBSERVATIONS` valid answers shows the answers there are instead (decision D-1). While
 * comparison is on, each engine's item shows how its rate moved since the previous period (WB-PI-11), with the previous
 * value, the window and the verdict in its tooltip; the Citation average has no change (WP-19 decision D14).
 */
export function InspectorStrip({ engines, counts, noCountsReason }: InspectorStripProps): ReactElement {
  const t = useTranslations('prompts.inspector');
  const columns = useTranslations('prompts.columns');
  const rate = useTranslations('prompts.rate');
  const common = useTranslations('common');
  const words = useRateWords();
  const changeWords = useChangeWords();
  const { compare } = useCompare();
  const compared = useComparedWindow();
  const range = compared === null ? null : formatDateRange(compared.from, compared.to);

  if (counts.status === 'failed') {
    return (
      <InlineError
        title={t('countsFailed')}
        reason={t('loadFailedReason')}
        errorId={counts.errorId}
        onRetry={counts.retry}
        retrying={counts.retrying}
        retryLabel={common('retry')}
      />
    );
  }
  const row = counts.row;
  if (counts.status === 'ready' && row === undefined) {
    return <EmptyState variant="inline" title={t('noCounts')} reason={noCountsReason} headingLevel={3} />;
  }
  const items: MetricStripItem[] = engines.map((engine) => {
    const code = engine.engine.engine_code;
    const figure = cellFigure(
      row?.engines.find((cell) => cell.engine_code === code),
      'mentioned',
    );
    // While the counts are read again the cells are the held ones: no change is drawn until this window has answered
    const change = compare && counts.status === 'ready' ? engineChangeOf(row?.engines, code, 'mentioned') : null;
    return {
      id: code,
      label: columns('engineMention', { engine: engine.engine.label }),
      value: words.text(figure),
      unknown:
        figure.state === 'ok' ? null : { kind: figure.state === 'insufficient' ? 'insufficient' : 'not-applicable' },
      context: words.basis(figure) ?? words.reason(figure),
      delta: change === null ? undefined : <ChangeInline change={change} />,
      // The item with a tip is the tab stop that holds it: the previous value with its answers, the window, the verdict
      tip: change === null ? undefined : changeWords.tip(change, { kind: 'engine', range }),
    };
  });
  const citation = averageRate(
    engines.map((engine) => row?.engines.find((cell) => cell.engine_code === engine.engine.engine_code)?.cited),
  );
  items.push({
    id: 'citation',
    label: columns('citationRate'),
    value: words.text(citation),
    unknown:
      citation.state === 'ok' ? null : { kind: citation.state === 'insufficient' ? 'insufficient' : 'not-applicable' },
    context:
      citation.state === 'ok'
        ? rate('avgLabel', { count: citation.engines })
        : (words.basis(citation) ?? words.reason(citation)),
  });
  const groups: readonly MetricStripGroup[] = [{ id: 'rates', items }];
  return (
    <MetricStrip
      size="sm"
      label={t('stripLabel')}
      groups={groups}
      status={counts.status === 'loading' ? 'loading' : 'ready'}
    />
  );
}
