import type { OverviewModel, OverviewRow } from './overview-model';
import type { CsvTable } from '@/lib/csv/csv-write';

/** The cards of the Overview that hold rows, in the order of the spec (6.4). */
export const CARD_KEYS = ['status', 'funnel', 'sections', 'tiers', 'depth', 'sitemap'] as const;
export type CardKey = (typeof CARD_KEYS)[number];

export interface OverviewCsvWords {
  header: readonly [string, string, string];
  /** The title of a card. */
  card: (card: CardKey) => string;
  /** The label of a row, as the card draws it. */
  row: (card: CardKey, row: OverviewRow) => string;
}

/** Every row of every card, one line each: card, row, count. A crawl with no sitemap has no sitemap lines. */
export function overviewCsv(model: OverviewModel, words: OverviewCsvWords): CsvTable {
  return {
    header: words.header,
    rows: CARD_KEYS.flatMap((card) =>
      (model[card] ?? []).map((row) => [words.card(card), words.row(card, row), row.count] as const),
    ),
  };
}
