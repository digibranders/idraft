import { describe, expect, it } from 'vitest';

import { competitor, id, own, projectEntity, summaryOf } from './summary-fixtures';
import { colorSlots, trackedSetNote, trackedSetOf, weekOf } from './tracked-set';

const ROWS = [
  projectEntity(1, 'Fynix', { role: 'own', colorIndex: 1 }),
  projectEntity(2, 'HubSpot', { colorIndex: 2, addedAt: '2026-01-05T09:00:00Z' }),
  projectEntity(3, 'Zoho', { colorIndex: 3, addedAt: '2026-11-04T10:00:00Z' }),
];

describe('trackedSetOf', () => {
  it('names you and the competitors once', () => {
    const summary = summaryOf({
      entities: [competitor(2, 'HubSpot'), own(), competitor(3, 'Zoho'), competitor(2, 'HubSpot')],
    });
    const set = trackedSetOf(summary, ROWS);
    expect(set.entities.map((entity) => entity.name)).toEqual(['Fynix', 'HubSpot', 'Zoho']);
    expect(set.entities.map((entity) => entity.role)).toEqual(['own', 'competitor', 'competitor']);
    expect(set.entities.map((entity) => entity.colorIndex)).toEqual([1, 2, 3]);
  });

  it('watch and removed entities are not in the set', () => {
    const rows = [
      ...ROWS,
      projectEntity(4, 'Pipedrive', { role: 'watch' }),
      projectEntity(5, 'Salesforce', { removedAt: '2026-10-01T00:00:00Z' }),
    ];
    const set = trackedSetOf(summaryOf(), rows);
    expect(set.entities.map((entity) => entity.entityId)).toEqual([id(1), id(2), id(3)]);
  });

  it('changed is true only with more than one entity config version', () => {
    expect(trackedSetOf(summaryOf({ versions: [3] }), ROWS).changed).toBe(false);
    expect(trackedSetOf(summaryOf({ versions: [] }), ROWS).changed).toBe(false);
    expect(trackedSetOf(summaryOf({ versions: [3, 4] }), ROWS).changed).toBe(true);
  });

  it('a boundary sits on the Monday week that holds a competitor added inside the window', () => {
    const set = trackedSetOf(summaryOf({ versions: [1, 2] }), ROWS);
    expect(set.boundaries).toEqual([{ entityId: id(3), name: 'Zoho', addedOn: '2026-11-04', weekStart: '2026-11-02' }]);
    expect(set.addedInWindow).toEqual([{ entityId: id(3), name: 'Zoho', addedOn: '2026-11-04' }]);
  });

  it('a competitor added before the window has no boundary and no date in the footnote list', () => {
    const rows = [...ROWS.slice(0, 2), projectEntity(3, 'Zoho', { addedAt: '2026-10-15T23:00:00Z' })];
    const set = trackedSetOf(summaryOf({ versions: [1, 2] }), rows);
    expect(set.changed).toBe(true);
    expect(set.boundaries).toEqual([]);
    expect(set.addedInWindow).toEqual([]);
  });

  it('a set that did not change has no boundary even when a date is inside the window', () => {
    const set = trackedSetOf(summaryOf({ versions: [1] }), ROWS);
    expect(set.boundaries).toEqual([]);
    expect(set.addedInWindow).toEqual([]);
  });

  it('without the entities read a changed set has no boundary and no dates', () => {
    const set = trackedSetOf(summaryOf({ versions: [1, 2] }), null);
    expect(set.changed).toBe(true);
    expect(set.boundaries).toEqual([]);
    expect(set.addedInWindow).toEqual([]);
    expect(set.entities.every((entity) => entity.addedAt === null && entity.colorIndex === null)).toBe(true);
  });

  it('the day a competitor was added is read in the project zone', () => {
    // 23:30 UTC on Sunday 8 November is already Monday 9 November in Kolkata
    const rows = [...ROWS.slice(0, 2), projectEntity(3, 'Zoho', { addedAt: '2026-11-08T23:30:00Z' })];
    const kolkata = summaryOf({
      versions: [1, 2],
      window: { from: '2026-10-16', to: '2026-11-12', timezone: 'Asia/Kolkata' },
    });
    expect(trackedSetOf(kolkata, rows).boundaries[0]).toMatchObject({ addedOn: '2026-11-09', weekStart: '2026-11-09' });
    expect(trackedSetOf(summaryOf({ versions: [1, 2] }), rows).boundaries[0]).toMatchObject({
      addedOn: '2026-11-08',
      weekStart: '2026-11-02',
    });
  });
});

describe('weekOf', () => {
  it('is the Monday of the week, a Sunday belonging to the week before', () => {
    expect(weekOf('2026-11-09T12:00:00Z', 'UTC')).toBe('2026-11-09');
    expect(weekOf('2026-11-08T12:00:00Z', 'UTC')).toBe('2026-11-02');
    expect(weekOf('2026-11-12T12:00:00Z', 'UTC')).toBe('2026-11-09');
  });

  it('the week of a day near midnight is read in the project zone', () => {
    expect(weekOf('2026-11-15T23:30:00Z', 'UTC')).toBe('2026-11-09');
    expect(weekOf('2026-11-15T23:30:00Z', 'Asia/Kolkata')).toBe('2026-11-16');
    expect(weekOf('2026-11-16T03:00:00Z', 'America/Los_Angeles')).toBe('2026-11-09');
  });
});

describe('trackedSetNote', () => {
  it('counts the competitors and carries the changed flag and the added dates', () => {
    const set = trackedSetOf(summaryOf({ versions: [1, 2] }), ROWS);
    expect(trackedSetNote(set)).toEqual({
      competitors: 2,
      changed: true,
      added: [{ entityId: id(3), name: 'Zoho', addedOn: '2026-11-04' }],
    });
  });
});

describe('colorSlots', () => {
  it('own is slot 1, a competitor keeps its index, one without takes the next free slot in name order', () => {
    const summary = summaryOf({
      entities: [own(), competitor(2, 'Zoho'), competitor(3, 'Asana'), competitor(4, 'Monday')],
    });
    const rows = [
      projectEntity(1, 'Fynix', { role: 'own' }),
      projectEntity(2, 'Zoho', { colorIndex: 2 }),
      projectEntity(3, 'Asana'),
      projectEntity(4, 'Monday'),
    ];
    const slots = colorSlots(trackedSetOf(summary, rows));
    expect([...slots.entries()]).toEqual([
      [id(1), 1],
      [id(2), 2],
      [id(3), 3],
      [id(4), 4],
    ]);
  });

  it('a seventh and later brand has no slot', () => {
    const entities = [own(), ...[2, 3, 4, 5, 6, 7, 8].map((n) => competitor(n, `Brand ${n}`))];
    const slots = colorSlots(trackedSetOf(summaryOf({ entities }), null));
    expect(slots.size).toBe(6);
    expect(slots.has(id(7))).toBe(false);
    expect(slots.has(id(8))).toBe(false);
  });
});
