import type { ChangeWords, ComparedWindow } from '../compare';
import type { PromptFacts } from '../facts';
import type { PromptRow } from '../prompt-columns';
import { SORT_ID, type RateMetric } from '../prompt-model';
import type { PromptScope } from '../prompt-queries';
import { placeAfter, type Translate } from './shared';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { ProjectEngine } from '@/lib/api/types';

// Entries of later packages (MASTER-PLAN 3.4). A package uncomments its own import line and its own slot line and
// edits nothing else in this file; the "WP-NN" line above each stays as it is.

// P-metrics (Intent, Search volume, Avg position; Recommendation rate, Share of voice, Sentiment): one entry, which
// puts the first three after COLUMN_AFTER.identity and the rest after COLUMN_AFTER.rates, so it may be two entries.
// import { metricColumns } from '../columns/metric-columns';
// Preview notes for it: Intent is plain text (block, truncated, text-foreground), no badge background; Avg position
// shows the bare list count; the rates show the percent alone, with no "avg of N".

// P-popovers (Cited links, Brands, Screenshot): after COLUMN_AFTER.rates, registered after P-metrics so they follow it.
// Cited links and Screenshot return nothing unless `context.single` names a platform.
import { popoverColumns } from '../columns/popover-columns';
// Preview note for it: Brands and Cited links start with a green check (the own brand is named, or the own site is
// cited) or a grey dash.

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
  /** The engines shown, in order: the ones the Platform select leaves in. */
  engines: readonly ProjectEngine[];
  /** Their codes, in the same order: the platform scope the facts of a row are read over. */
  scope: readonly string[];
  /** The code of the one platform in scope, or `null` while several are: Cited links and Screenshot exist only for one. */
  single: string | null;
  /**
   * The facts of every row (`usePromptFacts`: position, sentiment, brands, cited links, volume, the latest answer), by
   * prompt id. `undefined` while the read is on its way or failed: a column then shows its cells as not collected yet.
   */
  facts: PromptFacts | undefined;
  /** The metric of the platform columns: always the mention rate, since the page has no switch for it. */
  metric: RateMetric;
  t: Translate;
  locale: string;
  /** The comparison with the previous period is on (`?cmp=previous`); the columns that read it need no hook. */
  compare: boolean;
  /** The window the summary was compared with; `null` for a read that was not compared. */
  comparedWindow: ComparedWindow;
  /** The workspace and project of the table, for the cells that write (Add as competitor) or read on their own. */
  project: PromptScope;
  /** The person may spend on a screenshot of an answer (`runs:trigger`); a reader sees the ones that exist. */
  canCapture: boolean;
  /** The project's time zone, in which the day of an answer is told. */
  timeZone: string;
  /** The words of a change, from the one translator the screen holds: a pure `cellTip` cannot call the hook. */
  changeWords: ChangeWords;
}

export interface PromptColumnEntry {
  /** The entry's own id; its columns carry their own ids, unique in the table. */
  id: string;
  /**
   * The column its columns follow (a built-in id of `SORT_ID` or an engine column id); last without one. A list is
   * the ids in order of preference: the first one the table has (see `COLUMN_AFTER`).
   */
  after?: string | readonly string[] | undefined;
  /** The columns, `defaultVisible: false` for the chooser. Pure: no hook, called inside `usePromptColumns`' memo. */
  build: (context: PromptColumnContext) => readonly DataTableColumn<PromptRow>[];
}

export const PROMPT_COLUMN_ENTRIES: readonly PromptColumnEntry[] = [
  // WP-19 compare-deltas (WB-PRM-12): the per-platform change columns are gone, the change is the trend icon of the
  // Mention rate cell (the preview has no such columns)
  // P-metrics, then P-popovers: their order here is the order of their columns after the same anchor
  // metricColumns,
  popoverColumns,
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

/**
 * Where the columns of the mock that later packages build go, as `after` lists: an entry that names one keeps the
 * mock's order whichever package registers first. Location shows only while the top bar says All locations, so the
 * columns that follow the identity block name it first and Group second.
 */
export const COLUMN_AFTER = {
  /** Intent, Search volume, Avg position: between the identity block and Mention rate. */
  identity: [SORT_ID.country, SORT_ID.topic],
  /** Recommendation rate, Share of voice, Sentiment, Cited links, Brands, Screenshot: between Citation rate and the platform columns. */
  rates: [SORT_ID.citation],
} as const satisfies Record<string, readonly string[]>;

/** `builtIns` with the columns of each entry placed after the column it names. Throws on a repeated column id. */
export function withColumnEntries(
  builtIns: readonly DataTableColumn<PromptRow>[],
  entries: readonly PromptColumnEntry[],
  context: PromptColumnContext,
): DataTableColumn<PromptRow>[] {
  const ids = new Set(builtIns.map((column) => column.id));
  return placeAfter(
    builtIns,
    entries.map((entry) => ({
      // A list names the first column the table has; none of them is an error `placeAfter` reports
      after:
        typeof entry.after === 'string' || entry.after === undefined
          ? entry.after
          : (entry.after.find((id) => ids.has(id)) ?? entry.after[0]),
      items: entry.build(context),
    })),
    (column) => column.id,
  );
}
