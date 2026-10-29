import { describe, expect, it } from 'vitest';

import {
  destinationOf,
  LIVE_NAVIGATION,
  NAVIGATION,
  navHref,
  switchHref,
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
  it('has the 16 destinations of 11 section 1.1, in 3 sections', () => {
    expect(NAVIGATION).toHaveLength(16);
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

  it('lists only what is live: Keywords, Runs, Costs and Settings, for now', () => {
    expect(keysOf(visibleNavigation(NAVIGATION, permissionsFor('owner')))).toEqual([
      'keywords',
      'runs',
      'costs',
      'settings',
    ]);
  });

  it('puts Runs and Costs in the third section, after Integrations and before Settings', () => {
    const third = NAVIGATION.filter((item) => item.section === 3).map((item) => item.key);
    expect(third).toEqual(['reports', 'integrations', 'runs', 'costs', 'settings']);
    const runs = NAVIGATION.find((item) => item.key === 'runs');
    const costs = NAVIGATION.find((item) => item.key === 'costs');
    expect(runs).toMatchObject({ path: '/ops/runs', permission: 'data:read', status: 'live', group: null });
    expect(costs).toMatchObject({ path: '/costs', permission: 'costs:read', status: 'live', group: null });
  });

  it('shows Runs to a reader and Costs to those who may read costs, hiding the one the role cannot open', () => {
    const shownTo = (role: (typeof roleValues)[number]): string[] =>
      keysOf(visibleNavigation(NAVIGATION, permissionsFor(role)));
    expect(shownTo('viewer')).toEqual(['keywords', 'runs', 'settings']);
    expect(shownTo('analyst')).toEqual(['keywords', 'runs', 'costs', 'settings']);
    expect(shownTo('billing')).toEqual(['costs', 'settings']);
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
    const keywords = ALL_LIVE.find((item) => item.key === 'keywords');
    const overview = ALL_LIVE.find((item) => item.key === 'overview');
    const runs = ALL_LIVE.find((item) => item.key === 'runs');
    const costs = ALL_LIVE.find((item) => item.key === 'costs');
    if (!keywords || !overview || !runs || !costs) throw new Error('missing destinations');
    expect(navHref(keywords, 'digibranders', 'fynix')).toBe('/digibranders/fynix/seo/keywords');
    expect(navHref(overview, 'digibranders', 'fynix')).toBe('/digibranders/fynix');
    expect(navHref(runs, 'digibranders', 'fynix')).toBe('/digibranders/fynix/ops/runs');
    expect(navHref(costs, 'digibranders', 'fynix')).toBe('/digibranders/fynix/costs');
  });

  it('lets Runs and Costs carry the query of the page to another project, and no other destination', () => {
    expect(NAVIGATION.filter((item) => item.carriesQuery === true).map((item) => item.key)).toEqual(['runs', 'costs']);
  });

  describe('switchHref', () => {
    const find = (key: NavDestination['key']): NavDestination => {
      const item = ALL_LIVE.find((candidate) => candidate.key === key);
      if (!item) throw new Error(`missing destination ${key}`);
      return item;
    };

    it('keeps the month, the tab and the filters of Runs and Costs for the other project', () => {
      expect(switchHref(find('runs'), 'digibranders', 'cleanstart', '?month=2026-08&status=failed')).toBe(
        '/digibranders/cleanstart/ops/runs?month=2026-08&status=failed',
      );
      expect(switchHref(find('costs'), 'digibranders', 'cleanstart', 'month=2026-08&tab=budgets')).toBe(
        '/digibranders/cleanstart/costs?month=2026-08&tab=budgets',
      );
    });

    it('leaves out the open inspector, which belongs to one project', () => {
      expect(
        switchHref(find('runs'), 'digibranders', 'cleanstart', '?inspect=run%3A1&itab=tasks&month=2026-08&sort=cost'),
      ).toBe('/digibranders/cleanstart/ops/runs?month=2026-08&sort=cost');
      expect(switchHref(find('runs'), 'digibranders', 'cleanstart', '?inspect=run%3A1&itab=tasks')).toBe(
        '/digibranders/cleanstart/ops/runs',
      );
    });

    it('opens a destination that does not carry its query without one, and a page without a query as it is', () => {
      expect(switchHref(find('keywords'), 'digibranders', 'cleanstart', '?intent=commercial')).toBe(
        '/digibranders/cleanstart/seo/keywords',
      );
      expect(switchHref(find('keywords'), 'digibranders', 'cleanstart', '')).toBe(
        '/digibranders/cleanstart/seo/keywords',
      );
      expect(switchHref(find('runs'), 'digibranders', 'cleanstart', '')).toBe('/digibranders/cleanstart/ops/runs');
    });
  });

  it('finds the destination of a path, the deepest one, and none outside the project', () => {
    const at = (path: string): string | undefined => destinationOf(NAVIGATION, path, 'digibranders', 'fynix')?.key;
    expect(at('/digibranders/fynix')).toBe('overview');
    expect(at('/digibranders/fynix/settings/profile')).toBe('settings');
    expect(at('/digibranders/fynix/ai')).toBe('aiOverview');
    expect(at('/digibranders/fynix/ai/prompts/p_1')).toBe('prompts');
    // Runs lives below `/ops`, which is no destination of its own
    expect(at('/digibranders/fynix/ops/runs')).toBe('runs');
    expect(at('/digibranders/fynix/ops/runs/')).toBe('runs');
    expect(at('/digibranders/fynix/ops')).toBeUndefined();
    expect(at('/digibranders/fynix/costs')).toBe('costs');
    expect(at('/digibranders/fynix/costsx')).toBeUndefined();
    expect(at('/digibranders/fynix/aim')).toBeUndefined();
    expect(at('/digibranders/fynixx/settings')).toBeUndefined();
  });

  it('finds no destination for the path of a planned one among the live ones', () => {
    expect(destinationOf(LIVE_NAVIGATION, '/digibranders/fynix/seo/pages', 'digibranders', 'fynix')).toBeNull();
  });
});
