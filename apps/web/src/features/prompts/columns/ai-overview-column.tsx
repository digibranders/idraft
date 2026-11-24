import type { ReactElement } from 'react';

import { Missing } from './metric-shared';
import type { PromptRow } from '../prompt-columns';
import { SORT_ID } from '../prompt-model';
import type { PromptColumnContext, PromptColumnEntry } from '../seams/columns';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { EMPTY_VALUE, formatTableDate } from '@/lib/format';
import type { Schemas } from '@/lib/api/types';

const WIDTH = 132;
type Cell = Schemas['PromptAiOverview'];

/** Cited rows sort by the place of the site in the overview, then not cited, then none shown; unknown last. */
function sortValueOf(cell: Cell | undefined): number | null {
  if (cell === undefined) return null;
  if (cell.source_state === 'ok') return cell.cited_own === true ? (cell.cited_position ?? 1) : 1000;
  return cell.source_state === 'no_surface' ? 2000 : null;
}

function aiOverviewColumn(context: PromptColumnContext): DataTableColumn<PromptRow> {
  const { t, timeZone } = context;
  const cellOf = (row: PromptRow): Cell | undefined => row.summary?.ai_overview;
  const dateOf = (cell: Cell): string => (cell.observed_at === null ? '' : formatTableDate(cell.observed_at, timeZone));
  const label = (cell: Cell | undefined): { text: string; known: boolean } => {
    if (cell === undefined) return { text: EMPTY_VALUE, known: false };
    switch (cell.source_state) {
      case 'ok':
        if (cell.cited_own !== true) return { text: t('prompts.metrics.aiOverview.notCited'), known: true };
        return {
          text:
            cell.cited_position === null
              ? t('prompts.metrics.aiOverview.citedNoPosition')
              : t('prompts.metrics.aiOverview.cited', { position: cell.cited_position }),
          known: true,
        };
      case 'no_surface':
        return { text: t('prompts.metrics.aiOverview.none'), known: true };
      case 'not_tracked':
        return { text: t('prompts.metrics.aiOverview.notTracked'), known: false };
      case 'no_linked_keyword':
        return { text: EMPTY_VALUE, known: false };
    }
  };
  const tipOf = (cell: Cell | undefined): string => {
    if (cell === undefined) return t('prompts.metrics.notCollectedTip');
    const keyword = cell.keyword ?? '';
    const date = dateOf(cell);
    switch (cell.source_state) {
      case 'ok':
        if (cell.cited_own !== true) return t('prompts.metrics.aiOverview.tips.notCited', { keyword, date });
        return cell.cited_position === null
          ? t('prompts.metrics.aiOverview.tips.cited', { keyword, date })
          : t('prompts.metrics.aiOverview.tips.citedAt', { keyword, date, position: cell.cited_position });
      case 'no_surface':
        return t('prompts.metrics.aiOverview.tips.none', { keyword, date });
      case 'not_tracked':
        return t('prompts.metrics.aiOverview.tips.notTracked');
      case 'no_linked_keyword':
        return t('prompts.metrics.aiOverview.tips.noLinkedKeyword');
    }
  };
  return col.aiOverview<PromptRow>(SORT_ID.aiOverview, (row) => sortValueOf(cellOf(row)), {
    header: t('prompts.metrics.aiOverview.header'),
    headerTooltip: t('prompts.metrics.aiOverview.tip'),
    priority: 3,
    width: WIDTH,
    minWidth: WIDTH,
    defaultVisible: true,
    cell: (row): ReactElement => {
      const shown = label(cellOf(row));
      return shown.known ? <span className="whitespace-nowrap">{shown.text}</span> : <Missing label={shown.text} />;
    },
    cellTip: (row): CellTip => ({ content: tipOf(cellOf(row)) }),
  });
}

/** Google AI Overview per prompt (WB-PRM-24), after the rates: what Google showed for the linked keyword at its latest check. */
export const aiOverviewColumnEntry: PromptColumnEntry = {
  id: 'ai-overview',
  after: [SORT_ID.citation],
  build: (context) => [aiOverviewColumn(context)],
};
