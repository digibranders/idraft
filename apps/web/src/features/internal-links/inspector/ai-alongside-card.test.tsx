import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AiAlongsideCard } from './ai-alongside-card';
import { AI_CITED_PAGE, AI_QUIET_PAGE, pageAiOf } from '@/mocks/internal-links-page-ai';
import { axe } from '@/test/axe';
import { expectNoPixelWidth } from '@/test/drawer-width-scan';
import { renderWithProviders } from '@/test/render';

const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');

describe('AiAlongsideCard', () => {
  it('renders own crawl pages as buttons, external addresses with registrable DomainChip, and competitors neutrally', async () => {
    const base = pageAiOf(AI_CITED_PAGE);
    const competitor = base.alongside[1];
    if (competitor === undefined) throw new Error('Expected competitor row');
    const ai = {
      ...base,
      alongside: [
        base.alongside[0],
        { ...competitor, host: 'docs.sentinelgate-cyber.com', registrable_domain: 'sentinelgate-cyber.com' },
        ...base.alongside.slice(2),
      ].filter((row): row is NonNullable<typeof row> => row !== undefined),
    };

    const onOpenPage = vi.fn();
    const { container, user } = renderWithProviders(<AiAlongsideCard ai={ai} onOpenPage={onOpenPage} />);

    expect(screen.getByRole('heading', { name: 'Cited with this page' })).toBeInTheDocument();
    expect(screen.getByText('Other addresses cited in the same answers', { selector: 'span' })).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Other addresses cited in the same answers' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Address', 'Answers']);
    for (const header of headers) {
      expect(header).toHaveClass('type-table-header');
    }

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(5);

    const ownInCrawl = ai.alongside[0];
    if (ownInCrawl === undefined) throw new Error('Expected own in-crawl row');
    const button = within(rows[0] as HTMLElement).getByRole('button', {
      name: `${ownInCrawl.path}. Open page drawer`,
    });
    expect(button).toHaveClass('min-h-6');
    expect(button).toHaveTextContent(ownInCrawl.path);
    if (ownInCrawl.title) expect(button).toHaveTextContent(ownInCrawl.title);

    await user.click(button);
    expect(onOpenPage).toHaveBeenCalledWith(String(ownInCrawl.url_id));
    button.focus();
    await user.keyboard('{Enter}');
    expect(onOpenPage).toHaveBeenCalledTimes(2);

    const competitorRow = rows[1] as HTMLElement;
    expect(within(competitorRow).queryByRole('button')).toBeNull();
    expect(within(competitorRow).getByText('sentinelgate-cyber.com/managed-soc')).toBeInTheDocument();
    // Uses registrable_domain rather than host subdomain for the chip
    expect(within(competitorRow).getByText('sentinelgate-cyber.com')).toBeInTheDocument();
    expect(within(competitorRow).queryByText('docs.sentinelgate-cyber.com')).toBeNull();
    expect(within(competitorRow).getByText('Competitor')).toBeInTheDocument();

    const ownOutsideRow = rows[3] as HTMLElement;
    expect(within(ownOutsideRow).queryByRole('button')).toBeNull();
    expect(within(ownOutsideRow).getByText('eventussecurity.com/legacy/soc-datasheet')).toBeInTheDocument();
    expect(within(ownOutsideRow).getByText('eventussecurity.com')).toBeInTheDocument();

    const thirdPartyRow = rows[4] as HTMLElement;
    expect(within(thirdPartyRow).queryByRole('button')).toBeNull();
    expect(within(thirdPartyRow).getByText('secopsjournal.example/soc-buyers-guide')).toBeInTheDocument();
    expect(within(thirdPartyRow).getByText('secopsjournal.example')).toBeInTheDocument();

    expectNoPixelWidth(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the shared answer tooltip and sr-only context, and renders untrusted addresses strictly as text', async () => {
    const base = pageAiOf(AI_CITED_PAGE);
    const injected = {
      ...base,
      alongside: [
        {
          url_id: 999,
          url: 'javascript:alert(1)',
          path: '<img src=x onerror=alert(1)>',
          title: '<b>XSS</b>',
          host: 'evil.example',
          registrable_domain: 'evil.example',
          domain_role: 'third_party' as const,
          in_crawl: false,
          answers_shared: 3,
        },
      ],
      alongside_total: 1,
    };
    const { user, container } = renderWithProviders(
      <AiAlongsideCard ai={{ ...injected, answers_citing: 5 }} onOpenPage={vi.fn()} />,
    );

    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Other addresses cited in the same answers' });
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    const answersCell = within(row).getAllByRole('cell')[1];
    expect(answersCell).toHaveTextContent('3 (Cited with this page in 3 of 5 answers)');
    const answersSpan = answersCell?.querySelector('span');
    if (answersSpan === null || answersSpan === undefined) throw new Error('Expected answers span');
    await user.hover(answersSpan);
    await waitFor(() => expect(tooltip()).toHaveTextContent('Cited with this page in 3 of 5 answers'));
  });

  it('shows the Showing meta when alongside_total exceeds the rows shown', () => {
    const ai = { ...pageAiOf(AI_CITED_PAGE), alongside_total: 14 };
    renderWithProviders(<AiAlongsideCard ai={ai} onOpenPage={vi.fn()} />);

    expect(screen.getByText('Showing 5 of 14 addresses')).toBeInTheDocument();
  });

  it('renders an empty card when no other address was cited in the same answers', async () => {
    const quiet = pageAiOf(AI_QUIET_PAGE);
    const { container } = renderWithProviders(<AiAlongsideCard ai={quiet} onOpenPage={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'No other address was cited in the same answers' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
