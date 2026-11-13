import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CountryScopeControl, type CountryScopeLabels } from './country-scope-control';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NAMES: Readonly<Record<string, string>> = { DE: 'Germany', IN: 'India', AT: 'Austria' };
const nameOf = (iso: string): string => NAMES[iso] ?? iso;
const LABELS: CountryScopeLabels = {
  country: (name) => `Country: ${name}`,
  allCountries: 'All countries',
  search: 'Search countries',
  empty: (query) => `No country matches ${query}`,
  clear: 'Clear',
  open: 'Show countries',
};

interface Props {
  country?: string | null;
  isos?: readonly string[];
  onCountryChange?: (iso: string | null) => void;
}

const control = ({
  country = null,
  isos = ['DE', 'IN'],
  onCountryChange = vi.fn(),
}: Props = {}): React.ReactElement => (
  <CountryScopeControl
    country={country}
    isos={isos}
    nameOf={nameOf}
    labels={LABELS}
    onCountryChange={onCountryChange}
  />
);

describe('CountryScopeControl', () => {
  it('shows All countries with its words taken from the labels', () => {
    renderWithProviders(control());
    expect(screen.getByRole('combobox', { name: 'Country: All countries' })).toBeInTheDocument();
  });

  it('lists all countries and each country of the prompts', async () => {
    const { user } = renderWithProviders(control());
    await user.click(screen.getByRole('combobox', { name: 'Country: All countries' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'All countries',
      'Germany',
      'India',
    ]);
  });

  it('choosing Germany calls onCountryChange with DE', async () => {
    const onCountryChange = vi.fn();
    const { user } = renderWithProviders(control({ onCountryChange }));
    await user.click(screen.getByRole('combobox', { name: 'Country: All countries' }));
    await user.click(await screen.findByRole('option', { name: 'Germany' }));
    expect(onCountryChange).toHaveBeenCalledExactlyOnceWith('DE');
  });

  it('choosing All countries calls onCountryChange with null', async () => {
    const onCountryChange = vi.fn();
    const { user } = renderWithProviders(control({ country: 'IN', onCountryChange }));
    await user.click(screen.getByRole('combobox', { name: 'Country: India' }));
    await user.click(await screen.findByRole('option', { name: 'All countries' }));
    expect(onCountryChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('with one country and none chosen it is a label, not a button', () => {
    renderWithProviders(control({ isos: ['DE'] }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Country: All countries')).toBeInTheDocument();
  });

  it('a link country that the prompts lack can still be left', async () => {
    const onCountryChange = vi.fn();
    const { user } = renderWithProviders(control({ country: 'ZZ', isos: ['ZZ'], onCountryChange }));
    await user.click(screen.getByRole('combobox', { name: 'Country: ZZ' }));
    await user.click(await screen.findByRole('option', { name: 'All countries' }));
    expect(onCountryChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('renders nothing when there is nothing to choose and no country is set', () => {
    renderWithProviders(control({ isos: [] }));
    // The providers draw their live regions: the control itself leaves no label, button or icon
    expect(screen.queryByText(/^Country:/)).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('svg')).toBeNull();
  });

  it('is still a choice when a country is set and no prompt has one', () => {
    renderWithProviders(control({ country: 'AT', isos: ['AT'] }));
    expect(screen.getByRole('combobox', { name: 'Country: Austria' })).toBeInTheDocument();
  });

  it('has no axe violation as a choice or as a label', async () => {
    const choice = renderWithProviders(control());
    expect(await axe(choice.container)).toHaveNoViolations();
    choice.unmount();
    const label = renderWithProviders(control({ isos: ['DE'] }));
    expect(await axe(label.container)).toHaveNoViolations();
  });
});
