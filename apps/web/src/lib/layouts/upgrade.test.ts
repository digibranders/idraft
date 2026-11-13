/**
 * Raising an older stored document to the current schema on read (spec section 6.4, WB-LAY-07).
 */
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA, UPGRADE_STEPS, resolveLayout, upgradeDocument, type UpgradeStep } from './index';

const TO_SCHEMA_2: UpgradeStep = (document) => ({ ...document, schema: 2 });
const TO_SCHEMA_3: UpgradeStep = (document) => ({ ...document, schema: 3, upgraded: true });

describe('upgradeDocument', () => {
  it('knows the current schema from its steps', () => {
    expect(CURRENT_SCHEMA).toBe(UPGRADE_STEPS.length + 1);
  });

  it('returns a document of the current schema as the same object', () => {
    const document = { schema: 1, numbers: [], cards: [] };
    expect(upgradeDocument(document)).toBe(document);
  });

  it('returns anything that is not an upgradable document as it came', () => {
    const odd: unknown[] = [
      null,
      undefined,
      'x',
      7,
      [],
      {},
      { schema: 2 },
      { schema: 1.5 },
      { schema: '1' },
      { schema: 0 },
    ];
    for (const value of odd) expect(upgradeDocument(value)).toBe(value);
  });

  it('applies one step per version, in order', () => {
    expect(upgradeDocument({ schema: 1, cards: [] }, [TO_SCHEMA_2])).toEqual({ schema: 2, cards: [] });
    expect(upgradeDocument({ schema: 1 }, [TO_SCHEMA_2, TO_SCHEMA_3])).toEqual({ schema: 3, upgraded: true });
    expect(upgradeDocument({ schema: 2 }, [TO_SCHEMA_2, TO_SCHEMA_3])).toEqual({ schema: 3, upgraded: true });
  });

  it('does not change the document it was given', () => {
    const document = { schema: 1, cards: [] };
    upgradeDocument(document, [TO_SCHEMA_2]);
    expect(document).toEqual({ schema: 1, cards: [] });
  });

  it('returns a newer document as given', () => {
    const newer = { schema: 3, cards: [] };
    expect(upgradeDocument(newer, [TO_SCHEMA_2])).toBe(newer);
  });

  it('returns the document as given when a step is missing, and when a step does not raise the schema', () => {
    const document = { schema: 1 };
    expect(upgradeDocument(document, [])).toBe(document);
    const lost = { schema: 1, cards: [] };
    expect(upgradeDocument(lost, [(d) => d])).toBe(lost);
  });
});

// shortcut: UPGRADE_STEPS is empty, so these cases cannot show that resolveLayout calls upgradeDocument; the first
// real step (schema 2) adds a case where a schema 1 value is upgraded and resolves as personal
describe('resolveLayout and the schema of a stored value', () => {
  const team = { schema: 1, numbers: [], cards: [{ id: 'team-card', type: 'seo.rank_distribution', width: 'third' }] };

  it('counts a personal value of a newer schema absent, so the team default shows', () => {
    const resolved = resolveLayout({ personal: { schema: CURRENT_SCHEMA + 1, cards: [] }, team }, 'overview');
    expect(resolved.source).toBe('team');
    expect(resolved.document.cards?.map((card) => card.id)).toEqual(['team-card']);
  });

  it('still uses a personal value of the current schema', () => {
    const personal = { schema: 1, numbers: [], cards: [{ id: 'mine', type: 'seo.rank_distribution', width: 'half' }] };
    expect(resolveLayout({ personal, team }, 'overview').source).toBe('personal');
  });
});
