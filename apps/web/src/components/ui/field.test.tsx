import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field, FieldDescription, FieldError, FieldLabel, Fieldset, type FieldWidth } from './field';
import { Input } from './input';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('Field', () => {
  it('ties the label to the control, so clicking the label puts focus in it', async () => {
    const { user } = renderWithProviders(
      <Field>
        <FieldLabel>Project name</FieldLabel>
        <Input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Project name' });
    await user.click(screen.getByText('Project name'));
    expect(input).toHaveFocus();
  });

  it('stacks label, control and helper text 6 px apart', () => {
    const { container } = renderWithProviders(
      <Field>
        <FieldLabel>Project name</FieldLabel>
        <Input />
      </Field>,
    );
    expect(container.querySelector('[data-slot="field"]')).toHaveClass('flex', 'flex-col', 'gap-1.5');
    expect(screen.getByText('Project name')).toHaveClass('type-label');
  });

  it('marks an optional field in words, and required fields not at all', () => {
    renderWithProviders(
      <Field>
        <FieldLabel optional="(optional)">Job title</FieldLabel>
        <Input />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'Job title (optional)' })).toBeInTheDocument();
    expect(screen.getByText('(optional)')).toHaveClass('type-meta');
  });

  it('describes the control with the helper text', () => {
    renderWithProviders(
      <Field>
        <FieldLabel>Domain</FieldLabel>
        <Input />
        <FieldDescription>One domain, without https://</FieldDescription>
      </Field>,
    );
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('One domain, without https://');
    expect(screen.getByText('One domain, without https://')).toHaveClass('type-meta');
  });

  it('marks the control invalid and describes it with the error, which has an icon besides its color', () => {
    const { container } = renderWithProviders(
      <Field invalid>
        <FieldLabel>Domain</FieldLabel>
        <Input />
        <FieldError message="Enter a domain, for example example.com" />
      </Field>,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('data-invalid');
    expect(input).toHaveAccessibleDescription('Enter a domain, for example example.com');
    const error = container.querySelector('[data-slot="field-error"]');
    expect(error).toHaveClass('type-meta', 'text-negative-text');
    expect(error?.querySelector('svg')).toHaveClass('size-icon-xs');
  });

  it('keeps a label that is not shown, for inline forms', () => {
    renderWithProviders(
      <Field>
        <FieldLabel display="visually-hidden">Search keywords</FieldLabel>
        <Input placeholder="crm pricing" />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: 'Search keywords' })).toBeInTheDocument();
    expect(screen.getByText('Search keywords')).toHaveClass('sr-only');
  });

  it('disables its control', () => {
    renderWithProviders(
      <Field disabled>
        <FieldLabel>Language</FieldLabel>
        <Input />
      </Field>,
    );
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it.each<[FieldWidth, string]>([
    ['short', 'sm:w-30'],
    ['date', 'sm:w-40'],
    ['medium', 'sm:w-60'],
    ['long', 'sm:w-90'],
  ])('width %s is %s from 640 px and full below', (width, widthClass) => {
    const { container } = renderWithProviders(
      <Field width={width}>
        <FieldLabel>Value</FieldLabel>
        <Input />
      </Field>,
    );
    expect(container.querySelector('[data-slot="field"]')).toHaveClass('w-full', widthClass);
  });

  it('passes other attributes on to its root', () => {
    const { container } = renderWithProviders(
      <Field id="name-field" className="col-span-2">
        <FieldLabel>Name</FieldLabel>
        <Input />
      </Field>,
    );
    const root = container.querySelector('[data-slot="field"]');
    expect(root).toHaveAttribute('id', 'name-field');
    expect(root).toHaveClass('col-span-2', 'gap-1.5');
  });

  it('has no accessibility violations, valid or invalid', async () => {
    const { container } = renderWithProviders(
      <form>
        <Field>
          <FieldLabel optional="(optional)">Job title</FieldLabel>
          <Input />
          <FieldDescription>Shown to your team</FieldDescription>
        </Field>
        <Field invalid>
          <FieldLabel>Domain</FieldLabel>
          <Input />
          <FieldError message="Enter a domain, for example example.com" />
        </Field>
      </form>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Fieldset', () => {
  it('names a group of controls with its legend', () => {
    renderWithProviders(
      <Fieldset legend="Market">
        <Field>
          <FieldLabel>Location</FieldLabel>
          <Input />
        </Field>
        <Field>
          <FieldLabel>Language</FieldLabel>
          <Input />
        </Field>
      </Fieldset>,
    );
    const group = screen.getByRole('group', { name: 'Market' });
    expect(group).toContainElement(screen.getByRole('textbox', { name: 'Location' }));
    expect(screen.getByText('Market')).toHaveClass('type-label');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <Fieldset legend="Market">
        <Field>
          <FieldLabel>Location</FieldLabel>
          <Input />
        </Field>
      </Fieldset>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
