import { describe, expect, it } from 'vitest';

import type { OverviewScope } from '../scope/scope-model';
import { overviewSummaryQuery } from './overview-queries';
import { summaryQuery } from '@/features/prompts/prompt-queries';
import type { EngineCode } from '@/lib/api/types';

/**
 * The Overview's summary and the Topics and Prompts page's are one read of the same scope (R12): the same request
 * parameters, so the same prompt rows and the same counts. The Prompts page's factory cannot be imported by the
 * feature (a feature may not import another), so this test is what keeps the two from drifting apart.
 */

const ALL: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';
const WINDOW = { from: '2026-10-16', to: '2026-11-12' } as const;

function scopeOf(patch: Partial<OverviewScope>): OverviewScope {
  return {
    range: { ...WINDOW, days: 28 },
    rangeValue: { kind: 'preset', preset: '28d' },
    compare: true,
    previous: { from: '2026-09-18', to: '2026-10-15' },
    country: null,
    engines: null,
    topic: null,
    branded: 'excluded',
    ...patch,
  };
}

const queryOf = (options: { queryKey: readonly unknown[] }): unknown => options.queryKey.at(-1);

/** A scope, and how the Prompts page says the same branded choice (`include_branded`, and `branded_only` alone). */
interface Case {
  name: string;
  patch: Partial<OverviewScope>;
  includeBranded: boolean;
  brandedOnly: boolean;
}

const CASES: readonly Case[] = [
  { name: 'the default scope', patch: {}, includeBranded: false, brandedOnly: false },
  { name: 'a country', patch: { country: 'DE' }, includeBranded: false, brandedOnly: false },
  { name: 'a topic', patch: { topic: TOPIC }, includeBranded: false, brandedOnly: false },
  { name: 'branded prompts included', patch: { branded: 'included' }, includeBranded: true, brandedOnly: false },
  { name: 'branded prompts alone', patch: { branded: 'only' }, includeBranded: true, brandedOnly: true },
  {
    name: 'a country, a topic and branded prompts included',
    patch: { country: 'IN', topic: TOPIC, branded: 'included' },
    includeBranded: true,
    brandedOnly: false,
  },
];

describe('the summary read of the Overview and of the Prompts page', () => {
  it.each(CASES)('send equal request parameters for $name', ({ patch, includeBranded, brandedOnly }) => {
    const scope = scopeOf(patch);
    const overview = overviewSummaryQuery({ workspaceId: 'w1', projectId: 'p1' }, { scope, enabledEngines: ALL });
    const prompts = summaryQuery({ workspaceId: 'w1', projectId: 'p1' }, WINDOW, includeBranded, {
      ...(scope.country === null ? {} : { country: scope.country }),
      ...(scope.topic === null ? {} : { term: scope.topic }),
      ...(brandedOnly ? { brandedOnly: true } : {}),
    });
    expect(queryOf(overview)).toEqual(queryOf(prompts));
  });
});
