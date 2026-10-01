import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { DomainInput } from './domain-input';
import { Field, FieldLabel } from '@/components/ui/field';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

function DomainField({ invalid = false }: { invalid?: boolean }): ReactElement {
  const [value, setValue] = useState('');
  return (
    <Field invalid={invalid}>
      <FieldLabel>Domain</FieldLabel>
      <DomainInput value={value} onValueChange={setValue} invalid={invalid} description="The site to track." />
    </Field>
  );
}
const input = (): HTMLElement => screen.getByRole('textbox', { name: 'Domain' });

describe('DomainInput', () => {
  it('is a plain text field for a URL, with no autocomplete or spell check', async () => {
    const { container } = renderWithProviders(<DomainField />);
    expect(input()).toHaveAttribute('type', 'text');
    expect(input()).toHaveAttribute('inputmode', 'url');
    expect(input()).toHaveAttribute('autocomplete', 'off');
    expect(input()).toHaveAttribute('spellcheck', 'false');
    expect(input()).toHaveAccessibleDescription('The site to track.');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says what will be tracked, and which path it drops, in place of the helper text', async () => {
    const { user } = renderWithProviders(<DomainField />);
    await user.type(input(), 'https://www.hubspot.com/products/crm');
    expect(
      await screen.findByText(
        (_, element) => element?.textContent === 'Will track: hubspot.com (path /products/crm ignored)',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('hubspot.com')).toHaveClass('text-foreground');
    expect(screen.queryByText('The site to track.')).toBeNull();
    await user.clear(input());
    await user.type(input(), 'acme.com');
    expect(
      await screen.findByText((_, element) => element?.textContent === 'Will track: acme.com'),
    ).toBeInTheDocument();
  });

  it('keeps the helper text while the value cannot be read, and gives the line to an error', async () => {
    const { user, rerender } = renderWithProviders(<DomainField />);
    await user.type(input(), 'not a domain');
    expect(await screen.findByText('The site to track.')).toBeInTheDocument();
    rerender(<DomainField invalid />);
    expect(screen.queryByText('The site to track.')).toBeNull();
  });
});
