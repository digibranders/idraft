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
    <CitationsControls engines={ENGINES} labelOf={labelOf} engine="all" onEngineChange={() => undefined} {...over} />,
  );
}

describe('the engine choice', () => {
  it('lists All engines then the enabled engines in order', () => {
    renderControls();
    const group = screen.getByRole('radiogroup', { name: 'Platform' });
    const radios = within(group).getAllByRole('radio');
    ['All platforms', 'ChatGPT', 'Gemini', 'Google AI Mode'].forEach((name, index) => {
      expect(radios[index]).toHaveAccessibleName(name);
    });
    expect(radios).toHaveLength(4);
    expect(within(group).getByRole('radio', { name: 'All platforms' })).toBeChecked();
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

describe('the unit of the lists', () => {
  it('has no minimum of citation units, which is of another unit than the answers the lists count', () => {
    renderControls();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('accessibility', () => {
  it('is axe clean', async () => {
    const { container } = renderControls();
    expect(await axe(container)).toHaveNoViolations();
  });
});
