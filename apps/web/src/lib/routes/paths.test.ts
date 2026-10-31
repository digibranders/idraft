import { describe, expect, it } from 'vitest';

import { costsPath, projectPath, queryOf, rankingsImportPath, rankingsPath, runsPath, withQuery } from './paths';

describe('Rankings paths', () => {
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
