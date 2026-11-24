import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PromptRow } from '../prompt-columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { PromptColumnContext } from '../seams/columns';
import { aiOverviewColumnEntry } from './ai-overview-column';
import type { PromptAiOverview, PromptSummaryRow } from '@/lib/api/types';
import { renderWithProviders } from '@/test/render';

// The key and its values stand in for the words, so the test names the state and not its copy
const t = ((key: string, values?: Record<string, unknown>) =>
  values === undefined ? key : `${key} ${JSON.stringify(values)}`) as unknown as PromptColumnContext['t'];
const column = aiOverviewColumnEntry.build({
  t,
  timeZone: 'UTC',
} as PromptColumnContext)[0] as DataTableColumn<PromptRow>;

const cell = (over: Partial<PromptAiOverview>): PromptAiOverview => ({
  source_state: 'ok',
  keyword: 'managed soc',
  shown: true,
  cited_own: true,
  cited_position: 2,
  observed_at: '2026-11-20T08:00:00Z',
  checks: 2,
  ...over,
});
const rowOf = (ai_overview: PromptAiOverview | undefined): PromptRow =>
  ({ summary: ai_overview === undefined ? undefined : ({ ai_overview } as PromptSummaryRow) }) as PromptRow;

function textOf(row: PromptRow): string | null {
  cleanup();
  renderWithProviders(<div data-testid="cell">{column.cell(row)}</div>);
  return screen.getByTestId('cell').textContent;
}

describe('the Google AI Overview column', () => {
  it('says Cited with the place, Not cited, None shown and Not tracked', () => {
    expect(textOf(rowOf(cell({})))).toContain('prompts.metrics.aiOverview.cited {"position":2}');
  });

  it('names each other state in its own words', () => {
    expect(textOf(rowOf(cell({ cited_own: false, cited_position: null })))).toBe('prompts.metrics.aiOverview.notCited');
    expect(textOf(rowOf(cell({ source_state: 'no_surface', shown: false, cited_own: false })))).toBe(
      'prompts.metrics.aiOverview.none',
    );
    expect(textOf(rowOf(cell({ source_state: 'not_tracked', keyword: null, shown: null, cited_own: null })))).toBe(
      'prompts.metrics.aiOverview.notTracked',
    );
  });

  it('is n/a without a linked keyword and when the read carries no cell, never a blank', () => {
    expect(textOf(rowOf(cell({ source_state: 'no_linked_keyword', keyword: null })))).toBe('n/a');
    expect(textOf(rowOf(undefined))).toBe('n/a');
  });

  it('sorts cited rows by place, then not cited, then none shown, with unknown last', () => {
    const sort = (row: PromptRow): number | null => {
      const value = column.sortValue?.(row);
      return typeof value === 'number' ? value : null;
    };
    expect(sort(rowOf(cell({ cited_position: 1 })))).toBe(1);
    expect(sort(rowOf(cell({ cited_position: 3 })))).toBe(3);
    expect(sort(rowOf(cell({ cited_own: false })))).toBe(1000);
    expect(sort(rowOf(cell({ source_state: 'no_surface', shown: false })))).toBe(2000);
    expect(sort(rowOf(cell({ source_state: 'not_tracked' })))).toBeNull();
    expect(sort(rowOf(undefined))).toBeNull();
  });
});
