import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CheckView } from './check-view';
import { ISSUE_CHECKS } from '@/test/issues-harness';
import { renderWithProviders } from '@/test/render';
import type { IssueCheck } from '@/lib/issues/types';

const FOUND = ISSUE_CHECKS[0] as IssueCheck;

describe('the open check (the body is task 3)', () => {
  it('shows the name of the check and a way back to all issues', async () => {
    const onBack = vi.fn();
    const { user } = renderWithProviders(<CheckView check={FOUND} onBack={onBack} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Pages that return a 4xx error' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All issues' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows nothing else of the check yet', () => {
    const { container } = renderWithProviders(<CheckView check={FOUND} onBack={vi.fn()} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(container).not.toHaveTextContent('Why it matters');
  });
});
