import { MOCK_ENTITY_IDS, MOCK_TERM_IDS } from './entity-fixtures';
import { MOCK_CREATED_AT, MOCK_PROJECTS, MOCK_USERS } from './fixtures';
import { KEYWORD_TABLE, type KeywordRow, type TableGroup, type TableTopic } from './keyword-table';
import { normalizeKeyword } from '@/lib/keywords/keyword-text';
import type {
  StoredGroup,
  StoredKeyword,
  StoredMember,
  StoredOverride,
  StoredTermLink,
  StoredTracked,
} from './keywords-state';
import { mockId } from './mock-ids';

/**
 * The keywords the mocks start from (backend plan step 5, part 1): Fynix tracks about sixty, most with Labs
 * metrics, a few still waiting for them and a few archived, filed in a small group tree and in terms of the
 * Topics vocabulary. The other projects track none, so a new project's Rankings starts empty.
 */

const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
export const FYNIX_PROJECT_ID = fynix.project_id;
const owner = MOCK_USERS[0]?.user_id ?? null;

/** Fixture times: the metrics were fetched a week ago, keywords were added over the summer. */
export const METRICS_FETCHED_AT = '2026-09-24T03:12:00Z';
const ADDED_FROM = Date.parse('2026-06-15T08:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
/** The three keywords still waiting for Labs were added just now, in mock time. */
export const PENDING_ADDED_AT = '2026-09-30T16:40:00Z';

export const MOCK_GROUP_IDS = {
  services: mockId('group', 1),
  audits: mockId('group', 2),
  content: mockId('group', 3),
  local: mockId('group', 4),
  brand: mockId('group', 5),
} as const;

export const MOCK_KEYWORD_GROUPS: readonly StoredGroup[] = [
  {
    group_id: MOCK_GROUP_IDS.services,
    project_id: FYNIX_PROJECT_ID,
    name: 'Services',
    parent_id: null,
    created_at: MOCK_CREATED_AT,
  },
  {
    group_id: MOCK_GROUP_IDS.audits,
    project_id: FYNIX_PROJECT_ID,
    name: 'SEO audits',
    parent_id: MOCK_GROUP_IDS.services,
    created_at: MOCK_CREATED_AT,
  },
  {
    group_id: MOCK_GROUP_IDS.content,
    project_id: FYNIX_PROJECT_ID,
    name: 'Content',
    parent_id: MOCK_GROUP_IDS.services,
    created_at: MOCK_CREATED_AT,
  },
  {
    group_id: MOCK_GROUP_IDS.local,
    project_id: FYNIX_PROJECT_ID,
    name: 'Local',
    parent_id: null,
    created_at: MOCK_CREATED_AT,
  },
  {
    group_id: MOCK_GROUP_IDS.brand,
    project_id: FYNIX_PROJECT_ID,
    name: 'Brand',
    parent_id: null,
    created_at: MOCK_CREATED_AT,
  },
];

const GROUP_OF: Readonly<Record<NonNullable<TableGroup>, string>> = {
  audits: MOCK_GROUP_IDS.audits,
  content: MOCK_GROUP_IDS.content,
  local: MOCK_GROUP_IDS.local,
  brand: MOCK_GROUP_IDS.brand,
};
const TERM_OF: Readonly<Record<NonNullable<TableTopic>, string>> = {
  seo: MOCK_TERM_IDS.seo,
  technical: MOCK_TERM_IDS.technicalSeo,
  local: MOCK_TERM_IDS.localSeo,
  content: MOCK_TERM_IDS.contentMarketing,
  blog: MOCK_TERM_IDS.blogStrategy,
  paid: MOCK_TERM_IDS.paidSearch,
};

/** One keyword per normalized text and language, numbered in the table's order. */
const keywordIds = new Map<string, string>();
const keywordKey = (row: Pick<KeywordRow, 'text' | 'language'>): string =>
  `${row.language}:${normalizeKeyword(row.text)}`;
export const MOCK_KEYWORDS: readonly StoredKeyword[] = KEYWORD_TABLE.flatMap((row) => {
  const key = keywordKey(row);
  if (keywordIds.has(key)) return [];
  const keyword_id = mockId('keyword', keywordIds.size + 1);
  keywordIds.set(key, keyword_id);
  return [{ keyword_id, text: row.text, language_code: row.language, created_at: MOCK_CREATED_AT }];
});

const keywordIdOf = (row: KeywordRow): string => {
  const id = keywordIds.get(keywordKey(row));
  if (id === undefined) throw new Error(`No keyword for ${row.text}`);
  return id;
};

/** The table's rows with their tracked keyword ids, in order. */
const TRACKED_ROWS = KEYWORD_TABLE.map((row, index) => ({ row, id: mockId('tracked', index + 1) }));

/** The tracked keywords still waiting for Labs: they stand for keywords added minutes ago, so they have no rank check either. */
export const PENDING_TRACKED_IDS: ReadonlySet<string> = new Set(
  TRACKED_ROWS.filter(({ row }) => row.metrics === null).map(({ id }) => id),
);

export const MOCK_TRACKED_KEYWORDS: readonly StoredTracked[] = TRACKED_ROWS.map(({ row, id }, index) => {
  const added = row.metrics === null ? PENDING_ADDED_AT : new Date(ADDED_FROM + index * 37 * HOUR_MS).toISOString();
  return {
    tracked_keyword_id: id,
    project_id: FYNIX_PROJECT_ID,
    keyword_id: keywordIdOf(row),
    location_id: row.location,
    language_code: row.language,
    device: row.device,
    priority: row.priority,
    intent: row.metrics?.intent ?? 'unknown',
    intent_source: row.metrics === null ? null : 'provider',
    funnel_stage: 'unknown',
    frequency: 'daily',
    source: index % 4 === 0 ? 'csv_import' : 'manual',
    business_value: null,
    schedule_id: null,
    os: null,
    is_active: row.archived !== true,
    deleted_at: null,
    created_by: owner,
    created_at: added,
    updated_at: added,
    versions: [
      { depth_profile: 'standard', target_url: null, valid_from: added, change_reason: null, changed_by: owner },
    ],
  };
});

export const MOCK_GROUP_MEMBERS: readonly StoredMember[] = TRACKED_ROWS.flatMap(({ row, id }) =>
  row.group === null ? [] : [{ group_id: GROUP_OF[row.group], tracked_keyword_id: id }],
);

export const MOCK_TERM_LINKS: readonly StoredTermLink[] = TRACKED_ROWS.flatMap(({ row, id }) =>
  row.topic === null ? [] : [{ term_id: TERM_OF[row.topic], tracked_keyword_id: id }],
);

/** "seo agency berlin" watches Rankforge too, and leaves Meridian Growth out. */
export const MOCK_OVERRIDES: readonly StoredOverride[] = [
  { tracked_keyword_id: mockId('tracked', 1), entity_id: MOCK_ENTITY_IDS.seoWeekly, mode: 'include' },
  { tracked_keyword_id: mockId('tracked', 1), entity_id: MOCK_ENTITY_IDS.meridian, mode: 'exclude' },
];

/** Labs' current metrics by keyword id, location and language; a keyword without a reading has none. */
export interface FixtureReading {
  volume: number;
  difficulty: number;
  cpc: string;
  intent: string;
}
const readingKey = (keywordId: string, locationId: number, languageCode: string): string =>
  `${keywordId}:${String(locationId)}:${languageCode}`;
const READINGS = new Map<string, FixtureReading>(
  KEYWORD_TABLE.flatMap((row) =>
    row.metrics === null
      ? []
      : [
          [
            readingKey(keywordIdOf(row), row.location, row.language),
            {
              volume: row.metrics.volume,
              difficulty: row.metrics.difficulty,
              cpc: row.metrics.cpc,
              intent: row.metrics.intent,
            },
          ] as const,
        ],
  ),
);

export const fixtureReading = (keywordId: string, locationId: number, languageCode: string): FixtureReading | null =>
  READINGS.get(readingKey(keywordId, locationId, languageCode)) ?? null;

/** Every fixture reading of a keyword, by location and language, for the workspace keyword view. */
export const fixtureReadingsOf = (
  keywordId: string,
): { locationId: number; languageCode: string; reading: FixtureReading }[] =>
  [...READINGS.entries()].flatMap(([key, reading]) => {
    const [id, location, language] = key.split(':');
    return id === keywordId && location !== undefined && language !== undefined
      ? [{ locationId: Number(location), languageCode: language, reading }]
      : [];
  });
