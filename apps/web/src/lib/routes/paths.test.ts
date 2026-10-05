import { describe, expect, it } from 'vitest';

import { costsPath, projectPath, rankingsImportPath, rankingsPath, runsPath, withQuery } from './paths';

describe('Rankings paths', () => {
  it('names Rankings and the import over it, with the slugs encoded', () => {
    expect(rankingsPath('digibranders', 'fynix')).toBe('/digibranders/fynix/seo/rankings');
    expect(rankingsImportPath('digibranders', 'fynix')).toBe('/digibranders/fynix/seo/rankings/import');
    expect(rankingsPath('a b', 'c/d')).toBe('/a%20b/c%2Fd/seo/rankings');
    expect(rankingsPath('w', 'p')).toBe(projectPath('w', 'p', '/seo/rankings'));
  });

  it('names the workspace pages Costs and Runs, with the slug encoded', () => {
    expect(costsPath('digibranders')).toBe('/digibranders/costs');
    expect(runsPath('digibranders')).toBe('/digibranders/ops/runs');
    expect(costsPath('a b')).toBe('/a%20b/costs');
  });

  it('keeps the query string of the page, and adds none when there is none', () => {
    expect(withQuery(rankingsPath('w', 'p'), 'q=seo&archived=true')).toBe('/w/p/seo/rankings?q=seo&archived=true');
    expect(withQuery(rankingsPath('w', 'p'), '')).toBe('/w/p/seo/rankings');
  });
});
