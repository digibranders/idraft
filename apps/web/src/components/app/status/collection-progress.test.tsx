import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CollectionProgress } from './collection-progress';
import { renderWithProviders } from '@/test/render';

describe('CollectionProgress', () => {
  it('shows a compact line with its action', () => {
    renderWithProviders(
      <CollectionProgress
        density="compact"
        status="running"
        text="Running: 412 of 1,000 keywords"
        action={<a href="#runs">View run</a>}
      />,
    );
    expect(screen.getByText('Running: 412 of 1,000 keywords')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View run' })).toBeInTheDocument();
  });

  it('exposes the done count, the total and the failed count on its bar', () => {
    renderWithProviders(
      <CollectionProgress
        density="standard"
        status="running"
        text="Import running"
        counts={{ done: 412, failed: 3, total: 1000 }}
        countsText="409 done · 3 failed · 588 in flight"
        progressText="412 of 1,000 rows, 3 failed"
        meta="Started 02:00 CEST"
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Import running' });
    expect(bar).toHaveAttribute('aria-valuenow', '412');
    expect(bar).toHaveAttribute('aria-valuemax', '1000');
    expect(bar).toHaveAttribute('aria-valuetext', '412 of 1,000 rows, 3 failed');
    expect(screen.getByText('409 done · 3 failed · 588 in flight')).toBeInTheDocument();
  });

  it('announces when the work finishes, not before', () => {
    const { rerender } = renderWithProviders(
      <CollectionProgress density="compact" status="running" text="Running: 1 of 2 rows" />,
    );
    expect(document.getElementById('live-region-polite')).toHaveTextContent('');
    rerender(<CollectionProgress density="compact" status="completed" text="Completed: 2 rows" />);
  });
});
