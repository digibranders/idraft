import { zodResolver } from '@hookform/resolvers/zod';
import { act, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { FormField } from './form-field';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { applyServerErrors } from '@/lib/forms';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const Schema = z.object({
  name: z.string().min(1, { error: 'Enter a project name' }).max(20, { error: 'Use 20 characters at most' }),
  slug: z.string().min(3, { error: 'Use at least 3 characters' }),
  note: z.string(),
  device: z.enum(['desktop', 'mobile']),
});
type Values = z.infer<typeof Schema>;

function ProjectForm({
  onSubmit = vi.fn(),
  expose,
}: {
  onSubmit?: (values: Values) => void;
  expose?: (form: UseFormReturn<Values>) => void;
}): ReactElement {
  const form = useForm<Values>({
    resolver: zodResolver(Schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    shouldFocusError: true,
    defaultValues: { name: '', slug: '', note: '', device: 'desktop' },
  });
  expose?.(form);
  return (
    <form noValidate aria-label="Project" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
      <FormField
        control={form.control}
        name="name"
        label="Project name"
        description="Shown in the project switcher"
        render={(field) => <Input {...field.controlProps} value={field.value} onValueChange={field.onChange} />}
      />
      <FormField
        control={form.control}
        name="slug"
        label="Slug"
        render={(field) => <Input {...field.controlProps} value={field.value} onValueChange={field.onChange} />}
      />
      <FormField
        control={form.control}
        name="note"
        label="Note"
        optional
        render={(field) => <Input {...field.controlProps} value={field.value} onValueChange={field.onChange} />}
      />
      <FormField
        control={form.control}
        name="device"
        label="Device"
        kind="group"
        render={(field) => (
          <SegmentedControl
            semantics="radio"
            label={field.label}
            value={field.value}
            onValueChange={field.onChange}
            focusRef={field.ref}
            aria-required={field.required}
            items={[
              { value: 'desktop', label: 'Desktop' },
              { value: 'mobile', label: 'Mobile' },
            ]}
          />
        )}
      />
      <button type="submit">Create project</button>
    </form>
  );
}
const name = (): HTMLElement => screen.getByRole('textbox', { name: 'Project name' });
const slug = (): HTMLElement => screen.getByRole('textbox', { name: 'Slug' });

describe('FormField', () => {
  it('renders the label, the control and the helper text, wired together', () => {
    renderWithProviders(<ProjectForm />);
    expect(name()).toHaveAccessibleDescription('Shown in the project switcher');
    expect(name()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('marks optional fields in words from the catalog and tells the control the others are required', () => {
    renderWithProviders(<ProjectForm />);
    expect(screen.getByRole('textbox', { name: 'Note (optional)' })).toHaveAttribute('aria-required', 'false');
    expect(name()).toHaveAttribute('aria-required', 'true');
  });

  it('shows nothing when the user only tabs through an empty field', async () => {
    const { user } = renderWithProviders(<ProjectForm />);
    await user.click(name());
    await user.tab();
    expect(screen.queryByText('Enter a project name')).toBeNull();
    expect(name()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the error after the first blur of a changed field, in place of the helper text', async () => {
    const { user } = renderWithProviders(<ProjectForm />);
    await user.type(name(), 'A project name that is far too long');
    expect(screen.queryByText('Use 20 characters at most')).toBeNull();
    await user.tab();
    expect(await screen.findByText('Use 20 characters at most')).toBeInTheDocument();
    expect(screen.queryByText('Shown in the project switcher')).toBeNull();
    expect(name()).toHaveAttribute('aria-invalid', 'true');
    expect(name()).toHaveAccessibleDescription('Use 20 characters at most');
  });

  it('updates the error on every change once it is shown, and brings the helper text back when it is fixed', async () => {
    const { user } = renderWithProviders(<ProjectForm />);
    await user.type(name(), 'A project name that is far too long');
    await user.tab();
    await screen.findByText('Use 20 characters at most');
    await user.clear(name());
    expect(await screen.findByText('Enter a project name')).toBeInTheDocument();
    await user.type(name(), 'Fynix');
    await waitFor(() => expect(screen.queryByText('Enter a project name')).toBeNull());
    expect(screen.getByText('Shown in the project switcher')).toBeInTheDocument();
  });

  it('does not show an error while the user is still typing in a field that was only tabbed through before', async () => {
    const { user } = renderWithProviders(<ProjectForm />);
    await user.click(slug());
    await user.tab();
    await user.click(slug());
    await user.type(slug(), 'ab');
    expect(screen.queryByText('Use at least 3 characters')).toBeNull();
    expect(slug()).not.toHaveAttribute('aria-invalid', 'true');
    await user.tab();
    expect(await screen.findByText('Use at least 3 characters')).toBeInTheDocument();
    expect(slug()).toHaveAttribute('aria-invalid', 'true');
  });

  it.each([
    ['without values, as Discard does', undefined],
    ['with the saved values', { name: '', slug: '', note: '', device: 'desktop' } as const],
  ])('starts over after a reset %s: tabbing through the form shows nothing', async (_case, values) => {
    let form: UseFormReturn<Values> | undefined;
    const { user } = renderWithProviders(
      <ProjectForm
        expose={(instance) => {
          form = instance;
        }}
      />,
    );
    await user.type(name(), 'A project name that is far too long');
    await user.tab();
    expect(await screen.findByText('Use 20 characters at most')).toBeInTheDocument();
    if (!form) throw new Error('The form was not exposed');
    const current = form;
    act(() => current.reset(values));
    await waitFor(() => expect(screen.queryByText('Use 20 characters at most')).toBeNull());
    await user.click(name());
    await user.tab();
    expect(screen.queryByText('Enter a project name')).toBeNull();
    expect(name()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('moves focus into a group control when it is the first wrong field of a failed submit', async () => {
    const Choice = z.object({
      action: z
        .enum(['pause', 'notify'])
        .nullable()
        .refine((value) => value !== null, { error: 'Choose what happens at the limit' }),
    });
    function ChoiceForm(): ReactElement {
      const form = useForm<z.input<typeof Choice>, unknown, z.output<typeof Choice>>({
        resolver: zodResolver(Choice),
        defaultValues: { action: null },
      });
      return (
        <form noValidate aria-label="Budget" onSubmit={(event) => void form.handleSubmit(vi.fn())(event)}>
          <FormField
            control={form.control}
            name="action"
            label="At the hard limit"
            kind="group"
            render={(field) => (
              <RadioGroup
                legend={field.label}
                value={field.value}
                onValueChange={field.onChange}
                focusRef={field.ref}
                aria-required={field.required}
                options={[
                  { value: 'pause', label: 'Pause collection' },
                  { value: 'notify', label: 'Notify only' },
                ]}
              />
            )}
          />
          <button type="submit">Save</button>
        </form>
      );
    }
    const { user } = renderWithProviders(<ChoiceForm />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose what happens at the limit')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Pause collection' })).toHaveFocus());
    expect(screen.getByRole('radiogroup', { name: 'At the hard limit' })).toHaveAttribute('aria-required', 'true');
  });

  it('shows every error on submit, keeps what was typed and moves focus to the first wrong field', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(<ProjectForm onSubmit={onSubmit} />);
    await user.type(slug(), 'ab');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Enter a project name')).toBeInTheDocument();
    expect(screen.getByText('Use at least 3 characters')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(slug()).toHaveValue('ab');
    await waitFor(() => expect(name()).toHaveFocus());
  });

  it('submits the values when everything is valid', async () => {
    const onSubmit = vi.fn();
    const { user } = renderWithProviders(<ProjectForm onSubmit={onSubmit} />);
    await user.type(name(), 'Fynix');
    await user.type(slug(), 'fynix');
    await user.click(screen.getByRole('radio', { name: 'Mobile' }));
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ name: 'Fynix', slug: 'fynix', note: '', device: 'mobile' });
  });

  it('lets a group control show the label as its legend, without a second label', () => {
    renderWithProviders(<ProjectForm />);
    expect(screen.getByRole('group', { name: 'Device' })).toBeInTheDocument();
    expect(screen.getAllByText('Device')).toHaveLength(1);
  });

  it('shows a server error on its field, moves focus there, and clears it when the field changes', async () => {
    let form: UseFormReturn<Values> | undefined;
    const { user } = renderWithProviders(
      <ProjectForm
        expose={(instance) => {
          form = instance;
        }}
      />,
    );
    await user.type(name(), 'Fynix');
    await user.type(slug(), 'projects');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    if (!form) throw new Error('The form was not exposed');
    const current = form;
    const rest = await waitFor(() =>
      applyServerErrors(
        current,
        [
          {
            location: 'body',
            path: 'slug',
            code: 'slug_reserved',
            message: 'This slug is reserved. Choose another one.',
          },
          { location: 'body', path: 'timezone', code: 'timezone_unknown', message: 'Unknown time zone.' },
        ],
        { fields: ['name', 'slug', 'note', 'device'] },
      ),
    );
    expect(rest.map((entry) => entry.path)).toEqual(['timezone']);
    expect(await screen.findByText('This slug is reserved. Choose another one.')).toBeInTheDocument();
    expect(slug()).toHaveFocus();
    expect(slug()).toHaveAttribute('aria-invalid', 'true');
    await user.type(slug(), '-2');
    await waitFor(() => expect(screen.queryByText('This slug is reserved. Choose another one.')).toBeNull());
  });

  it('has no accessibility violations, pristine and with errors', async () => {
    const { user, container } = renderWithProviders(<ProjectForm />);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await screen.findByText('Enter a project name');
    expect(await axe(container)).toHaveNoViolations();
  });
});
