import { MOCK_CREATED_AT } from './fixtures';
import { MOCK_TRACKED_KEYWORDS } from './keyword-fixtures';
import {
  DEPTH_PROFILES,
  DEVICES,
  FREQUENCIES,
  FUNNEL_STAGES,
  INTENT_SOURCES,
  INTENTS,
  OS_VALUES,
  SOURCES,
  type KeywordChanges,
  type StoredGroup,
  type StoredKeyword,
  type StoredMember,
  type StoredOverride,
  type StoredSeoSettings,
  type StoredTermLink,
  type StoredTracked,
  type StoredVersion,
} from './keywords-state';
import { FIRST_MINTED, mockId, mockIdNumber, type IdKind } from './mock-ids';
import { z } from 'zod';

/**
 * The compact form of the keyword changes in their cookie (./keywords-state.ts), so a browser can add and
 * edit dozens of tracked keywords in under 4 KB:
 *
 * - each row is a tuple with its members in a fixed order, a member at its default written as `0`, and
 *   trailing defaults left out;
 * - an id of the mocks (./mock-ids.ts) is its number; any other id (a project or user made elsewhere, an
 *   entity made with a new project) is written once in `u` and named by `-(index + 1)`;
 * - times are whole minutes after the fixture time;
 * - a tracked keyword whose only configuration is the one it was created with leaves its versions out.
 */

type Cell = string | number | null | Cell[];
type Tuple = Cell[];

const CELL: z.ZodType<Cell> = z.lazy(() => z.union([z.string(), z.number(), z.null(), z.array(CELL)]));
const TUPLE = z.array(CELL);
const ROWS = z.object({
  c: z.array(TUPLE).optional(),
  m: z.array(TUPLE).optional(),
  d: z.array(z.number()).optional(),
});
const PAIRS = z.object({
  a: z.array(z.tuple([z.number(), z.number()])).optional(),
  r: z.array(z.tuple([z.number(), z.number()])).optional(),
});

/** The shape of the cookie; one that does not fit is ignored. */
export const COMPACT_KEYWORD_CHANGES = z.object({
  n: z
    .number()
    .int()
    .min(FIRST_MINTED - 1)
    .optional(),
  u: z.array(z.string()).optional(),
  k: z.array(TUPLE).optional(),
  t: ROWS.optional(),
  g: ROWS.optional(),
  gm: PAIRS.optional(),
  tl: PAIRS.optional(),
  o: z.array(z.tuple([z.number(), z.array(z.tuple([z.number(), z.number()]))])).optional(),
  s: z.array(z.tuple([z.number(), TUPLE])).optional(),
});
type CompactKeywordChanges = z.infer<typeof COMPACT_KEYWORD_CHANGES>;

const BASE_MS = Date.parse(MOCK_CREATED_AT);
const MINUTE_MS = 60_000;
const minutesOf = (iso: string): number => Math.max(0, Math.round((Date.parse(iso) - BASE_MS) / MINUTE_MS));
const timeOf = (minutes: number): string => new Date(BASE_MS + minutes * MINUTE_MS).toISOString();

const DEFAULT_PRIORITY = 3;
const DEFAULT_LANGUAGE = 'en';
const SETTING_DEVICES = ['desktop', 'mobile', 'both'] as const;
const SETTING_FREQUENCIES = ['daily', 'weekly'] as const;
const WEIGHT_SCHEMES = ['uniform', 'priority', 'business_value'] as const;
const VOLUME_MODES = ['annual_average', 'seasonal'] as const;
const MODES = ['include', 'exclude'] as const;

/** A cookie whose contents do not decode; it is ignored as a whole. */
class CookieShapeError extends Error {}

function trimmed(cells: Tuple): Tuple {
  const out = [...cells];
  while (out.length > 0 && out.at(-1) === 0) out.pop();
  return out;
}

class Encoder {
  readonly table: string[] = [];

  ref(id: string, kind: IdKind | null): number {
    const n = kind === null ? null : mockIdNumber(id, kind);
    if (n !== null) return n;
    const index = this.table.indexOf(id);
    if (index >= 0) return -(index + 1);
    this.table.push(id);
    return -this.table.length;
  }

  optRef(id: string | null, kind: IdKind | null): number {
    return id === null ? 0 : this.ref(id, kind);
  }

  /** An enumeration's index (0 for the first, the default). */
  static code<T extends string>(value: T, values: readonly T[]): number {
    return Math.max(0, values.indexOf(value));
  }

  /** `0` for null, else the index plus one. */
  static optCode<T extends string>(value: T | null | undefined, values: readonly T[]): number {
    return value === null || value === undefined ? 0 : values.indexOf(value) + 1;
  }
}

class Decoder {
  constructor(private readonly table: readonly string[]) {}

  private cell(cells: Tuple, index: number): Cell {
    return cells[index] ?? 0;
  }

  number(cells: Tuple, index: number): number {
    const value = this.cell(cells, index);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new CookieShapeError();
    return value;
  }

  text(cells: Tuple, index: number): string {
    const value = this.cell(cells, index);
    if (typeof value !== 'string') throw new CookieShapeError();
    return value;
  }

  optText(cells: Tuple, index: number): string | null {
    const value = this.cell(cells, index);
    if (value === 0) return null;
    if (typeof value !== 'string') throw new CookieShapeError();
    return value;
  }

  id(value: number, kind: IdKind | null): string {
    if (!Number.isInteger(value) || value === 0) throw new CookieShapeError();
    if (value < 0) {
      const id = this.table[-value - 1];
      if (id === undefined) throw new CookieShapeError();
      return id;
    }
    if (kind === null) throw new CookieShapeError();
    return mockId(kind, value);
  }

  optId(cells: Tuple, index: number, kind: IdKind | null): string | null {
    const value = this.number(cells, index);
    return value === 0 ? null : this.id(value, kind);
  }

  code<T extends string>(cells: Tuple, index: number, values: readonly T[]): T {
    const value = values[this.number(cells, index)];
    if (value === undefined) throw new CookieShapeError();
    return value;
  }

  optCode<T extends string>(cells: Tuple, index: number, values: readonly T[]): T | null {
    const n = this.number(cells, index);
    if (n === 0) return null;
    const value = values[n - 1];
    if (value === undefined) throw new CookieShapeError();
    return value;
  }

  time(cells: Tuple, index: number): string {
    return timeOf(this.number(cells, index));
  }

  tuple(cells: Tuple, index: number): Tuple {
    const value = this.cell(cells, index);
    if (!Array.isArray(value)) throw new CookieShapeError();
    return value;
  }
}

// Keywords: [number, text, created, language, workspace]

function encodeKeyword(e: Encoder, row: StoredKeyword): Tuple {
  return trimmed([
    e.ref(row.keyword_id, 'keyword'),
    row.text,
    minutesOf(row.created_at),
    row.language_code === DEFAULT_LANGUAGE ? 0 : row.language_code,
    e.optRef(row.workspace_id ?? null, null),
  ]);
}

function decodeKeyword(d: Decoder, cells: Tuple): StoredKeyword {
  const workspaceId = d.optId(cells, 4, null);
  return {
    keyword_id: d.id(d.number(cells, 0), 'keyword'),
    text: d.text(cells, 1),
    created_at: d.time(cells, 2),
    language_code: d.optText(cells, 3) ?? DEFAULT_LANGUAGE,
    ...(workspaceId === null ? {} : { workspace_id: workspaceId }),
  };
}

// Tracked keywords. The versions are [depth, url, from, reason, by] each.

const isDefaultVersions = (row: StoredTracked): boolean => {
  const [only, ...rest] = row.versions;
  if (only === undefined || rest.length > 0) return false;
  const fixture = MOCK_TRACKED_KEYWORDS.find((f) => f.tracked_keyword_id === row.tracked_keyword_id);
  const target = fixture?.versions[0]?.target_url ?? null;
  return (
    only.depth_profile === 'standard' &&
    only.target_url === target &&
    only.valid_from === row.created_at &&
    only.change_reason === null &&
    only.changed_by === row.created_by
  );
};

function encodeVersion(e: Encoder, version: StoredVersion): Tuple {
  return trimmed([
    Encoder.code(version.depth_profile, DEPTH_PROFILES),
    version.target_url ?? 0,
    minutesOf(version.valid_from),
    version.change_reason ?? 0,
    e.optRef(version.changed_by, null),
  ]);
}

function decodeVersion(d: Decoder, cells: Tuple): StoredVersion {
  return {
    depth_profile: d.code(cells, 0, DEPTH_PROFILES),
    target_url: d.optText(cells, 1),
    valid_from: d.time(cells, 2),
    change_reason: d.optText(cells, 3),
    changed_by: d.optId(cells, 4, null),
  };
}

function encodeTracked(e: Encoder, row: StoredTracked): Tuple {
  return trimmed([
    e.ref(row.tracked_keyword_id, 'tracked'),
    e.ref(row.project_id, null),
    e.ref(row.keyword_id, 'keyword'),
    row.location_id,
    minutesOf(row.created_at),
    row.language_code === DEFAULT_LANGUAGE ? 0 : row.language_code,
    Encoder.code(row.device, DEVICES),
    row.priority === DEFAULT_PRIORITY ? 0 : row.priority,
    Encoder.code(row.intent, INTENTS),
    Encoder.optCode(row.intent_source, INTENT_SOURCES),
    Encoder.code(row.funnel_stage, FUNNEL_STAGES),
    Encoder.code(row.frequency, FREQUENCIES),
    Encoder.code(row.source, SOURCES),
    row.is_active ? 0 : 1,
    row.deleted_at === null ? 0 : minutesOf(row.deleted_at) + 1,
    row.updated_at === row.created_at ? 0 : minutesOf(row.updated_at) + 1,
    row.business_value ?? 0,
    e.optRef(row.schedule_id, 'schedule'),
    Encoder.optCode(row.os, OS_VALUES),
    e.optRef(row.created_by, null),
    isDefaultVersions(row) ? 0 : row.versions.map((version) => encodeVersion(e, version)),
  ]);
}

function decodeTracked(d: Decoder, cells: Tuple): StoredTracked {
  const trackedKeywordId = d.id(d.number(cells, 0), 'tracked');
  const fixture = MOCK_TRACKED_KEYWORDS.find((f) => f.tracked_keyword_id === trackedKeywordId);
  const target = fixture?.versions[0]?.target_url ?? null;
  const createdAt = d.time(cells, 4);
  const deleted = d.number(cells, 14);
  const updated = d.number(cells, 15);
  const priority = d.number(cells, 7);
  const createdBy = d.optId(cells, 19, null);
  const versions = cells[20] === undefined || cells[20] === 0 ? null : d.tuple(cells, 20);
  return {
    tracked_keyword_id: trackedKeywordId,
    project_id: d.id(d.number(cells, 1), null),
    keyword_id: d.id(d.number(cells, 2), 'keyword'),
    location_id: d.number(cells, 3),
    created_at: createdAt,
    language_code: d.optText(cells, 5) ?? DEFAULT_LANGUAGE,
    device: d.code(cells, 6, DEVICES),
    priority: priority === 0 ? DEFAULT_PRIORITY : priority,
    intent: d.code(cells, 8, INTENTS),
    intent_source: d.optCode(cells, 9, INTENT_SOURCES),
    funnel_stage: d.code(cells, 10, FUNNEL_STAGES),
    frequency: d.code(cells, 11, FREQUENCIES),
    source: d.code(cells, 12, SOURCES),
    is_active: d.number(cells, 13) === 0,
    deleted_at: deleted === 0 ? null : timeOf(deleted - 1),
    updated_at: updated === 0 ? createdAt : timeOf(updated - 1),
    business_value: d.optText(cells, 16),
    schedule_id: d.optId(cells, 17, 'schedule'),
    os: d.optCode(cells, 18, OS_VALUES),
    created_by: createdBy,
    versions:
      versions === null
        ? [
            {
              depth_profile: 'standard',
              target_url: target,
              valid_from: createdAt,
              change_reason: null,
              changed_by: createdBy,
            },
          ]
        : versions.map((version) => {
            if (!Array.isArray(version)) throw new CookieShapeError();
            return decodeVersion(d, version);
          }),
  };
}

// Groups: [number, project, name, created, parent]

function encodeGroup(e: Encoder, row: StoredGroup): Tuple {
  return trimmed([
    e.ref(row.group_id, 'group'),
    e.ref(row.project_id, null),
    row.name,
    minutesOf(row.created_at),
    e.optRef(row.parent_id, 'group'),
  ]);
}

function decodeGroup(d: Decoder, cells: Tuple): StoredGroup {
  return {
    group_id: d.id(d.number(cells, 0), 'group'),
    project_id: d.id(d.number(cells, 1), null),
    name: d.text(cells, 2),
    created_at: d.time(cells, 3),
    parent_id: d.optId(cells, 4, 'group'),
  };
}

// Settings: [device, depth, frequency, weight scheme, volume mode], each its index plus one or 0 for unset

function encodeSettings(settings: StoredSeoSettings): Tuple {
  return trimmed([
    Encoder.optCode(settings.default_device, SETTING_DEVICES),
    Encoder.optCode(settings.default_depth_profile, DEPTH_PROFILES),
    Encoder.optCode(settings.default_frequency, SETTING_FREQUENCIES),
    Encoder.optCode(settings.visibility_weight_scheme, WEIGHT_SCHEMES),
    Encoder.optCode(settings.visibility_volume_mode, VOLUME_MODES),
  ]);
}

function decodeSettings(d: Decoder, cells: Tuple): StoredSeoSettings {
  const device = d.optCode(cells, 0, SETTING_DEVICES);
  const depth = d.optCode(cells, 1, DEPTH_PROFILES);
  const frequency = d.optCode(cells, 2, SETTING_FREQUENCIES);
  const weight = d.optCode(cells, 3, WEIGHT_SCHEMES);
  const volume = d.optCode(cells, 4, VOLUME_MODES);
  return {
    ...(device === null ? {} : { default_device: device }),
    ...(depth === null ? {} : { default_depth_profile: depth }),
    ...(frequency === null ? {} : { default_frequency: frequency }),
    ...(weight === null ? {} : { visibility_weight_scheme: weight }),
    ...(volume === null ? {} : { visibility_volume_mode: volume }),
  };
}

const nonEmpty = <T>(rows: T[]): T[] | undefined => (rows.length === 0 ? undefined : rows);

/** The changes as the cookie keeps them. */
export function encodeKeywordChanges(changes: KeywordChanges): CompactKeywordChanges {
  const e = new Encoder();
  const pair = (group: StoredMember): [number, number] => [
    e.ref(group.group_id, 'group'),
    e.ref(group.tracked_keyword_id, 'tracked'),
  ];
  const termPair = (link: StoredTermLink): [number, number] => [
    e.ref(link.term_id, 'term'),
    e.ref(link.tracked_keyword_id, 'tracked'),
  ];
  const compact: CompactKeywordChanges = {
    ...(changes.minted === undefined ? {} : { n: changes.minted }),
    k: nonEmpty((changes.keywords ?? []).map((row) => encodeKeyword(e, row))),
    t:
      changes.tracked === undefined
        ? undefined
        : {
            c: nonEmpty((changes.tracked.created ?? []).map((row) => encodeTracked(e, row))),
            m: nonEmpty((changes.tracked.edited ?? []).map((row) => encodeTracked(e, row))),
          },
    g:
      changes.groups === undefined
        ? undefined
        : {
            c: nonEmpty((changes.groups.created ?? []).map((row) => encodeGroup(e, row))),
            m: nonEmpty((changes.groups.edited ?? []).map((row) => encodeGroup(e, row))),
            d: nonEmpty((changes.groups.deleted ?? []).map((id) => e.ref(id, 'group'))),
          },
    gm:
      changes.members === undefined
        ? undefined
        : {
            a: nonEmpty((changes.members.added ?? []).map(pair)),
            r: nonEmpty((changes.members.removed ?? []).map(pair)),
          },
    tl:
      changes.terms === undefined
        ? undefined
        : {
            a: nonEmpty((changes.terms.added ?? []).map(termPair)),
            r: nonEmpty((changes.terms.removed ?? []).map(termPair)),
          },
    o: nonEmpty(
      Object.entries(changes.overrides ?? {}).map(([trackedId, rows]): [number, [number, number][]] => [
        e.ref(trackedId, 'tracked'),
        rows.map((row): [number, number] => [e.ref(row.entity_id, 'entity'), Encoder.code(row.mode, MODES)]),
      ]),
    ),
    s: nonEmpty(
      Object.entries(changes.settings ?? {}).map(([projectId, settings]): [number, Tuple] => [
        e.ref(projectId, null),
        encodeSettings(settings),
      ]),
    ),
  };
  // The table last: every reference above has been made. Members left undefined vanish in JSON.
  return { ...compact, u: nonEmpty(e.table) };
}

/** The changes the cookie keeps, or `null` when its contents do not decode. */
export function decodeKeywordChanges(compact: CompactKeywordChanges): KeywordChanges | null {
  const d = new Decoder(compact.u ?? []);
  try {
    const member = ([group, tracked]: [number, number]): StoredMember => ({
      group_id: d.id(group, 'group'),
      tracked_keyword_id: d.id(tracked, 'tracked'),
    });
    const termLink = ([term, tracked]: [number, number]): StoredTermLink => ({
      term_id: d.id(term, 'term'),
      tracked_keyword_id: d.id(tracked, 'tracked'),
    });
    const changes: KeywordChanges = {
      ...(compact.n === undefined ? {} : { minted: compact.n }),
      ...(compact.k === undefined ? {} : { keywords: compact.k.map((row) => decodeKeyword(d, row)) }),
      ...(compact.t === undefined
        ? {}
        : {
            tracked: {
              created: (compact.t.c ?? []).map((row) => decodeTracked(d, row)),
              edited: (compact.t.m ?? []).map((row) => decodeTracked(d, row)),
            },
          }),
      ...(compact.g === undefined
        ? {}
        : {
            groups: {
              created: (compact.g.c ?? []).map((row) => decodeGroup(d, row)),
              edited: (compact.g.m ?? []).map((row) => decodeGroup(d, row)),
              deleted: (compact.g.d ?? []).map((id) => d.id(id, 'group')),
            },
          }),
      ...(compact.gm === undefined
        ? {}
        : { members: { added: (compact.gm.a ?? []).map(member), removed: (compact.gm.r ?? []).map(member) } }),
      ...(compact.tl === undefined
        ? {}
        : { terms: { added: (compact.tl.a ?? []).map(termLink), removed: (compact.tl.r ?? []).map(termLink) } }),
      ...(compact.o === undefined
        ? {}
        : {
            overrides: Object.fromEntries(
              compact.o.map(([tracked, rows]) => {
                const trackedId = d.id(tracked, 'tracked');
                return [
                  trackedId,
                  rows.map(([entity, mode]): StoredOverride => ({
                    tracked_keyword_id: trackedId,
                    entity_id: d.id(entity, 'entity'),
                    mode: d.code([mode], 0, MODES),
                  })),
                ];
              }),
            ),
          }),
      ...(compact.s === undefined
        ? {}
        : {
            settings: Object.fromEntries(
              compact.s.map(([project, cells]) => [d.id(project, null), decodeSettings(d, cells)]),
            ),
          }),
    };
    return changes;
  } catch (error) {
    if (error instanceof CookieShapeError) return null;
    throw error;
  }
}
