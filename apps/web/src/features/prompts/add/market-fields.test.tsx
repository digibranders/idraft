import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialValues, type AddValues } from './add-values';
import { MarketFields } from './market-fields';
import type { ProjectEngine } from '@/lib/api/types';
import type { Country } from '@/lib/locations/countries';
import { navigateTo, resetNavigation } from '@/test/next-navigation';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

beforeEach(() => {
  resetNavigation();
});

const COUNTRIES = [
  { location_id: 1, country_iso: 'DE', name: 'Germany' },
  { location_id: 2, country_iso: 'IN', name: 'India' },
] as Country[];
const ENGINE = { engine: { engine_code: 'chatgpt_web', label: 'ChatGPT' }, location_ids: [1, 2] } as ProjectEngine;

function Fields({ engines }: { engines: readonly ProjectEngine[] }): ReactElement {
  const form = useForm<AddValues>({ defaultValues: initialValues({ languageCode: 'en', countryIso: 'DE' }) });
  return (
    <MarketFields
      control={form.control}
      engines={engines}
      countries={COUNTRIES}
      countriesFailed={false}
      onRetry={() => undefined}
    />
  );
}

describe('the engine settings link', () => {
  it('opens the project’s engine settings in a new tab, and says so', () => {
    navigateTo('/digibranders/fynix/ai/prompts');
    renderWithProviders(<Fields engines={[ENGINE]} />);
    const link = screen.getByRole('link', { name: /Engine settings/ });
    expect(link).toHaveAttribute('href', '/digibranders/fynix/settings/engines');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleName('Engine settings (opens in a new tab)');
  });

  it('is in the no-engine warning too', () => {
    navigateTo('/digibranders/fynix/ai/prompts');
    renderWithProviders(<Fields engines={[]} />);
    expect(screen.getByText('No engine is on, so these prompts will not be asked until one is.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Engine settings/ })).toHaveAttribute(
      'href',
      '/digibranders/fynix/settings/engines',
    );
  });
});
