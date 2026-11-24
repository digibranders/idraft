import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { VolumeReading } from '../facts';
import type { Translate } from '../seams/shared';
import { volumeColumn } from './volume-column';
import { renderWithProviders } from '@/test/render';

// The key stands in for the words, so the test names the state and not its copy
const t = ((key: string) => key) as unknown as Translate;

function cellText(reading: VolumeReading): string | null {
  const column = volumeColumn<null>(t, () => reading);
  renderWithProviders(<div data-testid="cell">{column.cell(null)}</div>);
  return screen.getByTestId('cell').textContent;
}

describe('volumeColumn', () => {
  it('says Fetching while the keyword is not measured', () => {
    expect(cellText({ state: 'unknown', reason: 'pending' })).toContain('prompts.metrics.volume.fetching');
  });

  it('says n/a, not Fetching, once the provider has no volume for the phrase', () => {
    const text = cellText({ state: 'unknown', reason: 'no_volume' });
    expect(text).toContain('n/a');
    expect(text).not.toContain('fetching');
  });

  it('shows the number when there is one', () => {
    expect(cellText({ state: 'ok', value: 1190, keyword: 'crm software' })).toBe('1,190');
  });
});
