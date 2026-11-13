'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useChangeWords, useComparedWindow, useCompare } from '../compare';
import type { PromptRow } from '../prompt-columns';
import { CELL_OF_METRIC } from '../prompt-model';
import type { PromptColumnEntry } from '../seams/columns';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { DeltaCell } from '@/components/app/metric/delta-cell';
import { Tooltip } from '@/components/ui/tooltip';
import type { EngineSummary } from '@/lib/api/types';
import { deltaInput, engineChangeOf } from '@/lib/compare/change-model';
import { formatDateRange } from '@/lib/format';
import type { CellMetric } from '@/lib/rates/rate-model';

/**
 * The change columns of the Prompts tab (WB-PRM-12): one per engine shown, "ChatGPT change", of the metric the page
 * shows (Mention, Citation or Share of voice), hidden until the column chooser asks for it. Each cell is the change
 * in points of that engine's own cell since the compared window, as a `DeltaCell` of the interim test: coloured by
 * its test and nothing else, n/a where there is no change to tell, never 0. Engines are never pooled here.
 */

/** The engine cells of a row: none in counts that have not loaded, `[]` for a prompt that has no answers. */
const cellsOf = (row: PromptRow): readonly EngineSummary[] | undefined =>
  row.summary?.engines ?? (row.countsLoaded ? [] : undefined);

interface EngineChangeProps {
  cells: readonly EngineSummary[] | undefined;
  code: string;
  metric: CellMetric;
}

/**
 * One cell. It reads the page's comparison and window itself (the seam hands a column no hook), so it hides the
 * change at once when comparison goes off, and says why a cell has none only for a response that was compared.
 */
function EngineChange({ cells, code, metric }: EngineChangeProps): ReactElement {
  const t = useTranslations('prompts.compare');
  const columns = useTranslations('prompts.columns');
  const words = useChangeWords();
  const { compare } = useCompare();
  const comparedWindow = useComparedWindow();
  const change = compare ? engineChangeOf(cells, code, metric) : null;

  const gap = (): string => {
    // The counts, or the read that was compared, have not arrived: there is nothing to say yet
    if (cells === undefined || comparedWindow === null) return '';
    const engine = cells.find((cell) => cell.engine_code === code);
    if (engine === undefined) return columns('noAnswersTip');
    return words.gap(engine.previous == null ? 'noPrevious' : 'tooFew');
  };
  const range = comparedWindow === null ? null : formatDateRange(comparedWindow.from, comparedWindow.to);
  const text = !compare
    ? t('change.off')
    : change === null
      ? gap()
      : words.tip(change, { kind: 'engine', range, metric });

  return (
    <Tooltip content={text} disabled={text === ''}>
      <span
        // A cell with a tooltip is a tab stop that opens it (20 section 6.2 rule 6); the lint rule cannot see why
        {...(text === '' ? {} : { tabIndex: 0 })}
        className="block rounded-xs outline-none focus-visible:focus-ring-inset"
      >
        <DeltaCell input={deltaInput(change)} test="interim" tip={false} />
      </span>
    </Tooltip>
  );
}

export const compareColumns: PromptColumnEntry = {
  id: 'compare',
  build: ({ engines, metric, t }): readonly DataTableColumn<PromptRow>[] => {
    const cellMetric = CELL_OF_METRIC[metric];
    return engines.map((engine) => {
      const code = engine.engine.engine_code;
      const base = col.volumeTrend<PromptRow>(
        `change_${code}`,
        // The sort value is the points: a change that cannot be told is null, which sorts last in both directions
        (row) => engineChangeOf(cellsOf(row), code, cellMetric)?.points ?? null,
        {
          header: t('prompts.compare.change.engineHeader', { engine: engine.engine.label }),
          headerTooltip: t('prompts.compare.change.engineHeaderTip', { metric: t(`prompts.metric.${metric}`) }),
          defaultVisible: false,
          // The cell is drawn below: it has the states a count column does not
          known: () => null,
        },
      );
      return {
        ...base,
        cell: (row) => <EngineChange cells={cellsOf(row)} code={code} metric={cellMetric} />,
      };
    });
  },
};
