import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';

/*
 * Every string of the Overview that names the window a figure is compared with takes the kind of the comparison
 * (`compareWord` of the scope): the previous period with `cmp` left out, the same period last year with `cmp=year`
 * (glossary P15). Both kinds must format, and the year one must not say "previous".
 */

// The namespaces are listed as text below, so the typed namespace of the translator is widened once, here
const t = (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as 'aiOverview' });

const CASES: readonly (readonly [namespace: string, key: string, values: Record<string, string | number>])[] = [
  ['aiOverview.engines.changeSummary', 'noPrevious', { reason: 'unread', days: 28 }],
  ['aiOverview.engines.changeSummary', 'noPrevious', { reason: 'noAnswers', days: 28 }],
  ['aiOverview.engines.changeSummary', 'rulesSources', {}],
  ['aiOverview.engines.changeSummary', 'numbersNoPrevious', { days: 28 }],
  ['aiOverview.engines.common', 'partialPrevious', {}],
  ['aiOverview.engines.trend', 'summaryChange', { points: '+2 pts', test: 'detectable' }],
  ['aiOverview.engines.trend', 'footnotePrevious', {}],
  ['aiOverview.engines.byEngine', 'previousText', { value: '12%', k: 3, n: 25 }],
  ['aiOverview.engines.byEngine', 'previousShare', { value: '12%', k: 3, n: 25 }],
  ['aiOverview.engines.movers', 'emptyNoPreviousTitle', { days: 28 }],
  ['aiOverview.engines.movers', 'footnote', {}],
  ['aiOverview.engines.comparison', 'title', {}],
  [
    'aiOverview.engines.comparison',
    'rowText',
    { engine: 'ChatGPT', change: '+2', interval: '1 to 3', test: 'other', before: '10%', now: '12%' },
  ],
  ['aiOverview.engines.comparison', 'footnote', { period: 'Oct 16 to Nov 12' }],
  ['aiOverview.engines.comparison', 'summaryIntro', { metric: 'Mention rate', engines: 'ChatGPT', parts: 'up' }],
  ['aiOverview.engines.waterfall', 'barStart', {}],
  ['aiOverview.engines.platformTrend', 'info.how', { days: 28 }],
  ['aiOverview.competitors.common', 'partial', {}],
  ['aiOverview.competitors.common', 'previousEmpty', {}],
  ['aiOverview.competitors.table', 'changeHeader', {}],
  ['aiOverview.topics.movers', 'summary', { metric: 'Mention rate', engines: 'ChatGPT' }],
  ['aiOverview.topics.movers', 'noPreviousTitle', { days: 28 }],
  ['aiOverview.topics.movers', 'noPreviousReason', {}],
  ['aiOverview.topics.contribution', 'noPreviousTitle', { days: 28 }],
  ['aiOverview.topics.contribution', 'noPreviousReason', {}],
  ['aiOverview.topics.topPrompts', 'summary', { show: 'changed', engines: 'ChatGPT' }],
  ['aiOverview.activity.keyChanges', 'holdNoPrevious', {}],
  ['aiOverview.activity.keyChanges', 'emptyNoPreviousReason', {}],
  ['aiOverview.activity.keyChanges', 'partComparison', {}],
];

describe('the words that name the window a figure is compared with', () => {
  it.each(CASES)('%s %s: the same period last year with cmp=year, the previous period otherwise', (ns, key, values) => {
    const year = t(ns)(key as never, { ...values, kind: 'year' } as never);
    const previous = t(ns)(key as never, { ...values, kind: 'previous' } as never);
    expect(year).not.toMatch(/previous|period before|\d+ days before/i);
    expect(year).toMatch(/last year/i);
    expect(previous).not.toMatch(/last year/i);
  });
});
