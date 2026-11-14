import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CitationsControls, type CitationsControlsProps } from './citations-controls';
import type { ProjectEngine } from '@/lib/api/types';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const engine = (code: keyof typeof ENGINE_FACTS): ProjectEngine => ({
  active_prompts: 1,
  engine: ENGINE_FACTS[code],
  estimated_monthly_cost_usd: null,
  is_configured: true,
  is_enabled: true,
  location_ids: [2276],
  provider_code: 'openai',
  replicates: 1,
});

// Out of order on purpose: the control lists them in the fixed engine order
const ENGINES = [engine('google_ai_mode'), engine('chatgpt_web'), engine('gemini_web')];
const labelOf = (code: string): string => ENGINE_FACTS[code as keyof typeof ENGINE_FACTS].label;

function renderControls(over: Partial<CitationsControlsProps> = {}): ProvidedRender {
  return renderWithProviders(
    <CitationsControls
      engines={ENGINES}
      labelOf={labelOf}
      engine="all"
      onEngineChange={() => undefined}
      minSupport={1}
      onMinSupportChange={() => undefined}
      {...over}
    />,
  );
}

describe('the engine choice', () => {
  it('lists All engines then the enabled engines in order', () => {
    renderControls();
    const group = screen.getByRole('radiogroup', { name: 'Engine' });
    const radios = within(group).getAllByRole('radio');
    ['All engines', 'ChatGPT', 'Gemini', 'Google AI Mode'].forEach((name, index) => {
      expect(radios[index]).toHaveAccessibleName(name);
    });
    expect(radios).toHaveLength(4);
    expect(within(group).getByRole('radio', { name: 'All engines' })).toBeChecked();
  });

  it('hands the chosen engine code over', async () => {
    const onEngineChange = vi.fn();
    const { user } = renderControls({ onEngineChange });
    await user.click(screen.getByRole('radio', { name: 'Gemini' }));
    expect(onEngineChange).toHaveBeenCalledWith('gemini_web');
  });

  it('is left out with no enabled engine', () => {
    renderControls({ engines: [] });
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('the minimum of units', () => {
  it('shows the choice and offers 1, 2 and 3', async () => {
    const { user } = renderControls();
    const select = screen.getByRole('combobox', { name: 'Fewest units per row' });
    expect(select).toHaveTextContent('At least 1 unit');
    await user.click(select);
    const list = await screen.findByRole('listbox');
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['At least 1 unit', 'At least 2 units', 'At least 3 units']);
  });

  it('hands the chosen number over', async () => {
    const onMinSupportChange = vi.fn();
    const { user } = renderControls({ onMinSupportChange });
    await user.click(screen.getByRole('combobox', { name: 'Fewest units per row' }));
    await user.click(await screen.findByRole('option', { name: 'At least 2 units' }));
    expect(onMinSupportChange).toHaveBeenCalledWith(2);
  });
});

describe('accessibility', () => {
  it('is axe clean', async () => {
    const { container } = renderControls();
    expect(await axe(container)).toHaveNoViolations();
  });
});
