import { brandsColumn } from './brands-column';
import { linksColumn } from './links-column';
import { screenshotColumn } from './screenshot-column';
import type { FactsRow, TrackedEntity } from '../facts';
import type { PromptRow } from '../prompt-columns';
import { SORT_ID } from '../prompt-model';
import type { PromptColumnContext, PromptColumnEntry } from '../seams/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';

const NO_ENTITIES: readonly TrackedEntity[] = [];

/**
 * The three columns that open something: Cited pages, Brands and Screenshot, in the mock's order after Sentiment.
 * Cited pages and Screenshot exist only while one platform is in view; pages and answers are counted per platform and never
 * pooled. Their cells read the facts of the row's own summary row, and a prompt that has none is a prompt without
 * answers in the period once the facts have been read.
 */
export const popoverColumns: PromptColumnEntry = {
  id: 'popovers',
  // The same place as `COLUMN_AFTER.rates`, which this file cannot import without a cycle
  after: [SORT_ID.citation],
  build: ({
    facts,
    scope,
    single,
    engines,
    project,
    timeZone,
    t,
  }: PromptColumnContext): readonly DataTableColumn<PromptRow>[] => {
    const loaded = facts !== undefined;
    const rowOf = (row: PromptRow): FactsRow | undefined => facts?.prompts.get(row.prompt.prompt_id);
    const labelOf = (): string => t('prompts.lists.thisPrompt');
    const nameOf = (code: string): string =>
      engines.find((engine) => engine.engine.engine_code === code)?.engine.label ?? code;
    const platform = single === null ? null : { code: single, name: nameOf(single) };
    return [
      ...(platform === null ? [] : [linksColumn<PromptRow>({ rowOf, labelOf, loaded, code: platform.code, t })]),
      brandsColumn<PromptRow>({
        rowsOf: (row) => {
          const found = rowOf(row);
          return found === undefined ? [] : [found];
        },
        labelOf,
        loaded,
        scope,
        entities: facts?.entities ?? NO_ENTITIES,
        project,
        platformName: nameOf,
        t,
      }),
      ...(platform === null
        ? []
        : [
            screenshotColumn<PromptRow>({
              rowOf,
              promptTextOf: (row) => row.prompt.current_version.text,
              loaded,
              platform,
              timeZone,
              t,
            }),
          ]),
    ];
  },
};
