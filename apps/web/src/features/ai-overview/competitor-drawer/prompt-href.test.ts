import { describe, expect, it } from 'vitest';

import { promptHref } from './prompt-href';
import type { OverviewScope } from '../scope/scope-model';
import { parseInspectTarget } from '@/lib/inspector/placement';

function scopeOf(patch: Partial<OverviewScope> = {}): OverviewScope {
  return {
    range: { from: '2026-10-16', to: '2026-11-12', days: 28 },
    rangeValue: { kind: 'preset', preset: '28d' },
    compare: true,
    compareKind: 'previous_period',
    previous: { from: '2026-09-18', to: '2026-10-15' },
    country: null,
    engines: null,
    topic: null,
    branded: 'excluded',
    metric: 'visibility',
    ...patch,
  };
}

const PROJECT = { workspace: 'acme', project: 'fynix' };
const inspectOf = (href: string): string | null => new URL(href, 'http://localhost').searchParams.get('inspect');

describe('promptHref', () => {
  it('opens the prompt inspector over the Prompts page, carrying the scope of the Overview', () => {
    const scope = scopeOf({ engines: ['gemini_web'] });
    const href = promptHref(scope, PROJECT, 'p1');
    expect(href).toMatch(/^\/acme\/fynix\/ai\/prompts\?/);
    expect(new URL(href, 'http://localhost').searchParams.get('engine')).toBe('gemini_web');
    expect(parseInspectTarget(inspectOf(href))).toEqual({ type: 'prompt', id: 'p1' });
  });

  it('carries the Branded choice, which the Prompts page reads, and the comparison with last year', () => {
    const scope: OverviewScope = scopeOf({ branded: 'only', compareKind: 'previous_year' });
    const query = new URL(promptHref(scope, PROJECT, 'p1'), 'http://localhost').searchParams;
    expect(query.get('branded')).toBe('only');
    expect(query.get('cmp')).toBe('year');
  });

  it("opens it with the page's own scope when the Prompts page cannot express the window", () => {
    const scope: OverviewScope = scopeOf({
      range: { from: '2026-08-13', to: '2026-11-12', days: 92 },
      rangeValue: { kind: 'custom', from: '2026-08-13', to: '2026-11-12' },
    });
    expect(promptHref(scope, PROJECT, 'p1')).toBe('/acme/fynix/ai/prompts?inspect=prompt%3Ap1');
  });
});
