import { describe, expect, it } from 'vitest';

import { citationsLink } from './drill';
import { drillHref } from '../../../drilldown/drill-links';
import { scopeOf } from '../model/source-fixtures';
import { parseBoard, type BoardSearch } from '@/features/citations/board-state';
import { parseInspectTarget } from '@/lib/inspector/placement';

const PROJECT = { workspace: 'acme', project: 'eventus' };
const OPTIONS = { engines: null, terms: null, tracked: null } as const;
const base = (patch = {}) => drillHref('citations', scopeOf({ engines: ['gemini_web'], ...patch }), {}, PROJECT);

function queryOf(href: string | null): URLSearchParams {
  if (href === null) throw new Error('expected a link, got null');
  return new URL(href, 'http://localhost').searchParams;
}

describe('citationsLink with a cited page', () => {
  it('opens the page drawer on Cited pages, with the platform of the card', () => {
    const query = queryOf(citationsLink(base(), { tab: 'pages', owner: 'own', page: 11 }));
    expect(parseInspectTarget(query.get('inspect'))).toEqual({ type: 'cited-page', id: '11' });
    expect(query.get('platform')).toBe('gemini_web');
    expect(query.has('owner')).toBe(false);
  });

  it('is read back by the Citations page own parser as the own owner', () => {
    const search: BoardSearch = Object.fromEntries(
      queryOf(citationsLink(base(), { tab: 'pages', owner: 'own', page: 11 })).entries(),
    );
    expect(parseBoard(search, OPTIONS)).toMatchObject({ owner: 'own', platform: 'gemini_web' });
  });

  it('has no link where the Citations page cannot show the scope', () => {
    expect(citationsLink(base({ country: 'DE' }), { tab: 'pages', owner: 'own', page: 11 })).toBeNull();
  });
});
