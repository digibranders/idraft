import { screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { citationFilterFields } from './citations-filters';
import { FilteredEmpty, LoadFailed, NoAnswers, NoCiting, NoEngine } from './citations-states';
import messages from '../../../messages/en.json';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const ERROR_ID = {
  id: 'req-7f3a',
  label: 'Error ID req-7f3a',
  copyLabel: 'Copy error ID',
  copiedLabel: 'Error ID copied',
};

const fields = citationFilterFields({
  t: createTranslator({ locale: 'en', messages, namespace: 'citations.filters' }),
  tab: 'domains',
  engines: [],
  enginesLoading: false,
  roleUnits: null,
  topics: [],
  topicsLoading: false,
});
const filtered = (onClear = vi.fn()): ReactElement => (
  <FilteredEmpty
    filterBar={{ fields, values: { role: { kind: 'enum', values: ['own'] } } }}
    minSupport={1}
    filtering
    onClear={onClear}
  />
);

describe('the states of the Domains and Pages tabs and of the screen', () => {
  it('no engine on says so with a link to Engines', () => {
    renderWithProviders(<NoEngine workspaceSlug="ws" projectSlug="proj" />);
    expect(screen.getByRole('heading', { name: 'No engine is on' })).toBeInTheDocument();
    expect(screen.getByText('Citations come from the answers of the engines you turn on.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Engines' })).toHaveAttribute('href', '/ws/proj/settings/engines');
  });

  it('no answers says when they come with a link to Topics and Prompts', () => {
    renderWithProviders(<NoAnswers workspaceSlug="ws" projectSlug="proj" />);
    expect(screen.getByRole('heading', { name: 'No citations yet' })).toBeInTheDocument();
    expect(
      screen.getByText('Each prompt is asked twice a week. Citations appear after the first answers.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Topics and Prompts' })).toHaveAttribute(
      'href',
      '/ws/proj/ai/prompts',
    );
  });

  it('answers without a citing one says how many were read', () => {
    renderWithProviders(<NoCiting answers={12} workspaceSlug="ws" projectSlug="proj" />);
    expect(screen.getByRole('heading', { name: 'The answers cite no source' })).toBeInTheDocument();
    expect(screen.getByText('12 answers were read in this window and none names a source.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Topics and Prompts' })).toHaveAttribute(
      'href',
      '/ws/proj/ai/prompts',
    );
  });

  it('says one answer in the singular', () => {
    renderWithProviders(<NoCiting answers={1} workspaceSlug="ws" projectSlug="proj" />);
    expect(screen.getByText('1 answer was read in this window and none names a source.')).toBeInTheDocument();
  });

  it('filtered to nothing names the filters and offers Clear', async () => {
    const onClear = vi.fn();
    const { user } = renderWithProviders(filtered(onClear));
    expect(screen.getByRole('heading', { name: 'No domain or page matches these filters' })).toBeInTheDocument();
    expect(screen.getByText('Role: Own')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('load failed has Retry and an error id', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(<LoadFailed errorId={ERROR_ID} onRetry={onRetry} retrying={false} />);
    expect(screen.getByText('Citations could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('The server did not answer. Try again in a moment.')).toBeInTheDocument();
    expect(screen.getByText('Error ID req-7f3a')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('load failed without an error id still has Retry, and announces itself', () => {
    const { container } = renderWithProviders(<LoadFailed errorId={null} onRetry={() => undefined} retrying={false} />);
    // The provider's own live region wraps it, so the error is found by its slot
    const error = container.querySelector('[data-slot="inline-error"]');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).toHaveTextContent('Citations could not be loaded');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(/Error ID/)).toBeNull();
  });

  it.each([
    ['no engine', <NoEngine key="e" workspaceSlug="ws" projectSlug="proj" />],
    ['no answers', <NoAnswers key="a" workspaceSlug="ws" projectSlug="proj" />],
    ['no citing answer', <NoCiting key="c" answers={3} workspaceSlug="ws" projectSlug="proj" />],
    ['filtered to nothing', filtered()],
    ['load failed', <LoadFailed key="f" errorId={ERROR_ID} onRetry={() => undefined} retrying={false} />],
  ])('is axe clean: %s', async (_name, state) => {
    const { container } = renderWithProviders(state);
    expect(await axe(container)).toHaveNoViolations();
  });

  // Found by role and by words, not by the type utilities that draw them
  it.each([
    ['no engine', <NoEngine key="e" workspaceSlug="ws" projectSlug="proj" />, /engines you turn on/],
    ['no answers', <NoAnswers key="a" workspaceSlug="ws" projectSlug="proj" />, /asked twice a week/],
    ['no citing answer', <NoCiting key="c" answers={3} workspaceSlug="ws" projectSlug="proj" />, /read in this window/],
    ['filtered to nothing', filtered(), /clear a filter/],
  ])(
    'the empty state of the Domains and Pages tabs shows a title, a reason and an action: %s',
    (_name, state, reason) => {
      renderWithProviders(state);
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
      expect(screen.getByText(reason)).toBeInTheDocument();
      expect(screen.queryAllByRole('link').length + screen.queryAllByRole('button').length).toBeGreaterThan(0);
    },
  );

  it('the load failure of the Domains and Pages tabs shows a title, a reason and Retry', () => {
    const { container } = renderWithProviders(<LoadFailed errorId={null} onRetry={() => undefined} retrying={false} />);
    expect(container.querySelector('[data-slot="inline-error"]')).toHaveTextContent('Citations could not be loaded');
    expect(screen.getByText(/did not answer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
