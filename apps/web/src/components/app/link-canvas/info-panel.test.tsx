import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InfoPanel } from './info-panel';
import { renderWithProviders } from '@/test/render';

const facts = {
  title: 'SOC as a service',
  tier: 'T1 Money pages',
  status: '200',
  depth: '2',
  linkingScoped: '12',
  linkingAll: '30',
  placement: 'content',
  rel: 'follow',
};

describe('InfoPanel', () => {
  it('lists the facts, including the link placement and attribute', () => {
    renderWithProviders(<InfoPanel label="Info about /soc" facts={facts} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Info about /soc' })).toBeInTheDocument();
    expect(screen.getByText('T1 Money pages')).toBeInTheDocument();
    expect(screen.getByText('Link placement')).toBeInTheDocument();
    expect(screen.getByText('follow')).toBeInTheDocument();
  });

  it('offers the live page under the facts when it has an address', () => {
    renderWithProviders(
      <InfoPanel
        label="Info"
        facts={facts}
        visit={{ href: 'https://example.com/soc', label: 'Visit /soc in a new tab', text: 'Visit page' }}
        onClose={vi.fn()}
      />,
    );
    const link = screen.getByRole('link', { name: 'Visit /soc in a new tab' });
    expect(link).toHaveAttribute('href', 'https://example.com/soc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('leaves out the link rows on the focus card', () => {
    renderWithProviders(<InfoPanel label="Info" facts={{ ...facts, placement: '', rel: '' }} onClose={vi.fn()} />);
    expect(screen.queryByText('Link placement')).not.toBeInTheDocument();
  });

  it('closes on Escape, on the close button and on a press elsewhere, not on a press inside', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <div>
        <button type="button">Elsewhere</button>
        <InfoPanel label="Info" facts={facts} onClose={onClose} />
      </div>,
    );
    await user.click(screen.getByText('T1 Money pages'));
    expect(onClose).not.toHaveBeenCalled();
    // Escape and the close button hand focus back to the button that opened the panel; a press elsewhere does not
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onClose).toHaveBeenLastCalledWith(false);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('leaves an Escape that something else already handled alone', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <div>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- a stand in for the card that takes Escape first */}
        <div
          onKeyDown={(event) => {
            event.preventDefault();
          }}
        >
          <button type="button">Card</button>
        </div>
        <InfoPanel label="Info" facts={facts} onClose={onClose} />
      </div>,
    );
    screen.getByRole('button', { name: 'Card' }).focus();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on a press of the button that opens it', async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <div>
        <button type="button" data-info-toggle="">
          Info
        </button>
        <InfoPanel label="Panel" facts={facts} onClose={onClose} />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Info' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
