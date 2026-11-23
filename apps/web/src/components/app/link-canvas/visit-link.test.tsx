import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { pageHref, VisitLink } from './visit-link';
import { renderWithProviders } from '@/test/render';

describe('pageHref', () => {
  it('joins the host and the path into a web address', () => {
    expect(pageHref('example.com', '/pricing')).toBe('https://example.com/pricing');
  });

  it('gives no address without a host, for a relative path, or for a host that carries a script or a login', () => {
    expect(pageHref('', '/pricing')).toBeNull();
    expect(pageHref('example.com', 'pricing')).toBeNull();
    expect(pageHref('user:secret@example.com', '/pricing')).toBeNull();
    expect(pageHref('example.com', '//evil.test/x')).toBe('https://example.com//evil.test/x');
    expect(pageHref('javascript:alert(1)//', '/x')).toBeNull();
  });
});

describe('VisitLink', () => {
  it('is a real link to a new tab that keeps the opener to itself', () => {
    renderWithProviders(<VisitLink href="https://example.com/pricing" label="Visit /pricing in a new tab" />);
    const link = screen.getByRole('link', { name: 'Visit /pricing in a new tab' });
    expect(link).toHaveAttribute('href', 'https://example.com/pricing');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('carries a word beside the icon in the info panel', () => {
    renderWithProviders(<VisitLink href="https://example.com/" label="Visit / in a new tab" text="Visit page" />);
    expect(screen.getByRole('link', { name: 'Visit / in a new tab' })).toHaveTextContent('Visit page');
  });

  it('keeps a press from reaching the card behind it', () => {
    const behind = vi.fn();
    renderWithProviders(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- a stand in for the card and the canvas that listen for presses
      <div onPointerDown={behind} onClick={behind}>
        <VisitLink href="https://example.com/" label="Visit" />
      </div>,
    );
    const link = screen.getByRole('link', { name: 'Visit' });
    // The link opens a tab on a click: stop the navigation, the test only watches what bubbles
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.pointerDown(link);
    fireEvent.click(link);
    expect(behind).not.toHaveBeenCalled();
  });
});
