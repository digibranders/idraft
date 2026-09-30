import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field, FieldLabel } from './field';
import { PasswordInput } from './password-input';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const LABELS = { showLabel: 'Show password', hideLabel: 'Hide password' };
const field = (): HTMLElement => screen.getByLabelText('Password');

describe('PasswordInput', () => {
  it('hides what is typed and tells password managers which password it is', () => {
    renderWithProviders(
      <Field>
        <FieldLabel>Password</FieldLabel>
        <PasswordInput autoComplete="current-password" {...LABELS} />
      </Field>,
    );
    expect(field()).toHaveAttribute('type', 'password');
    expect(field()).toHaveAttribute('autocomplete', 'current-password');
  });

  it('shows the password on request, with a button named by what it will do', async () => {
    const { user } = renderWithProviders(
      <Field>
        <FieldLabel>Password</FieldLabel>
        <PasswordInput autoComplete="new-password" {...LABELS} />
      </Field>,
    );
    await user.type(field(), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field()).toHaveAttribute('type', 'text');
    expect(field()).toHaveValue('correct horse');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).not.toHaveAttribute('aria-pressed');
    expect(hide).toHaveFocus();
    await user.click(hide);
    expect(field()).toHaveAttribute('type', 'password');
  });

  it('allows paste (WCAG 3.3.8)', async () => {
    const { user } = renderWithProviders(
      <Field>
        <FieldLabel>Password</FieldLabel>
        <PasswordInput autoComplete="current-password" {...LABELS} />
      </Field>,
    );
    await user.click(field());
    await user.paste('from-a-password-manager');
    expect(field()).toHaveValue('from-a-password-manager');
  });

  it('never corrects or capitalizes a password that is shown', async () => {
    const { user } = renderWithProviders(
      <Field>
        <FieldLabel>Password</FieldLabel>
        <PasswordInput autoComplete="current-password" {...LABELS} />
      </Field>,
    );
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field()).toHaveAttribute('spellcheck', 'false');
    expect(field()).toHaveAttribute('autocapitalize', 'none');
  });

  it('hands its input to the caller, so a failed submit can focus it', () => {
    const ref = { current: null as HTMLInputElement | null };
    renderWithProviders(
      <Field>
        <FieldLabel>Password</FieldLabel>
        <PasswordInput autoComplete="current-password" {...LABELS} ref={ref} name="password" />
      </Field>,
    );
    expect(ref.current).toBe(field());
    expect(field()).toHaveAttribute('name', 'password');
  });

  it('disables the input and its button together', () => {
    renderWithProviders(
      <Field>
        <FieldLabel>Password</FieldLabel>
        <PasswordInput autoComplete="current-password" {...LABELS} disabled />
      </Field>,
    );
    expect(field()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled();
  });

  it('is 40 px in auth screens', () => {
    const { container } = renderWithProviders(
      <Field>
        <FieldLabel>Password</FieldLabel>
        <PasswordInput autoComplete="current-password" {...LABELS} size="lg" />
      </Field>,
    );
    expect(container.querySelector('[data-slot="password-input"]')).toHaveClass('h-control-lg');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <Field>
        <FieldLabel>Password</FieldLabel>
        <PasswordInput autoComplete="current-password" {...LABELS} />
      </Field>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
