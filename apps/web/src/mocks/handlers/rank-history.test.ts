import { describe, expect, it } from 'vitest';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { KEYWORD_TABLE } from '../keyword-table';
import { mockId } from '../mock-ids';
import { RANK_HISTORY } from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('The Fynix project fixture is missing');
const P = `${W}/projects/${fynix.project_id}`;

const trackedId = (text: string): string => {
  const index = KEYWORD_TABLE.findIndex(
    (row) => row.text === text && row.location === 2276 && row.device === 'desktop',
  );
  if (index < 0) throw new Error(`No fixture row for ${text}`);
  return mockId('tracked', index + 1);
};

describe('Rank history handler', () => {
  it('answers rank history for a tracked keyword', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(res.status).toBe(200);

    const history = dataOf(res, RANK_HISTORY);
    expect(history.tracked_keyword_id).toBe(id);
    expect(history.window.timezone).toBe(fynix.timezone);
    expect(history.summary.checks).toBeGreaterThan(0);
    expect(history.summary.ranked_checks + history.summary.beyond_depth_checks).toBe(history.summary.checks);
    expect(history.summary.failed_checks).toBe(0);
    expect(history.summary.average_rank).toBeNull();

    // Series 0 is the own entity
    const series = history.series ?? [];
    expect(series.length).toBeGreaterThanOrEqual(1);
    const [own, ...competitors] = series;
    expect(own?.entity.role).toBe('own');
    expect(own?.points.length).toBe(history.summary.checks);
    expect(own?.points.length).toBeLessThanOrEqual(30);

    // Each point has state, date in project timezone
    for (const point of own?.points ?? []) {
      expect(['ranked', 'beyond_depth']).toContain(point.state);
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (point.state === 'ranked') {
        expect(point.rank).toBeGreaterThanOrEqual(1);
      } else {
        expect(point.rank).toBeNull();
      }
    }

    // Effective competitors follow
    for (const comp of competitors) {
      expect(['competitor', 'watch']).toContain(comp.entity.role);
    }

    // Bands for consecutive beyond_depth runs
    for (const band of history.bands) {
      expect(band.kind).toBe('beyond_depth');
      expect(band.entity_id).toBe(own?.entity.entity_id);
      expect(band.label).toMatch(/^Not in top \d+$/);
      expect(band.from <= band.to).toBe(true);
    }
  });

  it('accepts format=columns and include parameters', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const res = await browser.call(
      'GET',
      `${P}/tracked-keywords/${id}/rank-history?format=columns&include=absolute,url,events`,
    );
    expect(res.status).toBe(200);
    const history = dataOf(res, RANK_HISTORY);
    expect(history.columns).toBeNull();
    expect(history.events).toBeNull();
  });

  it('returns 422 validation_failed when window is invalid', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?window=last_400d`);
    expect(res.status).toBe(422);
    expect(res.code).toBe('validation_failed');
    expect(fieldCodes(res)).toContain('window:value_error');
  });

  it('returns 404 for an unknown keyword', async () => {
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/unknown-id/rank-history`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for a member without data:read', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('billing');
    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(res.status).toBe(403);
  });
});
