import { promptVolumeOf, type FactsRow, type LinkedKeywordVolume, type PromptSummaryRowWithFacts } from '../facts';
import type { PromptRow } from '../prompt-columns';
import { cellsOfPrompt } from '../prompt-model';
import { COLUMN_AFTER, type PromptColumnContext, type PromptColumnEntry } from '../seams/columns';
import { intentColumn } from './intent-column';
import { ownEntityIdsOf, type MetricContext } from './metric-shared';
import { positionColumn } from './position-column';
import { recommendationColumn } from './recommendation-column';
import { sentimentColumn } from './sentiment-column';
import { shareOfVoiceColumn } from './sov-column';
import { volumeColumn } from './volume-column';
import type { DataTableColumn } from '@/components/app/data-table/types';

const metricContext = ({ t, locale, engines, scope, facts }: PromptColumnContext): MetricContext => ({
  t,
  locale,
  engines,
  scope,
  ownEntityIds: ownEntityIdsOf(facts?.entities),
  trackedCount: facts?.entities.length,
});

const NO_ANSWERS: FactsRow = { engines: [] };

/** What a prompt row of the Prompts tab gives the generic columns: the facts of its summary row, by prompt id. */
function promptRows(context: PromptColumnContext): {
  facts: (row: PromptRow) => FactsRow | undefined;
  link: (row: PromptRow) => LinkedKeywordVolume | null | undefined;
} {
  const summary = (row: PromptRow): PromptSummaryRowWithFacts | undefined =>
    context.facts?.prompts.get(row.prompt.prompt_id);
  return {
    // The facts were read and the prompt has no row in them: it has no answers in the window
    facts: (row) => (context.facts === undefined ? undefined : (summary(row) ?? NO_ANSWERS)),
    link: (row) => summary(row)?.linked_keyword,
  };
}

/**
 * Intent, Search volume and Mention position (after the identity block), then Recommendation rate, Share of voice and
 * Sentiment (after Citation rate), each built by a generic column that the Groups tab reuses with its own rows. The two
 * entries go before every other entry, so the columns of later packages that follow Citation rate come after these.
 */
export const metricColumns: readonly PromptColumnEntry[] = [
  {
    id: 'metrics-identity',
    after: COLUMN_AFTER.identity,
    build: (context): readonly DataTableColumn<PromptRow>[] => {
      const rows = promptRows(context);
      const shared = metricContext(context);
      return [
        intentColumn<PromptRow>(context.t, (row) => row.prompt.intent),
        volumeColumn<PromptRow>(context.t, (row) => promptVolumeOf(rows.link(row))),
        positionColumn<PromptRow>(shared, rows),
      ];
    },
  },
  {
    id: 'metrics-rates',
    after: COLUMN_AFTER.rates,
    build: (context): readonly DataTableColumn<PromptRow>[] => {
      const rows = promptRows(context);
      const shared = metricContext(context);
      return [
        recommendationColumn<PromptRow>(shared, rows),
        shareOfVoiceColumn<PromptRow>(shared, { cells: cellsOfPrompt, link: rows.link }),
        sentimentColumn<PromptRow>(shared, rows),
      ];
    },
  },
];
