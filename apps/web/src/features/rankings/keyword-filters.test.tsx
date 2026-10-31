import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useKeywordFilterFields } from './keyword-filters';
import { renderWithProviders } from '@/test/render';

const scope = {
  workspaceId: '0192d1a8-0000-7000-8000-000000000001',
  projectId: '0192d1a8-0000-7000-8000-000000000002',
};

function Probe({ depth }: { depth?: number }) {
  const fields = useKeywordFilterFields(scope, depth);
  const rank = fields.find((f) => f.id === 'rank');
  const beyond = rank?.kind === 'enum' ? rank.options.find((o) => o.value === 'beyond') : null;
  return <span data-testid="beyond">{beyond?.label}</span>;
}

describe('useKeywordFilterFields', () => {
  it('reads "Over 100" for beyond depth only when depth is 100', () => {
    const { rerender } = renderWithProviders(<Probe depth={100} />);
    expect(screen.getByTestId('beyond')).toHaveTextContent('Over 100');

    rerender(<Probe depth={20} />);
    expect(screen.getByTestId('beyond')).toHaveTextContent('Beyond depth');
  });
});
