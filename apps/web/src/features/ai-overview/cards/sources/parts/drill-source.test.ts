import { describe, expect, it } from 'vitest';

import { citationsLink } from './drill';
import { drillHref } from '../../../drilldown/drill-links';
import { scopeOf } from '../model/source-fixtures';
import { parseScope as parseCitationScope, type CitationSearch } from '@/features/citations/citation-scope';
import type { EngineCode } from '@/lib/api/types';
import { parseInspectTarget } from '@/lib/inspector/placement';

const PROJECT = { workspace: 'acme', project: 'eventus' };
const ENGINES: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const base = (patch = {}) =>
  drillHref('citations', scopeOf({ engines: ['chatgpt_web', 'gemini_web'], ...patch }), {}, PROJECT);

function queryOf(href: string | null): URLSearchParams {
  if (href === null) throw new Error('expected a link, got null');
  return new URL(href, 'http://localhost').searchParams;
}

describe('citationsLink with a cited page', () => {
  it('opens the source inspector on the Pages tab, narrowed to own pages, with the scope of the card', () => {
    const href = citationsLink(base(), { tab: 'pages', role: 'own', source: 11 });
    const query = queryOf(href);
    expect(query.get('tab')).toBe('pages');
    expect(query.get('role')).toBe('own');
    expect(parseInspectTarget(query.get('inspect'))).toEqual({ type: 'source', id: '11' });
    expect(query.get('engine')).toBe('chatgpt_web,gemini_web');
  });

  it('is read back by the Citations page own parser as the Pages tab with the own role', () => {
    const search: CitationSearch = Object.fromEntries(
      queryOf(citationsLink(base(), { tab: 'pages', role: 'own', source: 11 })),
    );
    expect(parseCitationScope(search, ENGINES)).toMatchObject({ tab: 'pages', roles: ['own'] });
  });

  it('writes no inspector without a page, and has no link where the Citations page cannot show the scope', () => {
    expect(queryOf(citationsLink(base(), { tab: 'pages', role: 'own' })).has('inspect')).toBe(false);
    expect(citationsLink(base({ country: 'DE' }), { tab: 'pages', role: 'own', source: 11 })).toBeNull();
  });
});
