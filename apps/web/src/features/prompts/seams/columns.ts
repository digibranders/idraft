import type { ChangeWords, ComparedWindow } from '../compare';
import type { PromptRow } from '../prompt-columns';
import type { RateMetric } from '../prompt-model';
import { placeAfter, type Translate } from './shared';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { ProjectEngine } from '@/lib/api/types';

// Entries of later packages (MASTER-PLAN 3.4). A package uncomments its own import line and its own slot line and
// edits nothing else in this file; the "WP-NN" line above each stays as it is.

// WP-19 compare-deltas
import { compareColumns } from '../columns/compare-columns';

// WP-23 competitor-views
// import { topCompetitorColumn } from '../columns/top-competitor-column';

// WP-24 fanout-views
// import { fanoutColumn } from '../columns/fanout-column';

// WP-41 versions
// import { versionColumns } from '../columns/version-columns';

// WP-43 panels-web
// import { panelColumns } from '../columns/panel-columns';

// WP-44 links-generate
// import { linkColumns } from '../columns/link-columns';

// WP-55 recommend-web
// import { recommendationColumns } from '../columns/recommendation-columns';

// WP-59 stats-web
// import { volatilityColumn } from '../columns/volatility-column';

// WP-65 aio-xch-web
// import { aiOverviewColumn } from '../columns/ai-overview-column';

export interface PromptColumnContext {
  /** The engines shown, in order. */
  engines: readonly ProjectEngine[];
  /** The metric of the engine columns (`?metric=`). */
  metric: RateMetric;
  t: Translate;
  locale: string;
  /** The comparison with the previous period is on (`?cmp=`); added for WP-19, the columns that read it need no hook. */
  compare: boolean;
  /** The window the summary was compared with; `null` for a read that was not compared. */
  comparedWindow: ComparedWindow;
  /** The words of a change, from the one translator the screen holds: a pure `cellTip` cannot call the hook. */
  changeWords: ChangeWords;
}

export interface PromptColumnEntry {
  /** The entry's own id; its columns carry their own ids, unique in the table. */
  id: string;
  /** The column its columns follow (a built-in id of `SORT_ID` or an engine column id); last without one. */
  after?: string | undefined;
  /** The columns, `defaultVisible: false` for the chooser. Pure: no hook, called inside `usePromptColumns`' memo. */
  build: (context: PromptColumnContext) => readonly DataTableColumn<PromptRow>[];
}

export const PROMPT_COLUMN_ENTRIES: readonly PromptColumnEntry[] = [
  // WP-19 compare-deltas (WB-PRM-12)
  compareColumns,
  // WP-23 competitor-views (WB-PRM-13)
  // topCompetitorColumn,
  // WP-24 fanout-views (WB-PRM-18)
  // fanoutColumn,
  // WP-41 versions (WB-PRM-21, WB-PRM-34)
  // versionColumns,
  // WP-43 panels-web (WB-PRM-04, WB-PRM-22)
  // panelColumns,
  // WP-44 links-generate (WB-PRM-20)
  // linkColumns,
  // WP-55 recommend-web (WB-PRM-10)
  // recommendationColumns,
  // WP-59 stats-web (WB-PRM-19)
  // volatilityColumn,
  // WP-65 aio-xch-web (WB-PRM-24)
  // aiOverviewColumn,
];

/** `builtIns` with the columns of each entry placed after the column it names. Throws on a repeated column id. */
export function withColumnEntries(
  builtIns: readonly DataTableColumn<PromptRow>[],
  entries: readonly PromptColumnEntry[],
  context: PromptColumnContext,
): DataTableColumn<PromptRow>[] {
  return placeAfter(
    builtIns,
    entries.map((entry) => ({ after: entry.after, items: entry.build(context) })),
    (column) => column.id,
  );
}
