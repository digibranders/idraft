import { describe, expect, it } from 'vitest';

import { citationsLink } from './drill';
import { drillHref } from '../../../drilldown/drill-links';
import { scopeOf } from '../model/source-fixtures';
import { parseScope as parseCitationScope, type CitationSearch } from '@/features/citations/citation-scope';
import type { EngineCode } from '@/lib/api/types';
import { parseInspectTarget } from '@/lib/inspector/placement';

const PROJECT = { workspace: 'acme', project: 'eventus' };
const ENGINES: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

/** The query of a link, as the page it opens reads it. */
function queryOf(href: string | null): URLSearchParams {
  if (href === null) throw new Error('expected a link, got null');
  return new URL(href, 'http://localhost').searchParams;
}
const pathOf = (href: string | null): string => new URL(href ?? '', 'http://localhost').pathname;
const searchOf = (query: URLSearchParams): CitationSearch => Object.fromEntries(query);

const base = (patch = {}) =>
  drillHref('citations', scopeOf({ engines: ['chatgpt_web', 'gemini_web'], ...patch }), {}, PROJECT);

describe('citationsLink', () => {
  it('opens the domain inspector on the Domains tab of the Citations page, keeping the scope of the card', () => {
    const href = citationsLink(base({ branded: 'included', compare: false }), { tab: 'domains', domain: 'g2.com' });
    expect(pathOf(href)).toBe('/acme/eventus/ai/citations');
    const query = queryOf(href);
    expect(query.get('tab')).toBe('domains');
    expect(parseInspectTarget(query.get('inspect'))).toEqual({ type: 'domain', id: 'g2.com' });
    expect(query.get('engine')).toBe('chatgpt_web,gemini_web');
    expect(query.get('cmp')).toBe('off');
    expect(query.get('branded')).toBe('include');
  });

  it('is read back by the Citations page own parser: tab, roles, engines, comparison and branded', () => {
    const href = citationsLink(base({ branded: 'included', compare: false }), {
      tab: 'domains',
      role: 'third_party',
      domain: 'g2.com',
    });
    const scope = parseCitationScope(searchOf(queryOf(href)), ENGINES);
    expect(scope).toMatchObject({
      tab: 'domains',
      roles: ['third_party'],
      engines: ['chatgpt_web', 'gemini_web'],
      compare: false,
      includeBranded: true,
    });
  });

  it('writes a role only when one is given, and the other tabs and the kind of the New and lost tab', () => {
    expect(queryOf(citationsLink(base(), { tab: 'domains' })).has('role')).toBe(false);
    expect(queryOf(citationsLink(base(), { tab: 'domains' })).has('inspect')).toBe(false);
    const pages = parseCitationScope(searchOf(queryOf(citationsLink(base(), { tab: 'pages', role: 'own' }))), ENGINES);
    expect(pages).toMatchObject({ tab: 'pages', roles: ['own'] });
    const lost = parseCitationScope(
      searchOf(queryOf(citationsLink(base(), { tab: 'new-lost', kind: 'lost' }))),
      ENGINES,
    );
    expect(lost).toMatchObject({ tab: 'new-lost', changeKind: 'lost' });
  });

  it('has no link where the Citations page cannot show the scope: a country, branded only, a long window', () => {
    expect(citationsLink(base({ country: 'DE' }), { tab: 'domains', domain: 'g2.com' })).toBeNull();
    expect(citationsLink(base({ branded: 'only' }), { tab: 'domains', domain: 'g2.com' })).toBeNull();
    expect(
      citationsLink(base({ range: { from: '2026-08-01', to: '2026-11-12', days: 104 } }), {
        tab: 'domains',
        domain: 'g2.com',
      }),
    ).toBeNull();
  });

  it('keeps a domain with characters of a query as one value', () => {
    const href = citationsLink(base(), { tab: 'domains', domain: 'a&b=c.com' });
    expect(queryOf(href).get('inspect')).toBe('domain:a&b=c.com');
  });
});
