import { isValidAnswer } from './latest-model';
import type { CitationOut, MentionOut, ObservationDetail, ObservationSummary } from '@/lib/api/types';

/**
 * The Compare days section of the prompt page: one platform, one column per answer day. Plain data; the screen puts
 * words and a layout to it. A column is built from the answer's own detail, so it says what the Evidence view says.
 */

/** How many days sit side by side: more would squeeze the lists below a readable width at the page's content width. */
export const DAY_COLUMNS = 4;

/**
 * The newest valid answer of each project day on `engineCode`, the last `limit` days, oldest first. The list is read
 * newest first but its order is not relied on. A day with no valid answer has no column.
 */
export function dayAnswers(
  rows: readonly ObservationSummary[],
  engineCode: string,
  limit: number = DAY_COLUMNS,
): ObservationSummary[] {
  const newestFirst = rows
    .filter((row) => row.engine_code === engineCode && isValidAnswer(row))
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
  const seen = new Set<string>();
  const perDay: ObservationSummary[] = [];
  for (const row of newestFirst) {
    if (seen.has(row.observed_date)) continue;
    seen.add(row.observed_date);
    perDay.push(row);
    if (perDay.length === limit) break;
  }
  return perDay.reverse();
}

/** Citation flags that keep a citation out of a column, as they keep it out of every share. */
const LEFT_OUT_FLAGS: readonly string[] = ['unresolved_redirect', 'engine_internal'];

export interface DayBrand {
  entityId: string;
  name: string;
  role: MentionOut['role'];
}

export interface DaySource {
  host: string;
  role: 'own' | 'competitor' | 'third_party';
}

export interface DayColumn {
  observationId: string;
  /** The project day of the answer. */
  observedDate: string;
  observedAt: string;
  /** The brands the answer named, in the order it named them. */
  brands: DayBrand[];
  /** The sites it cited, each once, in the order of its first citation. */
  sources: DaySource[];
  ownNamed: boolean;
  ownCited: boolean;
}

/** Position of a mention in the answer: its order among the tracked brands, then where it first stands in the text. */
const byAppearance = (a: ColumnSource['mentions'][number], b: ColumnSource['mentions'][number]): number => {
  if (a.mention_order !== null && b.mention_order !== null) return a.mention_order - b.mention_order;
  if (a.mention_order !== null) return -1;
  if (b.mention_order !== null) return 1;
  return a.first_char_offset - b.first_char_offset;
};

/** The members of an answer's detail a column reads: the read's own type and the schema's type both fit. */
export type ColumnSource = Pick<ObservationDetail, 'observation_id' | 'observed_date' | 'observed_at'> & {
  mentions: readonly Pick<
    MentionOut,
    'entity_id' | 'name' | 'role' | 'mention_order' | 'mention_status' | 'first_char_offset'
  >[];
  citations: readonly Pick<CitationOut, 'host' | 'domain_role' | 'citation_index' | 'flags'>[];
};

/** A column from the detail of one answer. A mention the match is unsure of is not a brand named. */
export function columnOf(detail: ColumnSource): DayColumn {
  const brands: DayBrand[] = [];
  const named = new Set<string>();
  for (const mention of detail.mentions.filter((entry) => entry.mention_status === 'accepted').sort(byAppearance)) {
    if (named.has(mention.entity_id)) continue;
    named.add(mention.entity_id);
    brands.push({ entityId: mention.entity_id, name: mention.name, role: mention.role });
  }
  const sources: DaySource[] = [];
  const hosts = new Set<string>();
  for (const citation of [...detail.citations].sort((a, b) => a.citation_index - b.citation_index)) {
    // Left out as every share leaves them out (docs/14 section 9): grounding redirects and links into the engine itself
    if (citation.flags.some((flag) => LEFT_OUT_FLAGS.includes(flag))) continue;
    const host = citation.host.replace(/^www\./, '');
    if (hosts.has(host)) continue;
    hosts.add(host);
    sources.push({ host, role: citation.domain_role });
  }
  return {
    observationId: detail.observation_id,
    observedDate: detail.observed_date,
    observedAt: detail.observed_at,
    brands,
    sources,
    ownNamed: brands.some((brand) => brand.role === 'own'),
    ownCited: sources.some((source) => source.role === 'own'),
  };
}

export interface DayChanges {
  /** The ids of the brands this column names that the one before did not. */
  entered: ReadonlySet<string>;
  /** The brands the one before named that this one does not. */
  left: DayBrand[];
}

/** What a column gained and lost against the one before it; nothing for the first column. */
export function changesOf(previous: DayColumn | null, current: DayColumn): DayChanges {
  if (previous === null) return { entered: new Set(), left: [] };
  const before = new Set(previous.brands.map((brand) => brand.entityId));
  const now = new Set(current.brands.map((brand) => brand.entityId));
  return {
    entered: new Set(current.brands.filter((brand) => !before.has(brand.entityId)).map((brand) => brand.entityId)),
    left: previous.brands.filter((brand) => !now.has(brand.entityId)),
  };
}

export type DayReading = 'namedAndCited' | 'namedOnly' | 'citedOnly' | 'neither';

/** Where the own brand stood that day: named in the answer, cited as a source, both or neither. */
export function readingOf(column: DayColumn): DayReading {
  if (column.ownNamed) return column.ownCited ? 'namedAndCited' : 'namedOnly';
  return column.ownCited ? 'citedOnly' : 'neither';
}
