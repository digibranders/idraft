import { screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Field, FieldLabel } from './field';
import { MultiSelect, type MultiSelectProps } from './multi-select';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const TAGS: readonly string[] = ['brand', 'pricing', 'q4-launch'];

function TagField(
  props: Partial<MultiSelectProps<string>> & {
    initial?: readonly string[];
    onChange?: (next: readonly string[]) => void;
  },
): ReactElement {
  const { initial = [], onChange, ...rest } = props;
  const [value, setValue] = useState<readonly string[]>(initial);
  return (
    <Field>
      <FieldLabel>Tags</FieldLabel>
      <MultiSelect
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        items={TAGS}
        itemToString={(tag) => tag}
        itemKey={(tag) => tag}
        placeholder="brand"
        emptyText={(query) => `No tags match "${query}"`}
        chipsLabel="Chosen tags"
        removeLabel={(tag) => `Remove ${tag}`}
        chipsHint={(count) => `${count} chosen. Press Left Arrow to reach them.`}
        chipHint="Press Backspace or Delete to remove"
        {...rest}
      />
    </Field>
  );
}
const input = (): HTMLElement => screen.getByRole('combobox', { name: 'Tags' });

describe('MultiSelect', () => {
  it('adds the values that are picked as chips and empties the field for the next one', async () => {
    const onChange = vi.fn();
    const { user, container } = renderWithProviders(<TagField onChange={onChange} />);
    expect(input()).toHaveAttribute('placeholder', 'brand');
    await user.click(input());
    await user.keyboard('pri');
    await user.click(await screen.findByRole('option', { name: 'pricing' }));
    expect(onChange).toHaveBeenLastCalledWith(['pricing']);
    const chips = screen.getByRole('toolbar', { name: 'Chosen tags' });
    expect(within(chips).getByText('pricing')).toBeInTheDocument();
    expect(input()).toHaveValue('');
    expect(input()).toHaveAttribute('placeholder', '');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('removes a chip with its button and the last one with Backspace in the empty field', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<TagField initial={['brand', 'pricing']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Remove brand' }));
    expect(onChange).toHaveBeenLastCalledWith(['pricing']);
    await user.click(input());
    await user.keyboard('{Backspace}');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([]));
  });

  it('adds what was typed when it is creatable, with Enter, once', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <TagField
        items={[]}
        onChange={onChange}
        creatable={{ label: (query) => `Add "${query}"`, onCreate: (query) => query }}
        emptyText={() => 'Type an alias and press Enter'}
      />,
    );
    await user.click(input());
    expect(await screen.findByText('Type an alias and press Enter')).toBeInTheDocument();
    await user.keyboard('HubSpot CRM');
    expect(await screen.findByRole('option', { name: 'Add "HubSpot CRM"' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(['HubSpot CRM']));
    // A value that is chosen already offers no second add row
    await user.keyboard('hubspot crm');
    await waitFor(() => expect(screen.queryByRole('option', { name: /^Add/ })).toBeNull());
  });

  it('keeps the list open after a pick, and never offers a chosen value as a row', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<TagField initial={['brand']} onChange={onChange} />);
    await user.click(input());
    await user.keyboard('pri');
    await user.click(await screen.findByRole('option', { name: 'pricing' }));
    expect(onChange).toHaveBeenLastCalledWith(['brand', 'pricing']);
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    // Enter on what is typed cannot take a chosen value away
    await user.keyboard('brand{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('option', { name: 'brand' })).toBeNull();
  });

  it('adds what was typed with Enter before a suggestion that only contains it', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <TagField onChange={onChange} creatable={{ label: (query) => `Add "${query}"`, onCreate: (query) => query }} />,
    );
    await user.click(input());
    await user.keyboard('pri');
    const rows = await screen.findAllByRole('option');
    expect(rows.map((row) => row.textContent)).toEqual(['Add "pri"', 'pricing']);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(['pri']));
  });

  it('keeps what was typed as a value when focus leaves the field, once, and reports the blur once', async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const { user } = renderWithProviders(
      <>
        <TagField
          items={[]}
          initial={['HubSpot']}
          itemKey={(alias) => alias.toLocaleLowerCase()}
          onChange={onChange}
          onBlur={onBlur}
          creatable={{ label: (query) => `Add "${query}"`, onCreate: (query) => query }}
        />
        <button type="button">Save</button>
      </>,
    );
    await user.click(input());
    // Moving to the chips and back is not leaving the field
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('{ArrowRight}');
    expect(onBlur).not.toHaveBeenCalled();
    await user.keyboard('HubSpot CRM');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save', hidden: true })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith(['HubSpot', 'HubSpot CRM']);
    expect(onBlur).toHaveBeenCalledTimes(1);
    // A typed value equal to a chosen one, in another case, is not added again
    onChange.mockClear();
    await user.click(input());
    await user.keyboard('hubspot crm');
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('names its open list after the field', async () => {
    const { user } = renderWithProviders(<TagField />);
    await user.click(input());
    await user.keyboard('p');
    expect(await screen.findByRole('listbox', { name: 'Tags' })).toBeInTheDocument();
  });

  it('says so when nothing matches what was typed', async () => {
    const { user } = renderWithProviders(<TagField />);
    await user.click(input());
    await user.keyboard('zzz');
    expect(await screen.findByText('No tags match "zzz"')).toBeInTheDocument();
  });

  it('describes how to reach the chips once there are some', () => {
    renderWithProviders(<TagField initial={['brand']} />);
    expect(input()).toHaveAttribute('aria-description', '1 chosen. Press Left Arrow to reach them.');
  });
});
