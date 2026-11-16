import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { atTrackedLimit, nextCompetitorColor, sameBrand, TRACKED_LIMIT } from './competitor-model';
import { ListPopover, ListRow } from './list-popover';
import { renderWithProviders } from '@/test/render';

function Harness(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="table">
      <ListPopover
        open={open}
        onOpenChange={setOpen}
        label="Open the list"
        trigger={<span>Northwind</span>}
        title="Brands mentioned in answers"
        subtitle="This prompt"
        note="A note"
      >
        <ListRow place={1} main={<span>Northwind</span>} value={<span>50%</span>} own />
      </ListPopover>
    </div>
  );
}

const closed = (): void => {
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
};

describe('the list popover', () => {
  it('is named by its title and holds the subtitle, the rows and the note', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open the list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Brands mentioned in answers' });
    expect(dialog).toHaveTextContent('This prompt');
    expect(dialog).toHaveTextContent('1Northwind50%');
    expect(dialog).toHaveTextContent('A note');
  });

  it('closes when anything but the list scrolls, and stays open when the list itself does', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open the list' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.scroll(dialog.querySelector('ol') as HTMLElement);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.scroll(screen.getByTestId('table'));
    await waitFor(closed);
  });

  it('closes when the window is resized', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open the list' }));
    await screen.findByRole('dialog');
    fireEvent(window, new Event('resize'));
    await waitFor(closed);
  });

  it('toggles from its button: a second click closes it', async () => {
    const { user } = renderWithProviders(<Harness />);
    const button = screen.getByRole('button', { name: 'Open the list' });
    await user.click(button);
    await screen.findByRole('dialog');
    await user.click(button);
    await waitFor(closed);
  });
});

describe('the competitor model', () => {
  it('gives a new competitor the first free color of 2 to 6, then the neutral one', () => {
    expect(nextCompetitorColor([{ color_index: 1 }])).toBe(2);
    expect(nextCompetitorColor([{ color_index: 1 }, { color_index: 2 }, { color_index: 4 }])).toBe(3);
    expect(nextCompetitorColor([1, 2, 3, 4, 5, 6].map((color_index) => ({ color_index })))).toBeNull();
  });

  it('stops at the number of entities the summary has cells for', () => {
    expect(atTrackedLimit(TRACKED_LIMIT - 1)).toBe(false);
    expect(atTrackedLimit(TRACKED_LIMIT)).toBe(true);
  });

  it('compares brand names ignoring case and the space around them', () => {
    expect(sameBrand(' HubSpot ', 'hubspot')).toBe(true);
    expect(sameBrand('HubSpot', 'Hub Spot')).toBe(false);
  });
});
