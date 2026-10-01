import { screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import { Combobox, type ComboboxProps } from './combobox';
import { Field, FieldLabel } from './field';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

interface Location {
  id: string;
  name: string;
  kind: 'Countries' | 'Cities';
}
const LOCATIONS: readonly Location[] = [
  { id: 'de', name: 'Germany', kind: 'Countries' },
  { id: 'us', name: 'United States', kind: 'Countries' },
  { id: 'ber', name: 'Berlin', kind: 'Cities' },
  { id: 'bos', name: 'Boston', kind: 'Cities' },
];

function LocationField(
  props: Partial<ComboboxProps<Location>> & { onChange?: (value: Location | null) => void },
): ReactElement {
  const { onChange, ...rest } = props;
  const [value, setValue] = useState<Location | null>(null);
  return (
    <Field>
      <FieldLabel>Location</FieldLabel>
      <Combobox
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        items={LOCATIONS}
        itemToString={(item) => item.name}
        itemKey={(item) => item.id}
        emptyText={(query) => `No locations match "${query}"`}
        placeholder="Berlin"
        clearLabel="Clear"
        openLabel="Show locations"
        {...rest}
      />
    </Field>
  );
}
const input = (): HTMLElement => screen.getByRole('combobox', { name: 'Location' });

describe('Combobox', () => {
  it('is an editable combobox named by its field label, closed at first', () => {
    renderWithProviders(<LocationField />);
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(input()).toHaveAttribute('placeholder', 'Berlin');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('names its open list after the field, as it names the text field', async () => {
    const { user } = renderWithProviders(<LocationField />);
    await user.click(input());
    await user.keyboard('b');
    expect(await screen.findByRole('listbox', { name: 'Location' })).toBeInTheDocument();
  });

  it('lists the items that match what is typed and takes the one that is clicked', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<LocationField onChange={onChange} />);
    await user.click(input());
    await user.keyboard('b');
    const list = await screen.findByRole('listbox');
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Berlin', 'Boston']),
    );
    await user.click(within(list).getByRole('option', { name: 'Boston' }));
    expect(onChange).toHaveBeenLastCalledWith(LOCATIONS[3]);
    await waitFor(() => expect(input()).toHaveValue('Boston'));
  });

  it('works from the keyboard with focus staying in the text field', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<LocationField onChange={onChange} />);
    await user.click(input());
    await user.keyboard('ger');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Germany' })).toHaveAttribute('data-highlighted'));
    expect(input()).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(LOCATIONS[0]));
  });

  it('says so when nothing matches, quoting what was typed', async () => {
    const { user } = renderWithProviders(<LocationField />);
    await user.click(input());
    await user.keyboard('zzz');
    expect(await screen.findByText('No locations match "zzz"')).toHaveClass('type-meta');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('lists items under the name of their group', async () => {
    const { user } = renderWithProviders(<LocationField groupOf={(item) => item.kind} />);
    await user.click(screen.getByRole('button', { name: 'Show locations' }));
    const list = await screen.findByRole('listbox');
    expect(within(list).getByRole('group', { name: 'Countries' })).toBeInTheDocument();
    expect(within(within(list).getByRole('group', { name: 'Cities' })).getAllByRole('option')).toHaveLength(2);
  });

  it('removes the value with the Clear button', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<LocationField onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Show locations' }));
    await user.click(await screen.findByRole('option', { name: 'Germany' }));
    await waitFor(() => expect(input()).toHaveValue('Germany'));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(input()).toHaveValue(''));
  });

  it('shows the items as given and reports what is typed in server mode, but not the name of a chosen item', async () => {
    const onQueryChange = vi.fn();
    const { user } = renderWithProviders(<LocationField onQueryChange={onQueryChange} />);
    await user.click(input());
    await user.keyboard('xy');
    expect(onQueryChange).toHaveBeenLastCalledWith('xy');
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(4);
    onQueryChange.mockClear();
    await user.click(within(list).getByRole('option', { name: 'Berlin' }));
    await waitFor(() => expect(input()).toHaveValue('Berlin'));
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it('shows that a search is running and keeps the previous results', async () => {
    const { user } = renderWithProviders(<LocationField onQueryChange={vi.fn()} loading loadingText="Searching" />);
    await user.click(input());
    await user.keyboard('be');
    expect(await screen.findByText('Searching')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('does not say "no match" while a search is still running', async () => {
    const { user } = renderWithProviders(
      <LocationField items={[]} onQueryChange={vi.fn()} loading loadingText="Searching" />,
    );
    await user.click(input());
    await user.keyboard('be');
    expect(await screen.findByText('Searching')).toBeInTheDocument();
    expect(screen.queryByText('No locations match "be"')).toBeNull();
  });

  it('goes back to its value when the field is left with text that matches nothing', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <>
        <LocationField onChange={onChange} />
        <button type="button">Elsewhere</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Show locations' }));
    await user.click(await screen.findByRole('option', { name: 'Germany' }));
    await waitFor(() => expect(input()).toHaveValue('Germany'));
    onChange.mockClear();
    await user.click(input());
    await user.keyboard('zzz');
    expect(input()).toHaveValue('Germanyzzz');
    await user.tab();
    await waitFor(() => expect(input()).toHaveValue('Germany'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('hands its text field to a form, with what the form needs on it', async () => {
    const inputRef = { current: null as HTMLInputElement | null };
    const onBlur = vi.fn();
    const { user } = renderWithProviders(
      <LocationField inputRef={inputRef} id="location" onBlur={onBlur} aria-required />,
    );
    expect(inputRef.current).toBe(input());
    expect(input()).toHaveAttribute('id', 'location');
    expect(input()).toHaveAttribute('aria-required', 'true');
    await user.click(input());
    await user.tab();
    expect(onBlur).toHaveBeenCalled();
  });

  it('gives its buttons their own names, not the label or the error of the field', () => {
    renderWithProviders(
      <Field invalid>
        <FieldLabel>Location</FieldLabel>
        <Combobox
          value={LOCATIONS[0] ?? null}
          onValueChange={vi.fn()}
          items={LOCATIONS}
          itemToString={(item) => item.name}
          itemKey={(item) => item.id}
          emptyText={(query) => `No locations match "${query}"`}
          placeholder="Berlin"
          clearLabel="Clear"
          openLabel="Show locations"
        />
      </Field>,
    );
    for (const name of ['Clear', 'Show locations']) {
      const button = screen.getByRole('button', { name });
      expect(button).not.toHaveAttribute('aria-labelledby');
      expect(button).not.toHaveAttribute('aria-invalid');
      expect(button).not.toHaveAttribute('aria-describedby');
    }
    expect(input()).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders a richer row when asked, and keeps the text as the name of the option', async () => {
    const { user } = renderWithProviders(
      <LocationField
        renderItem={(item) => (
          <span>
            {item.name} <span className="type-meta">{item.kind}</span>
          </span>
        )}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Show locations' }));
    expect(await screen.findByRole('option', { name: /Germany Countries/ })).toBeInTheDocument();
  });

  it('looks like a text input with its buttons inside, and opens a list as wide as itself', async () => {
    const { user, container } = renderWithProviders(<LocationField />);
    const group = container.querySelector('[data-slot="combobox"]');
    expect(group).toHaveClass('h-control', 'rounded-md', 'border', 'bg-surface', 'pr-1');
    await user.click(screen.getByRole('button', { name: 'Show locations' }));
    await screen.findByRole('listbox');
    const popup = document.querySelector('[data-slot="combobox-popup"]');
    expect(popup).toHaveClass('w-(--anchor-width)', 'rounded-lg', 'bg-surface-elevated', 'shadow-popover');
    expect(popup?.parentElement).toHaveClass('z-(--z-dropdown)');
    expect(screen.getByRole('option', { name: 'Germany' })).toHaveClass('min-h-8', 'rounded-md', 'type-body');
  });

  it('opens from a button with the search field inside the popup, and keeps a footer under the list', async () => {
    const create = vi.fn();
    const { user } = renderWithProviders(
      <Combobox
        value={LOCATIONS[0] ?? null}
        onValueChange={vi.fn()}
        items={LOCATIONS}
        itemToString={(item) => item.name}
        itemKey={(item) => item.id}
        emptyText={(query) => `No locations match "${query}"`}
        placeholder="Search locations"
        clearLabel="Clear"
        openLabel="Show locations"
        trigger={<Button>Germany</Button>}
        triggerLabel="Location: Germany"
        footer={
          <Button variant="ghost" size="sm" onClick={create}>
            Add location
          </Button>
        }
      />,
    );
    // With the search field in the popup, the button itself is the combobox that opens it
    await user.click(screen.getByRole('combobox', { name: 'Location: Germany' }));
    const search = await screen.findByRole('combobox', { name: 'Search locations' });
    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.getByRole('option', { name: 'Germany' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('dialog', { name: 'Search locations' })).toBeInTheDocument();
    await user.keyboard('bos');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    // The first match is ready to be chosen with Enter
    await waitFor(() => expect(screen.getByRole('option', { name: 'Boston' })).toHaveAttribute('data-highlighted'));
    await user.click(screen.getByRole('button', { name: 'Add location' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-slot="combobox-popup"]')).toHaveClass('w-popover-min');
  });

  it('cannot be opened when disabled', async () => {
    const { user } = renderWithProviders(<LocationField disabled />);
    expect(input()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Show locations' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('has no accessibility violations, closed or open', async () => {
    const { user, baseElement } = renderWithProviders(<LocationField groupOf={(item) => item.kind} />);
    expect(await axe(baseElement)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Show locations' }));
    await screen.findByRole('listbox');
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
