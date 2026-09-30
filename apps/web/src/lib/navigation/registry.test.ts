import { describe, expect, it } from 'vitest';

import {
  destinationOf,
  LIVE_NAVIGATION,
  NAVIGATION,
  navHref,
  visibleNavigation,
  type NavDestination,
} from './registry';
import { PERMISSION_HOLDERS, permissionsFor } from '@/mocks/factories/permissions';
import { roleValues } from '@/lib/api/types';

/** Every destination live, to test the rules on the whole list. */
const ALL_LIVE: NavDestination[] = NAVIGATION.map((item) => ({ ...item, status: 'live' }));
const keysOf = (sections: ReturnType<typeof visibleNavigation>): string[] =>
  sections.flatMap((section) => section.groups.flatMap((group) => group.items.map((item) => item.key)));

describe('the navigation registry', () => {
  it('has the 14 destinations of 11 section 1.1, in 3 sections', () => {
    expect(NAVIGATION).toHaveLength(14);
    expect(new Set(NAVIGATION.map((item) => item.section))).toEqual(new Set([1, 2, 3]));
    expect(NAVIGATION.filter((item) => item.group === 'seo').map((item) => item.key)).toEqual([
      'rankings',
      'keywords',
      'pages',
    ]);
    expect(NAVIGATION.filter((item) => item.group === 'ai')).toHaveLength(4);
  });

  it('asks only for permissions the API has', () => {
    for (const item of NAVIGATION) {
      if (item.permission !== null) expect(Object.keys(PERMISSION_HOLDERS)).toContain(item.permission);
    }
  });

  it('lists only what is live: Settings, for now', () => {
    expect(keysOf(visibleNavigation(NAVIGATION, permissionsFor('owner')))).toEqual(['settings']);
  });

  it('never shows a role a destination it cannot open', () => {
    for (const role of roleValues) {
      const permissions = permissionsFor(role);
      const shown = keysOf(visibleNavigation(ALL_LIVE, permissions));
      for (const item of ALL_LIVE) {
        const allowed = item.permission === null || permissions.includes(item.permission);
        expect(shown.includes(item.key), `${role} ${item.key}`).toBe(allowed);
      }
    }
  });

  it('drops a group whose items are all gone, label and all', () => {
    const billing = visibleNavigation(ALL_LIVE, permissionsFor('billing'));
    expect(billing.flatMap((section) => section.groups.map((group) => group.group))).toEqual([null]);
    expect(billing.map((section) => section.id)).toEqual([3]);
  });

  it('keeps the groups of the first section in order for a reader', () => {
    const [first] = visibleNavigation(ALL_LIVE, permissionsFor('viewer'));
    expect(first?.groups.map((group) => group.group)).toEqual([null, 'seo', 'ai']);
  });

  it('builds hrefs from the slugs', () => {
    const rankings = ALL_LIVE.find((item) => item.key === 'rankings');
    const overview = ALL_LIVE.find((item) => item.key === 'overview');
    if (!rankings || !overview) throw new Error('missing destinations');
    expect(navHref(rankings, 'digibranders', 'fynix')).toBe('/digibranders/fynix/seo/rankings');
    expect(navHref(overview, 'digibranders', 'fynix')).toBe('/digibranders/fynix');
  });

  it('finds the destination of a path, the deepest one, and none outside the project', () => {
    const at = (path: string): string | undefined => destinationOf(NAVIGATION, path, 'digibranders', 'fynix')?.key;
    expect(at('/digibranders/fynix')).toBe('overview');
    expect(at('/digibranders/fynix/settings/profile')).toBe('settings');
    expect(at('/digibranders/fynix/ai')).toBe('aiOverview');
    expect(at('/digibranders/fynix/ai/prompts/p_1')).toBe('prompts');
    expect(at('/digibranders/fynix/aim')).toBeUndefined();
    expect(at('/digibranders/fynixx/settings')).toBeUndefined();
  });

  it('finds no destination for the path of a planned one among the live ones', () => {
    expect(destinationOf(LIVE_NAVIGATION, '/digibranders/fynix/seo/rankings', 'digibranders', 'fynix')).toBeNull();
  });
});
