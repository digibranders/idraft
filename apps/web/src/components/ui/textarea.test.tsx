import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Field, FieldDescription, FieldLabel } from './field';
import { Textarea } from './textarea';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('Textarea', () => {
  it('is named by its field and described by the helper text and the counter', async () => {
    const { container } = renderWithProviders(
      <Field>
        <FieldLabel>Sample answer</FieldLabel>
        <Textarea defaultValue="Northwind" counter="9 of 10" />
        <FieldDescription>Paste an answer from an AI engine.</FieldDescription>
      </Field>,
    );
    const area = screen.getByRole('textbox', { name: 'Sample answer' });
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).toHaveAccessibleDescription(expect.stringContaining('9 of 10'));
    expect(area).toHaveAccessibleDescription(expect.stringContaining('Paste an answer from an AI engine.'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('turns the counter to the negative color over the limit, and shows none without one', () => {
    const { rerender } = renderWithProviders(
      <Field>
        <FieldLabel>Notes</FieldLabel>
        <Textarea counter="11 of 10" counterOver />
      </Field>,
    );
    expect(screen.getByText('11 of 10')).toHaveClass('text-negative-text');
    rerender(
      <Field>
        <FieldLabel>Notes</FieldLabel>
        <Textarea counter={null} />
      </Field>,
    );
    expect(screen.queryByText('11 of 10')).toBeNull();
  });

  it('follows a controlled value, also when it is reset from outside', async () => {
    function Controlled(): ReactElement {
      const [text, setText] = useState('');
      return (
        <Field>
          <FieldLabel>Notes</FieldLabel>
          <Textarea value={text} onChange={(event) => setText(event.target.value)} />
          <button type="button" onClick={() => setText('')}>
            Reset
          </button>
          <output>{text}</output>
        </Field>
      );
    }
    const { user } = renderWithProviders(<Controlled />);
    const area = screen.getByRole('textbox', { name: 'Notes' });
    await user.type(area, 'hello');
    expect(screen.getByText('hello', { selector: 'output' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(area).toHaveValue('');
    expect(area).not.toHaveAttribute('data-filled');
  });

  it('is disabled with the disabled look, inside a field or not', () => {
    renderWithProviders(<Textarea aria-label="Locked" disabled />);
    const area = screen.getByRole('textbox', { name: 'Locked' });
    expect(area).toBeDisabled();
    expect(area).toHaveAttribute('data-disabled');
  });

  it('submits its form with Cmd or Ctrl and Enter when asked to, and keeps Enter for new lines', async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const { user } = renderWithProviders(
      <form
        onSubmit={(event) => {
          onSubmit(event.nativeEvent as SubmitEvent);
        }}
      >
        <Field>
          <FieldLabel>Prompt</FieldLabel>
          <Textarea submitOnModEnter />
        </Field>
      </form>,
    );
    const area = screen.getByRole('textbox', { name: 'Prompt' });
    await user.type(area, 'first{Enter}second');
    expect(area).toHaveValue('first\nsecond');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});
