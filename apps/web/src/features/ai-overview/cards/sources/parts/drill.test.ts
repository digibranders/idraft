import { describe, expect, it } from 'vitest';

import { citationsLink } from './drill';
import { drillHref } from '../../../drilldown/drill-links';
import { scopeOf } from '../model/source.test-fixtures';
import { parseBoard, type BoardSearch } from '@/features/citations/board-state';
import { parseInspectTarget } from '@/lib/inspector/placement';

const PROJECT = { workspace: 'acme', project: 'eventus' };
const OPTIONS = { engines: null, terms: null, tracked: null } as const;

/** The query of a link, as the page it opens reads it. */
function queryOf(href: string | null): URLSearchParams {
  if (href === null) throw new Error('expected a link, got null');
  return new URL(href, 'http://localhost').searchParams;
}
const pathOf = (href: string | null): string => new URL(href ?? '', 'http://localhost').pathname;
const searchOf = (query: URLSearchParams): BoardSearch => Object.fromEntries(query.entries());

const base = (patch = {}) => drillHref('citations', scopeOf({ engines: ['gemini_web'], ...patch }), {}, PROJECT);

describe('citationsLink (WP-77)', () => {
  it('opens Cited pages with the owner of the card, and the page drawer of a page', () => {
    const href = citationsLink(base(), { tab: 'pages', owner: 'third_party', page: 42 });
    const query = queryOf(href);
    expect(pathOf(href)).toBe('/acme/eventus/ai/citations');
    expect(parseBoard(searchOf(query), OPTIONS).owner).toBe('third');
    expect(query.get('inspect')).toBe('cited-page:42');
    expect(parseInspectTarget(query.get('inspect'))).toEqual({ type: 'cited-page', id: '42' });
  });

  it('keeps the platform of the card and is read back by the Citations page own parser', () => {
    const href = citationsLink(base(), { tab: 'pages', owner: 'competitor' });
    expect(parseBoard(searchOf(queryOf(href)), OPTIONS)).toMatchObject({ platform: 'gemini_web', owner: 'competitor' });
  });

  it('writes no platform for several engines, and carries no date window or comparison', () => {
    const query = queryOf(
      citationsLink(base({ engines: ['chatgpt_web', 'gemini_web'], compare: false }), { tab: 'pages' }),
    );
    expect(query.has('platform')).toBe(false);
    for (const key of ['from', 'to', 'win', 'cmp', 'engine', 'tab', 'role', 'kind']) expect(query.has(key)).toBe(false);
  });

  it('writes nothing for the own owner, the default', () => {
    expect(queryOf(citationsLink(base(), { tab: 'pages', owner: 'own' })).has('owner')).toBe(false);
  });

  it('writes no drawer without a page', () => {
    expect(queryOf(citationsLink(base(), { tab: 'pages', owner: 'own' })).has('inspect')).toBe(false);
  });

  it('opens the gap analysis on its own route', () => {
    expect(pathOf(citationsLink(base(), { tab: 'gaps' }))).toBe('/acme/eventus/ai/citations/gaps');
  });

  it('has no link where the Citations page cannot show the scope: a country, branded prompts', () => {
    expect(citationsLink(base({ country: 'DE' }), { tab: 'pages' })).toBeNull();
    expect(citationsLink(base({ branded: 'only' }), { tab: 'pages' })).toBeNull();
    expect(citationsLink(base({ branded: 'included' }), { tab: 'pages' })).toBeNull();
  });

  it('still links from a window the Overview takes and the other pages do not (the page reads runs)', () => {
    const long = base({ range: { from: '2026-08-01', to: '2026-11-12', days: 104 } });
    expect(pathOf(citationsLink(long, { tab: 'pages' }))).toBe('/acme/eventus/ai/citations');
  });

  it('stays null where the scope cannot be shown', () => {
    expect(citationsLink(null, { tab: 'pages' })).toBeNull();
  });
});
