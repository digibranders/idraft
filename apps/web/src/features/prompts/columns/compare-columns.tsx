import type { PromptRow } from '../prompt-columns';
import { CELL_OF_METRIC, cellsOfPrompt } from '../prompt-model';
import type { PromptColumnEntry } from '../seams/columns';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { DeltaValue, hasDeltaComparison } from '@/components/app/metric/delta';
import { deltaInput, engineChangeOf, type RateChange } from '@/lib/compare/change-model';
import { EMPTY_VALUE, formatDateRange } from '@/lib/format';

/**
 * The change columns of the Prompts tab (WB-PRM-12): one per engine shown, "ChatGPT change", of the metric the page
 * shows (Mention, Citation or Share of voice), hidden until the column chooser asks for it. Each cell is the change
 * in points of that engine's own cell since the compared window, the value of a `Delta` of the interim test: coloured
 * by its test and nothing else, n/a where there is no change to tell, never 0. Engines are never pooled here.
 *
 * The tip is the table's own cell tip (`cellTip`): the focused cell holds it through `aria-describedby`, so the cell
 * adds no tab stop of its own. The comparison, the window and the words come with the context, since a column of the
 * seam is built without a hook.
 */
export const compareColumns: PromptColumnEntry = {
  id: 'compare',
  build: ({ engines, metric, t, compare, comparedWindow, changeWords }): readonly DataTableColumn<PromptRow>[] => {
    const cellMetric = CELL_OF_METRIC[metric];
    const range = comparedWindow === null ? null : formatDateRange(comparedWindow.from, comparedWindow.to);
    return engines.map((engine) => {
      const code = engine.engine.engine_code;
      /** While comparison is off there is no change, whatever the held read still carries. */
      const changeOf = (row: PromptRow): RateChange | null =>
        compare ? engineChangeOf(cellsOfPrompt(row), code, cellMetric) : null;
      const tipOf = (row: PromptRow): CellTip | undefined => {
        if (!compare) return { content: t('prompts.compare.change.off') };
        const change = changeOf(row);
        if (change !== null) {
          return { content: changeWords.tip(change, { kind: 'engine', range, metric: cellMetric }) };
        }
        const cells = cellsOfPrompt(row);
        // The counts, or the read that was compared, have not arrived: there is nothing to say yet
        if (cells === undefined || comparedWindow === null) return undefined;
        const held = cells.find((cell) => cell.engine_code === code);
        if (held === undefined) return { content: t('prompts.columns.noAnswersTip') };
        return { content: changeWords.gap(held.previous == null ? 'noPrevious' : 'tooFew') };
      };
      const base = col.volumeTrend<PromptRow>(
        `change_${code}`,
        // The sort value is the points: a change that cannot be told is null, which sorts last in both directions
        (row) => changeOf(row)?.points ?? null,
        {
          header: t('prompts.compare.change.engineHeader', { engine: engine.engine.label }),
          headerTooltip: t('prompts.compare.change.engineHeaderTip', { metric }),
          defaultVisible: false,
          // The cell is drawn below: it has the states a count column does not
          known: () => null,
        },
      );
      return {
        ...base,
        cell: (row) => {
          const input = deltaInput(changeOf(row));
          // Left aligned like its header and the other numeric columns; `DeltaCell` pushes its value to the right edge
          return hasDeltaComparison(input) ? (
            <span className="num type-table">
              <DeltaValue input={input} test="interim" />
            </span>
          ) : (
            <span className="text-foreground-tertiary">{EMPTY_VALUE}</span>
          );
        },
        cellTip: tipOf,
      };
    });
  },
};
