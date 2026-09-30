/**
 * A retired card type (spec section 6.4): it stays in the catalog for one release, so layouts that hold it
 * still render it, and nobody can add it. No shipped type is retired yet, so the catalog is mocked here.
 */
import { describe, expect, it, vi } from 'vitest';
import type * as Catalog from './catalog';

const RETIRED = 'seo.serp_features';

vi.mock('./catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof Catalog>();
  return {
    ...actual,
    cardType: (key: string) => {
      const type = actual.cardType(key);
      return type && key === RETIRED ? { ...type, status: 'retired' as const } : type;
    },
  };
});

const { addCard, canAddCard, hideCard, resolveLayout, sanitizeLayout } = await import('./index');
const { SCREENS } = await import('./catalog');

describe('a retired card type', () => {
  const stored = { schema: 1, numbers: [], cards: [{ id: 'kept', type: RETIRED, width: 'third' }] };

  it('still renders where a layout already holds it', () => {
    expect(sanitizeLayout(stored, 'overview')).toEqual({ document: stored, changed: false });
    expect(resolveLayout({ personal: stored, team: null }, 'overview').document.cards?.[0]?.type).toBe(RETIRED);
  });

  it('cannot be added, and can still be hidden', () => {
    const builtin = structuredClone(SCREENS.overview.builtin);
    expect(canAddCard(builtin, RETIRED, 'overview')).toBe(false);
    expect(addCard(builtin, RETIRED, 'new')).toBe(builtin);
    expect(hideCard(sanitizeLayout(stored, 'overview').document, 'kept').cards).toEqual([]);
  });
});
