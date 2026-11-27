import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IssuesStrip } from './issues-strip';
import { issueList } from '@/test/issues-harness';
import { renderWithProviders } from '@/test/render';

const { summary } = issueList();

describe('the six measures of the strip', () => {
  it('reads Pages crawled, the three severities, Pages with an issue and Checks passed, in one group', () => {
    renderWithProviders(<IssuesStrip summary={summary} status="ready" />);
    const group = screen.getByRole('group', { name: 'Measures' });
    const terms = within(group)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(terms).toEqual([
      'Pages crawled',
      'Pages with an issue',
      'Pages with an error',
      'Pages with a warning',
      'Pages with a notice',
      'Checks passed',
    ]);
    const values = within(group)
      .getAllByRole('definition')
      .map((value) => value.textContent);
    expect(values).toEqual(['1,840', '412', '37', '180', '301', '9 of 27']);
  });

  it('gives each measure its definition, with the share of pages for Pages with an issue', () => {
    renderWithProviders(<IssuesStrip summary={summary} status="ready" />);
    const definitions = within(screen.getByRole('group', { name: 'Measures' })).getAllByRole('definition');
    expect(definitions[0]).toHaveAccessibleDescription(
      'Every address the crawl in view found: pages, redirects and errors.',
    );
    expect(definitions[1]).toHaveAccessibleDescription(
      '22% of the pages crawled have at least one issue of any severity. A page with several issues counts once.',
    );
    expect(definitions[2]).toHaveAccessibleDescription(
      'Breaks a page for visitors or for Google. Fix these first. A page with several issues counts once.',
    );
    expect(definitions[5]).toHaveAccessibleDescription('Checks that ran on this crawl and found no page.');
  });

  it('says n/a, not a percentage, when the crawl found no page', () => {
    renderWithProviders(<IssuesStrip summary={{ ...summary, pages_crawled: 0, pages_with_issue: 0 }} status="ready" />);
    expect(
      within(screen.getByRole('group', { name: 'Measures' })).getAllByRole('definition')[1],
    ).toHaveAccessibleDescription(
      'n/a of the pages crawled have at least one issue of any severity. A page with several issues counts once.',
    );
  });

  it('keeps the labels and shows no figure while the list loads', () => {
    renderWithProviders(<IssuesStrip summary={null} status="loading" />);
    const group = screen.getByRole('group', { name: 'Measures' });
    expect(group).toHaveAttribute('aria-busy', 'true');
    expect(within(group).getAllByRole('term')).toHaveLength(6);
    expect(group).not.toHaveTextContent(/\d/);
  });
});
