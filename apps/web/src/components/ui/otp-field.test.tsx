import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Field, FieldLabel } from './field';
import { OtpField } from './otp-field';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const cells = (): HTMLInputElement[] => screen.getAllByRole<HTMLInputElement>('textbox');
const code = (): string =>
  cells()
    .map((cell) => cell.value)
    .join('');

describe('OtpField', () => {
  it('has six cells for an authenticator code, named by the field label', () => {
    renderWithProviders(
      <Field>
        <FieldLabel>Authentication code</FieldLabel>
        <OtpField />
      </Field>,
    );
    expect(cells()).toHaveLength(6);
    expect(screen.getByRole('group', { name: 'Authentication code' })).toBeInTheDocument();
    for (const cell of cells()) expect(cell).toHaveAccessibleName(/Authentication code/);
  });

  it('lets the browser offer a code from a message and asks for the numeric keyboard', () => {
    renderWithProviders(
      <Field>
        <FieldLabel>Authentication code</FieldLabel>
        <OtpField />
      </Field>,
    );
    expect(cells()[0]).toHaveAttribute('autocomplete', 'one-time-code');
    expect(cells()[0]).toHaveAttribute('inputmode', 'numeric');
  });

  it('moves to the next cell as digits are typed and reports the complete code once', async () => {
    const onValueChange = vi.fn();
    const onValueComplete = vi.fn();
    const { user } = renderWithProviders(
      <Field>
        <FieldLabel>Authentication code</FieldLabel>
        <OtpField onValueChange={onValueChange} onValueComplete={onValueComplete} />
      </Field>,
    );
    await user.click(cells()[0] as HTMLElement);
    await user.keyboard('123');
    expect(code()).toBe('123');
    expect(cells()[3]).toHaveFocus();
    expect(onValueComplete).not.toHaveBeenCalled();
    await user.keyboard('456');
    expect(code()).toBe('123456');
    expect(onValueChange).toHaveBeenLastCalledWith('123456', expect.anything());
    expect(onValueComplete).toHaveBeenCalledTimes(1);
    expect(onValueComplete).toHaveBeenCalledWith('123456', expect.anything());
  });

  it('fills every cell from a pasted code (WCAG 3.3.8)', async () => {
    const { user } = renderWithProviders(
      <Field>
        <FieldLabel>Authentication code</FieldLabel>
        <OtpField />
      </Field>,
    );
    await user.click(cells()[0] as HTMLElement);
    await user.paste('904 512');
    expect(code()).toBe('904512');
  });

  it('takes digits only', async () => {
    const { user } = renderWithProviders(
      <Field>
        <FieldLabel>Authentication code</FieldLabel>
        <OtpField />
      </Field>,
    );
    await user.click(cells()[0] as HTMLElement);
    await user.keyboard('a1b2');
    expect(code()).toBe('12');
  });

  it('goes back with Backspace and moves with the arrow keys', async () => {
    const { user } = renderWithProviders(
      <Field>
        <FieldLabel>Authentication code</FieldLabel>
        <OtpField />
      </Field>,
    );
    await user.click(cells()[0] as HTMLElement);
    await user.keyboard('123');
    await user.keyboard('{Backspace}');
    expect(code()).toBe('12');
    expect(cells()[2]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(cells()[1]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(cells()[2]).toHaveFocus();
  });

  it('takes nothing when disabled', async () => {
    const onValueChange = vi.fn();
    const { user } = renderWithProviders(
      <Field>
        <FieldLabel>Authentication code</FieldLabel>
        <OtpField disabled onValueChange={onValueChange} />
      </Field>,
    );
    for (const cell of cells()) expect(cell).toBeDisabled();
    await user.click(cells()[0] as HTMLElement);
    await user.keyboard('1');
    expect(onValueChange).not.toHaveBeenCalled();
    expect(cells()[0]).toHaveClass('data-disabled:bg-surface-disabled');
  });

  it('shows the value it is given and hands its first cell to the caller', () => {
    const inputRef = { current: null as HTMLInputElement | null };
    renderWithProviders(
      <Field>
        <FieldLabel>Authentication code</FieldLabel>
        <OtpField value="12" inputRef={inputRef} />
      </Field>,
    );
    expect(code()).toBe('12');
    expect(inputRef.current).toBe(cells()[0]);
  });

  it('draws 40 px cells that show the invalid state', () => {
    const { container } = renderWithProviders(
      <Field invalid>
        <FieldLabel>Authentication code</FieldLabel>
        <OtpField />
      </Field>,
    );
    expect(cells()[0]).toHaveClass('size-control-lg', 'rounded-md', 'border', 'num', 'focus-visible:focus-ring');
    expect(cells()[0]).toHaveAttribute('aria-invalid', 'true');
    expect(container.querySelector('[data-slot="otp-field"]')).toHaveClass('flex', 'gap-2');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <Field>
        <FieldLabel>Authentication code</FieldLabel>
        <OtpField />
      </Field>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
