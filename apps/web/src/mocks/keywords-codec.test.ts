import { describe, expect, it } from 'vitest';

import { MOCK_PROJECTS, MOCK_USERS } from './fixtures';
import { MOCK_GROUP_IDS, MOCK_TRACKED_KEYWORDS } from './keyword-fixtures';
import { decodeKeywordChanges, encodeKeywordChanges } from './keywords-codec';
import { keywordsCookie, keywordWorld, type KeywordChanges, type StoredTracked } from './keywords-state';
import { mockId } from './mock-ids';
import { MOCK_ENTITY_IDS, MOCK_TERM_IDS } from './entity-fixtures';

const project = MOCK_PROJECTS[0]?.project_id ?? '';
const user = MOCK_USERS[0]?.user_id ?? null;
const at = '2026-10-01T09:30:00.000Z';

const tracked = (n: number, extra: Partial<StoredTracked> = {}): StoredTracked => ({
  tracked_keyword_id: mockId('tracked', n),
  project_id: project,
  keyword_id: mockId('keyword', n),
  location_id: 2276,
  language_code: 'en',
  device: 'desktop',
  priority: 3,
  intent: 'unknown',
  intent_source: null,
  funnel_stage: 'unknown',
  frequency: 'daily',
  source: 'manual',
  business_value: null,
  schedule_id: null,
  os: null,
  is_active: true,
  deleted_at: null,
  created_by: user,
  created_at: at,
  updated_at: at,
  versions: [{ depth_profile: 'standard', target_url: null, valid_from: at, change_reason: null, changed_by: user }],
  ...extra,
});

const roundTrip = (changes: KeywordChanges): KeywordChanges | null =>
  decodeKeywordChanges(JSON.parse(JSON.stringify(encodeKeywordChanges(changes))) as never);

describe('the keyword changes codec', () => {
  it('gives back what it was given, rows, links, overrides and settings', () => {
    const edited = tracked(1, {
      ...MOCK_TRACKED_KEYWORDS[0],
      is_active: false,
      priority: 1,
      intent: 'commercial',
      intent_source: 'manual',
      business_value: '12.50',
      updated_at: '2026-10-01T10:00:00.000Z',
    });
    const changes: KeywordChanges = {
      minted: 104,
      keywords: [
        { keyword_id: mockId('keyword', 101), text: 'CRM für Agenturen', language_code: 'de', created_at: at },
      ],
      tracked: {
        created: [
          tracked(101, {
            keyword_id: mockId('keyword', 101),
            language_code: 'de',
            device: 'mobile',
            deleted_at: '2026-10-01T11:00:00.000Z',
            versions: [
              { depth_profile: 'standard', target_url: null, valid_from: at, change_reason: null, changed_by: user },
              {
                depth_profile: 'deep',
                target_url: 'https://fynix.digital/crm',
                valid_from: '2026-10-01T10:30:00.000Z',
                change_reason: 'Track deeper',
                changed_by: user,
              },
            ],
          }),
        ],
        edited: [edited],
      },
      groups: {
        created: [
          {
            group_id: mockId('group', 102),
            project_id: project,
            name: 'CRM',
            parent_id: MOCK_GROUP_IDS.services,
            created_at: at,
          },
        ],
        edited: [],
        deleted: [MOCK_GROUP_IDS.brand],
      },
      members: {
        added: [{ group_id: mockId('group', 102), tracked_keyword_id: mockId('tracked', 101) }],
        removed: [{ group_id: MOCK_GROUP_IDS.audits, tracked_keyword_id: mockId('tracked', 5) }],
      },
      terms: { added: [{ term_id: MOCK_TERM_IDS.seo, tracked_keyword_id: mockId('tracked', 101) }], removed: [] },
      overrides: {
        [mockId('tracked', 101)]: [
          { tracked_keyword_id: mockId('tracked', 101), entity_id: MOCK_ENTITY_IDS.rankforge, mode: 'exclude' },
        ],
      },
      settings: { [project]: { default_device: 'both', default_depth_profile: 'deep' } },
    };
    expect(roundTrip(changes)).toEqual(changes);
  });

  it('ignores a cookie whose contents do not decode', () => {
    expect(decodeKeywordChanges({ t: { c: [[1, 0, 1]] } })).toBeNull();
    expect(decodeKeywordChanges({ k: [[5, 7]] })).toBeNull();
  });

  it('keeps forty added keywords in one cookie', () => {
    const rows = Array.from({ length: 40 }, (_, index) => tracked(101 + index));
    const changes: KeywordChanges = {
      minted: 180,
      keywords: rows.map((row, index) => ({
        keyword_id: row.keyword_id,
        text: `crm software ${String(index)}`,
        language_code: 'en',
        created_at: at,
      })),
      tracked: { created: rows },
    };
    expect(keywordsCookie(changes)).not.toBeNull();
    expect(keywordWorld(changes).tracked).toHaveLength(MOCK_TRACKED_KEYWORDS.length + 40);
  });

  it('round-trips when a user clears the target URL on a fixture keyword', () => {
    const fixtureRow = MOCK_TRACKED_KEYWORDS[2];
    expect(fixtureRow?.versions[0]?.target_url).not.toBeNull();
    const version = fixtureRow?.versions[0];
    if (version === undefined || fixtureRow === undefined) throw new Error('Missing fixture 2');
    const cleared: StoredTracked = {
      ...fixtureRow,
      versions: [{ ...version, target_url: null }],
    };
    const changes: KeywordChanges = {
      tracked: { edited: [cleared] },
    };
    const decoded = roundTrip(changes);
    expect(decoded?.tracked?.edited?.[0]?.versions[0]?.target_url).toBeNull();
  });

  it('round-trips when a user sets the same target URL as the fixture', () => {
    const fixtureRow = MOCK_TRACKED_KEYWORDS[2];
    if (fixtureRow === undefined) throw new Error('Missing fixture 2');
    const sameTarget: StoredTracked = {
      ...fixtureRow,
      priority: 1,
    };
    const changes: KeywordChanges = {
      tracked: { edited: [sameTarget] },
    };
    const decoded = roundTrip(changes);
    expect(decoded?.tracked?.edited?.[0]?.versions[0]?.target_url).toBe(fixtureRow.versions[0]?.target_url);
    expect(decoded?.tracked?.edited?.[0]?.priority).toBe(1);
  });

  it('decodes an old cookie that stored explicit versions', () => {
    const explicitVersionTuple = [
      0, // depth standard (0)
      'https://example.com/custom',
      0, // valid_from
      0, // change_reason null
      0, // changed_by null
    ];
    const raw = {
      t: {
        m: [
          [
            -1, // tracked_keyword_id from string table
            -2, // project_id
            -3, // keyword_id
            2276, // location_id
            0, // created_at
            0, // language_code (default)
            0, // device (desktop)
            0, // priority (default 3)
            0, // intent
            0, // intent_source
            0, // funnel_stage
            0, // frequency
            0, // source
            0, // is_active (true)
            0, // deleted_at (null)
            0, // updated_at (created_at)
            0, // business_value (null)
            0, // schedule_id (null)
            0, // os (null)
            0, // created_by (null)
            [explicitVersionTuple], // cell 20: explicit versions array
          ],
        ],
      },
      u: [mockId('tracked', 2), project, mockId('keyword', 2)],
    };
    const decoded = decodeKeywordChanges(raw as never);
    expect(decoded?.tracked?.edited?.[0]?.versions[0]?.target_url).toBe('https://example.com/custom');
  });
});
