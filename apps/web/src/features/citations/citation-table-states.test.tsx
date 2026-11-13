import { screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import {
  CitationEmptyState,
  CitationFilteredEmptyState,
  CitationTableNotes,
  minimumRaised,
  resolveTableStatus,
  type TableReadFacts,
} from './citation-table-states';
import { citationFilterFields } from './citations-filters';
import messages from '../../../messages/en.json';
import type { SourcesMeta } from '@/lib/citations/types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const META: SourcesMeta = {
  window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
  include_branded: false,
  engine_codes: ['chatgpt_web'],
  answers: 12,
  answers_citing: 3,
  citation_units: 40,
  by_role: [],
  previous_answers: 10,
};

const ready: TableReadFacts = { isError: false, isPending: false, isFetching: false, hasData: true };

describe('resolveTableStatus', () => {
  const status = (read: Partial<TableReadFacts>, listed = 3, filtering = false, meta: SourcesMeta | undefined = META) =>
    resolveTableStatus({ read: { ...ready, ...read }, listed, filtering, meta });

  it('is ready with rows, refetching while a read is in flight and loading before the first answer', () => {
    expect(status({})).toBe('ready');
    expect(status({ isFetching: true })).toBe('refetching');
    expect(status({ isPending: true, hasData: false })).toBe('loading');
  });

  it('is an error only when the read failed with nothing to show', () => {
    expect(status({ isError: true, hasData: false })).toBe('error');
    expect(status({ isError: true, hasData: true })).toBe('ready');
  });

  it('is empty when nothing was cited and nothing narrowed the read', () => {
    expect(status({}, 0, false, { ...META, citation_units: 0 })).toBe('empty');
  });

  it('is filtered-empty when a filter, a search or the minimum left no row, or the units are not known', () => {
    expect(status({}, 0, true, { ...META, citation_units: 0 })).toBe('filtered-empty');
    expect(status({}, 0, false)).toBe('filtered-empty');
    expect(status({}, 0, false, undefined)).toBe('filtered-empty');
    expect(status({ isFetching: true }, 0, true)).toBe('filtered-empty');
  });

  it('does not call a read that has not answered yet empty', () => {
    expect(status({ isPending: true, hasData: false }, 0)).toBe('loading');
  });
});

describe('minimumRaised', () => {
  it('is true for any minimum above 1, the default 2 included', () => {
    expect(minimumRaised(1)).toBe(false);
    expect(minimumRaised(2)).toBe(true);
    expect(minimumRaised(10)).toBe(true);
  });
});

describe('CitationEmptyState', () => {
  it('says there are no citations yet, with a way to the prompts, when no answer was read', () => {
    renderWithProviders(<CitationEmptyState meta={{ ...META, answers: 0 }} workspaceSlug="ws" projectSlug="proj" />);
    expect(screen.getByRole('heading', { name: 'No citations yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Topics and Prompts' })).toHaveAttribute(
      'href',
      '/ws/proj/ai/prompts',
    );
  });

  it('says how many answers were read when none names a source', () => {
    renderWithProviders(<CitationEmptyState meta={META} workspaceSlug="ws" projectSlug="proj" />);
    expect(screen.getByRole('heading', { name: 'The answers cite no source' })).toBeInTheDocument();
    expect(screen.getByText('12 answers were read in this window and none names a source.')).toBeInTheDocument();
  });
});

describe('CitationFilteredEmptyState', () => {
  const fields = citationFilterFields({
    t: createTranslator({ locale: 'en', messages, namespace: 'citations.filters' }),
    tab: 'pages',
    engines: [],
    enginesLoading: false,
    roleUnits: null,
    topics: [],
    topicsLoading: false,
  });
  const show = (minSupport: number, filtering: boolean, onClear = vi.fn()): ReturnType<typeof renderWithProviders> =>
    renderWithProviders(
      <CitationFilteredEmptyState
        filterBar={{ fields, values: filtering ? { role: { kind: 'enum', values: ['own'] } } : {} }}
        minSupport={minSupport}
        filtering={filtering}
        onClear={onClear}
      />,
    );

  it('names the filters and offers Clear filters', async () => {
    const onClear = vi.fn();
    const { user } = show(1, true, onClear);
    expect(screen.getByText('Role: Own')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('says to lower the minimum whenever it is above 1, the default 2 included', () => {
    show(2, false);
    expect(screen.getByText('Lower the fewest citation units to see more rows.')).toBeInTheDocument();
  });

  it('says nothing of the minimum at 1', () => {
    show(1, true);
    expect(screen.queryByText('Lower the fewest citation units to see more rows.')).toBeNull();
  });

  it('offers Clear for a minimum other than the default even with no filter, and not for the default alone', () => {
    const raised = show(5, false);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    raised.unmount();
    show(1, false);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('offers no Clear when only the default minimum is in force and no filter is', () => {
    show(2, false);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('is axe clean', async () => {
    const { container } = show(5, true);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('CitationTableNotes', () => {
  const notes = (
    props: Partial<Parameters<typeof CitationTableNotes>[0]> = {},
  ): ReturnType<typeof renderWithProviders> =>
    renderWithProviders(
      <CitationTableNotes
        meta={META}
        compare
        refreshFailed={false}
        refetching={false}
        onRetry={() => undefined}
        truncated={null}
        {...props}
      />,
    );

  it('says which units the shares are of', () => {
    notes();
    expect(screen.getByText('Shares are of 40 citation units in 12 answers.')).toBeInTheDocument();
  });

  it('says nothing while the units are not known', () => {
    notes({ meta: undefined });
    expect(screen.queryByText(/Shares are of/)).toBeNull();
  });

  it('says the rows are from the last read after a refresh that failed, with Retry', async () => {
    const onRetry = vi.fn();
    const { user } = notes({ refreshFailed: true, onRetry });
    expect(
      screen.getByText('The list could not be refreshed. The rows shown are from the last read.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says the rows were cut, in the words the tab gives', () => {
    notes({ truncated: 'The 200 most cited things are listed of 900.' });
    expect(screen.getByText('The 200 most cited things are listed of 900.')).toBeInTheDocument();
  });

  it('says nothing is marked New when the previous period has no answers, and only with a comparison on', () => {
    const none = { ...META, previous_answers: 0 };
    const first = notes({ meta: none });
    expect(screen.getByText('The previous period has no answers, so nothing is marked New.')).toBeInTheDocument();
    first.unmount();
    notes({ meta: none, compare: false });
    expect(screen.queryByText(/previous period has no answers/)).toBeNull();
  });

  it('draws what the tab adds after its own notes', () => {
    notes({ children: <p>Added by the tab</p> });
    expect(screen.getByText('Added by the tab')).toBeInTheDocument();
  });
});
