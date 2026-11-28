import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AiPromptsCard } from './ai-prompts-card';
import { promptIdsOf } from '@/lib/pages/ai-model';
import { AI_CITED_PAGE, AI_QUIET_PAGE, pageAiOf } from '@/mocks/internal-links-page-ai';
import { axe } from '@/test/axe';
import { expectNoPixelWidth } from '@/test/drawer-width-scan';
import { renderWithProviders } from '@/test/render';

const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');

describe('AiPromptsCard', () => {
  it('lists every citing prompt with canonical citing platforms and cited answer counts', async () => {
    const ai = pageAiOf(AI_CITED_PAGE);
    const { container } = renderWithProviders(<AiPromptsCard ai={ai} onOpenPrompt={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Prompts that cited this page' })).toBeInTheDocument();
    expect(screen.getByText('6 of 6 prompts')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Prompts that cited this page' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Prompt', 'Platforms', 'Cited']);
    for (const header of headers) {
      expect(header).toHaveClass('type-table-header');
    }

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(6);

    const firstRow = rows[0];
    const firstPrompt = ai.prompts[0];
    if (firstRow === undefined || firstPrompt === undefined) throw new Error('Expected first prompt row');
    expect(within(firstRow).getByRole('button', { name: firstPrompt.text })).toBeInTheDocument();
    expect(within(firstRow).getByText('ChatGPT')).toBeInTheDocument();
    expect(within(firstRow).getByText('Gemini')).toBeInTheDocument();
    expect(within(firstRow).getByText('Google AI Mode')).toBeInTheDocument();
    expect(within(firstRow).getAllByRole('cell')[2]).toHaveTextContent('4');

    expectNoPixelWidth(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows platform marks in canonical order even when the API list is reversed, omitting zero-citing engines', () => {
    const base = pageAiOf(AI_CITED_PAGE);
    const firstPrompt = base.prompts[0];
    if (firstPrompt === undefined) throw new Error('Expected first prompt');
    const reversed = {
      ...base,
      prompts: [
        {
          ...firstPrompt,
          platforms: [...firstPrompt.platforms].reverse(),
        },
        ...base.prompts.slice(1),
      ],
    };

    renderWithProviders(<AiPromptsCard ai={reversed} onOpenPrompt={vi.fn()} />);

    const table = screen.getByRole('table', { name: 'Prompts that cited this page' });
    const rows = within(table).getAllByRole('row').slice(1);
    const firstCells = within(rows[0] as HTMLElement).getAllByRole('cell');
    expect(firstCells[1]?.textContent).toBe('ChatGPTGeminiGoogle AI Mode');

    const sixthRow = rows[5];
    if (sixthRow === undefined) throw new Error('Expected 6th prompt row');
    expect(within(sixthRow).queryByText('ChatGPT')).toBeNull();
    expect(within(sixthRow).getByText('Gemini')).toBeInTheDocument();
    expect(within(sixthRow).queryByText('Google AI Mode')).toBeNull();
    expect(within(sixthRow).getAllByRole('cell')[2]).toHaveTextContent('1');
  });

  it('calls onOpenPrompt with prompt id and row order on click and Enter, including branded prompts', async () => {
    const ai = pageAiOf(AI_CITED_PAGE);
    const onOpenPrompt = vi.fn();
    const { user } = renderWithProviders(<AiPromptsCard ai={ai} onOpenPrompt={onOpenPrompt} />);

    const expectedOrder = promptIdsOf(ai);
    const branded = ai.prompts[2];
    if (branded === undefined) throw new Error('Expected branded prompt at index 2');

    await user.click(screen.getByRole('button', { name: branded.text }));
    expect(onOpenPrompt).toHaveBeenCalledWith(branded.prompt_id, expectedOrder);

    const firstPrompt = ai.prompts[0];
    if (firstPrompt === undefined) throw new Error('Expected first prompt');
    const firstButton = screen.getByRole('button', { name: firstPrompt.text });
    firstButton.focus();
    expect(firstButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpenPrompt).toHaveBeenLastCalledWith(firstPrompt.prompt_id, expectedOrder);
  });

  it('shows tooltips for prompt text, platform breakdown with k of n, and cited count', async () => {
    const ai = pageAiOf(AI_CITED_PAGE);
    const { user } = renderWithProviders(<AiPromptsCard ai={ai} onOpenPrompt={vi.fn()} />);

    const table = screen.getByRole('table', { name: 'Prompts that cited this page' });
    const firstRow = within(table).getAllByRole('row')[1];
    if (firstRow === undefined) throw new Error('Expected first row');
    const cells = within(firstRow).getAllByRole('cell');
    const firstPrompt = ai.prompts[0];
    if (firstPrompt === undefined) throw new Error('Expected first prompt');

    await user.hover(within(firstRow).getByRole('button', { name: firstPrompt.text }));
    await waitFor(() => expect(tooltip()).toHaveTextContent(`${firstPrompt.text}. Open its answers`));

    const platformGroup = cells[1]?.querySelector('span');
    if (platformGroup === null || platformGroup === undefined) throw new Error('Expected platform span');
    await user.hover(platformGroup);
    await waitFor(() =>
      expect(tooltip()).toHaveTextContent(
        'ChatGPT: 2 of 3 answers · Gemini: 1 of 3 answers · Google AI Mode: 1 of 3 answers',
      ),
    );

    const citedSpan = cells[2]?.querySelector('span');
    if (citedSpan === null || citedSpan === undefined) throw new Error('Expected cited span');
    await user.hover(citedSpan);
    await waitFor(() => expect(tooltip()).toHaveTextContent('Cited in 4 of 9 answers'));
  });

  it('shows an empty card when no tracked prompt cited this page', async () => {
    const ai = pageAiOf(AI_QUIET_PAGE);
    const { container } = renderWithProviders(<AiPromptsCard ai={ai} onOpenPrompt={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'No prompt cited this page in this period' })).toBeInTheDocument();
    expect(screen.getByText("None of this page's tracked prompts cited it in this period.")).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the cut meta when prompts_total exceeds the rows shown', () => {
    const ai = { ...pageAiOf(AI_CITED_PAGE), prompts_total: 120 };
    renderWithProviders(<AiPromptsCard ai={ai} onOpenPrompt={vi.fn()} />);

    expect(screen.getByText('Showing 6 of 120 prompts')).toBeInTheDocument();
  });
});
