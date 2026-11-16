import { describe, expect, it } from 'vitest';

import { EDGE_SCOPES, inScope, parseLinkScope, scopeOf } from './scopes';

describe('link scopes (spec 4)', () => {
  it('maps each placement to its scope', () => {
    expect(scopeOf('content')).toBe('editorial');
    expect(scopeOf('auto_generated')).toBe('auto_generated');
    for (const placement of ['navigation', 'header', 'footer', 'sidebar', 'breadcrumb'] as const) {
      expect(scopeOf(placement)).toBe('template');
    }
  });

  it('lists the three edge scopes in the order group cards show them', () => {
    expect(EDGE_SCOPES).toEqual(['editorial', 'auto_generated', 'template']);
  });

  it('reads the address, editorial for anything else', () => {
    expect(parseLinkScope('all')).toBe('all');
    expect(parseLinkScope('template')).toBe('template');
    expect(parseLinkScope(null)).toBe('editorial');
    expect(parseLinkScope('equity')).toBe('editorial');
  });

  it('puts every edge in All and each edge in its own scope', () => {
    expect(inScope('template', 'all')).toBe(true);
    expect(inScope('template', 'editorial')).toBe(false);
    expect(inScope('editorial', 'editorial')).toBe(true);
  });
});
