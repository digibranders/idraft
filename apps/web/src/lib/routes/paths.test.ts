import { describe, expect, it } from 'vitest';

import {
  budgetsPath,
  costsPath,
  keywordDetailPath,
  integrationsPath,
  projectPath,
  queryOf,
  rankingsImportPath,
  rankingsPath,
  runsPath,
  withQuery,
} from './paths';

describe('Rankings paths', () => {
  it('names the page of one tracked keyword under Keywords, with the slugs encoded', () => {
    const id = '0192f0a1-3c44-7e10-9b1d-1f2a3b4c5d6e';
    expect(keywordDetailPath('acme', 'fynix', id)).toBe(`/acme/fynix/seo/keywords/${id}`);
    expect(keywordDetailPath('a b', 'c/d', id)).toBe(`/a%20b/c%2Fd/seo/keywords/${id}`);
    // The id is a path segment too: nothing in it can add a segment
    expect(keywordDetailPath('w', 'p', 'a b/c')).toBe('/w/p/seo/keywords/a%20b%2Fc');
  });

  it('names the one Google page of Integrations, with the slugs encoded', () => {
    expect(integrationsPath('digibranders', 'fynix')).toBe('/digibranders/fynix/integrations/google');
    expect(integrationsPath('a b', 'c/d')).toBe('/a%20b/c%2Fd/integrations/google');
  });

  it('names Rankings and the import over it, with the slugs encoded', () => {
    expect(rankingsPath('digibranders', 'fynix')).toBe('/digibranders/fynix/seo/keywords');
    expect(rankingsImportPath('digibranders', 'fynix')).toBe('/digibranders/fynix/seo/keywords/import');
    expect(rankingsPath('a b', 'c/d')).toBe('/a%20b/c%2Fd/seo/keywords');
    expect(rankingsPath('w', 'p')).toBe(projectPath('w', 'p', '/seo/keywords'));
  });

  it('names Costs and Runs inside a project when one is given, with the slugs encoded', () => {
    expect(costsPath('digibranders', 'fynix')).toBe('/digibranders/fynix/costs');
    expect(runsPath('digibranders', 'fynix')).toBe('/digibranders/fynix/ops/runs');
    expect(runsPath('w', 'a b')).toBe('/w/a%20b/ops/runs');
    expect(costsPath('w', 'p')).toBe(projectPath('w', 'p', '/costs'));
    expect(runsPath('w', 'p')).toBe(projectPath('w', 'p', '/ops/runs'));
  });

  it('names Budgets and usage inside a project, or as the workspace page without one', () => {
    expect(budgetsPath('digibranders', 'fynix')).toBe('/digibranders/fynix/settings/budgets');
    expect(budgetsPath('digibranders')).toBe('/digibranders/settings/budgets');
    expect(budgetsPath('a b', 'c/d')).toBe('/a%20b/c%2Fd/settings/budgets');
  });

  it('keeps the workspace pages for a member who can open no project', () => {
    expect(costsPath('digibranders')).toBe('/digibranders/costs');
    expect(runsPath('digibranders')).toBe('/digibranders/ops/runs');
    expect(costsPath('a b')).toBe('/a%20b/costs');
    expect(costsPath('digibranders', undefined)).toBe('/digibranders/costs');
  });

  it('writes the query of a page for a redirect, in order, repeated keys kept and the omitted ones left out', () => {
    expect(queryOf({})).toBe('');
    expect(queryOf({ month: '2026-09', status: 'completed,failed', tab: undefined })).toBe(
      'month=2026-09&status=completed%2Cfailed',
    );
    expect(queryOf({ a: ['1', '2'], b: 'x y' })).toBe('a=1&a=2&b=x+y');
    expect(queryOf({ project: 'fynix', month: '2026-09' }, ['project'])).toBe('month=2026-09');
    expect(queryOf({ project: 'fynix' }, ['project'])).toBe('');
  });

  it('keeps the query string of the page, and adds none when there is none', () => {
    expect(withQuery(rankingsPath('w', 'p'), 'q=seo&archived=true')).toBe('/w/p/seo/keywords?q=seo&archived=true');
    expect(withQuery(rankingsPath('w', 'p'), '')).toBe('/w/p/seo/keywords');
  });
});
