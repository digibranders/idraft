import { TZDate } from '@date-fns/tz';

import type { AddedEntity, SetBoundary, TrackedEntity, TrackedSet } from './types';
import type { ProjectEntity, PromptsSummary } from '@/lib/api/types';

/** The palette has six slots (`chart-1` to `chart-6`); own is slot 1 (DS 15 rule 12). */
const SLOTS = 6;

const pad = (value: number): string => String(value).padStart(2, '0');

/** The calendar day of an ISO time in a zone, `YYYY-MM-DD`. */
function dayOf(instant: string, zone: string): string {
  const time = Date.parse(instant);
  if (Number.isNaN(time)) throw new RangeError(`Not a date: ${instant}`);
  const day = new TZDate(time, zone);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** The Monday on or before a `YYYY-MM-DD` day. */
function mondayOf(day: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (parts === null) throw new RangeError(`Not a day: ${day}`);
  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/** The Monday the week holds an ISO time on, read in the project zone: the label of a weekly point. */
export function weekOf(instant: string, zone: string): string {
  return mondayOf(dayOf(instant, zone));
}

/** The rows of `GET {P}/entities` that are live, by entity: a brand removed and added again has two rows. */
function liveRows(rows: readonly ProjectEntity[] | null): Map<string, ProjectEntity> {
  const live = new Map<string, ProjectEntity>();
  for (const row of rows ?? []) {
    if (row.removed_at === null && row.role !== 'watch') live.set(row.entity.entity_id, row);
  }
  return live;
}

/**
 * The tracked set of one read. Who is in it comes from the summary (the own brand and the competitors Share of
 * voice is computed over; watched and removed brands are not in it); the colour slot and the day a brand joined
 * come from the entities read and stay `null` without it, never invented. A boundary exists only when the summary
 * says the set changed inside the window (`entity_config_versions`), and only for a competitor whose `added_at`
 * falls inside that window, read in the project zone.
 */
export function trackedSetOf(summary: PromptsSummary, rows: readonly ProjectEntity[] | null): TrackedSet {
  const live = liveRows(rows);
  const seen = new Set<string>();
  const entities: TrackedEntity[] = [];
  for (const entity of summary.entities) {
    if (seen.has(entity.entity_id)) continue;
    seen.add(entity.entity_id);
    const row = live.get(entity.entity_id);
    entities.push({
      entityId: entity.entity_id,
      name: entity.name,
      role: entity.role,
      colorIndex: row?.color_index ?? null,
      addedAt: row?.added_at ?? null,
    });
  }
  // Own first; the sort is stable, so the competitors keep the order of the summary
  entities.sort((a, b) => Number(b.role === 'own') - Number(a.role === 'own'));

  const changed = summary.entity_config_versions.length > 1;
  const { from, to, timezone } = summary.window;
  const added: AddedEntity[] = [];
  if (changed) {
    for (const entity of entities) {
      if (entity.role !== 'competitor' || entity.addedAt === null || Number.isNaN(Date.parse(entity.addedAt))) continue;
      const addedOn = dayOf(entity.addedAt, timezone);
      if (addedOn >= from && addedOn <= to) added.push({ entityId: entity.entityId, name: entity.name, addedOn });
    }
    added.sort((a, b) => a.addedOn.localeCompare(b.addedOn) || a.name.localeCompare(b.name));
  }
  const boundaries: SetBoundary[] = added.map((entry) => ({ ...entry, weekStart: mondayOf(entry.addedOn) }));
  return { entities, changed, boundaries, addedInWindow: added };
}

/** What the footnote of a share of voice chart says of the set: "you and 5 competitors", and what was added. */
export function trackedSetNote(set: TrackedSet): { competitors: number; changed: boolean; added: AddedEntity[] } {
  return {
    competitors: set.entities.filter((entity) => entity.role === 'competitor').length,
    changed: set.changed,
    added: set.addedInWindow,
  };
}

/**
 * The palette slot of each brand that has one, ascending by slot. Own is slot 1. A competitor keeps the
 * `color_index` the project gave it (2 to 6, not taken yet); one without takes the next free slot in name order.
 * A seventh and later brand has no slot: the charts fold it into "Other tracked" or leave it out (D-10).
 */
export function colorSlots(set: TrackedSet): ReadonlyMap<string, number> {
  const slots = new Map<string, number>();
  const taken = new Set<number>([1]);
  const unplaced: TrackedEntity[] = [];
  for (const entity of set.entities) {
    if (entity.role === 'own') {
      slots.set(entity.entityId, 1);
      continue;
    }
    const wanted = entity.colorIndex;
    if (wanted !== null && Number.isInteger(wanted) && wanted > 1 && wanted <= SLOTS && !taken.has(wanted)) {
      taken.add(wanted);
      slots.set(entity.entityId, wanted);
    } else {
      unplaced.push(entity);
    }
  }
  unplaced.sort((a, b) => a.name.localeCompare(b.name));
  let next = 2;
  for (const entity of unplaced) {
    while (taken.has(next)) next += 1;
    if (next > SLOTS) break;
    taken.add(next);
    slots.set(entity.entityId, next);
  }
  return new Map([...slots.entries()].sort((a, b) => a[1] - b[1]));
}
