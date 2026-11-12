import { describe, expect, it } from 'vitest';

import { EVENTUS_WORLD } from './ai-prompt-world';
import { FIRST_MINTED, mockIdNumber } from './mock-ids';

const world = EVENTUS_WORLD;

describe('the Eventus Security world of entities and topics', () => {
  it('has the brand and eight competitors, each with its aliases and domain', () => {
    expect(world.entities).toHaveLength(9);
    expect(world.entities.map((entity) => entity.canonical_name)).toContain('Eventus Security');
    const roles = world.roles.map((role) => role.role);
    expect(roles.filter((role) => role === 'own')).toHaveLength(1);
    expect(roles.filter((role) => role === 'competitor')).toHaveLength(8);
    expect(world.roles.every((role) => role.project_id === world.projectId)).toBe(true);
    for (const entity of world.entities) {
      expect(world.aliases.some((alias) => alias.entity_id === entity.entity_id)).toBe(true);
      expect(world.domains.some((domain) => domain.entity_id === entity.entity_id)).toBe(true);
    }
    expect(world.domains.find((domain) => domain.entity_id === world.brandId)?.host).toBe('eventussecurity.com');
  });

  it('gives every competitor its own colour after the brand', () => {
    const own = world.roles.find((role) => role.role === 'own');
    expect(own).toMatchObject({ is_primary: true, color_index: 1 });
    const colours = world.roles.filter((role) => role.role === 'competitor').map((role) => role.color_index);
    expect(colours).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('marks the ambiguous competitor and its hints', () => {
    const darkwatch = world.entities.find((entity) => entity.canonical_name === 'Darkwatch SOC');
    expect(darkwatch).toMatchObject({ is_ambiguous: true });
    expect(darkwatch?.disambiguation_hints).toEqual(['soc', 'security', 'mdr']);
  });

  it('has a hierarchical topic vocabulary of the project, two levels deep', () => {
    expect(world.vocabulary).toMatchObject({ kind: 'topic', project_id: world.projectId, is_hierarchical: true });
    const parents = world.terms.filter((term) => term.parent_id === undefined);
    expect(parents).toHaveLength(7);
    expect(world.terms).toHaveLength(7 + 22);
    for (const term of world.terms) {
      expect(term.vocabulary_id).toBe(world.vocabulary.vocabulary_id);
      if (term.parent_id !== undefined) expect(parents.map((parent) => parent.term_id)).toContain(term.parent_id);
    }
    expect(world.termIdOf('soc-for-banks')).toBeDefined();
  });

  it('keeps its ids among the fixtures, below the numbers a browser mints', () => {
    for (const entity of world.entities) expect(mockIdNumber(entity.entity_id, 'entity')).toBeLessThan(FIRST_MINTED);
    for (const alias of world.aliases) expect(mockIdNumber(alias.alias_id, 'alias')).toBeLessThan(FIRST_MINTED);
    for (const domain of world.domains)
      expect(mockIdNumber(domain.entity_domain_id, 'domain')).toBeLessThan(FIRST_MINTED);
    for (const term of world.terms) expect(mockIdNumber(term.term_id, 'term')).toBeLessThan(FIRST_MINTED);
    // The ids Fynix and Cleanstart use stay theirs
    expect(Math.min(...world.entities.map((entity) => mockIdNumber(entity.entity_id, 'entity') ?? 0))).toBeGreaterThan(
      10,
    );
    expect(Math.min(...world.aliases.map((alias) => mockIdNumber(alias.alias_id, 'alias') ?? 0))).toBeGreaterThan(17);
    expect(
      Math.min(...world.domains.map((domain) => mockIdNumber(domain.entity_domain_id, 'domain') ?? 0)),
    ).toBeGreaterThan(10);
    expect(Math.min(...world.terms.map((term) => mockIdNumber(term.term_id, 'term') ?? 0))).toBeGreaterThan(9);
  });
});
