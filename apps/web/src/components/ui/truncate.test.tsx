import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Truncate } from './truncate';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

/** jsdom does not lay out, so the widths a browser would measure are given here, per element. */
function layout(widths: (node: HTMLElement) => [scrollWidth: number, clientWidth: number]): void {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return widths(this)[0];
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return widths(this)[1];
  });
}
const fits = (): [number, number] => [100, 100];
const clipped = (): [number, number] => [400, 120];
const popups = (): Element[] => [...document.querySelectorAll('[data-slot="tooltip"]')];
const LONG = 'What is the best CRM for a 20-person startup that sells to enterprises?';
/** The value itself: once its tooltip is open, the same text is in the document twice. */
const value = (text: string): HTMLElement => screen.getByText(text, { selector: '[data-truncate]' });

describe('Truncate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the full text on one line and marks the clipping as designed', () => {
    layout(fits);
    renderWithProviders(<Truncate text={LONG} />);
    const node = screen.getByText(LONG);
    expect(node).toHaveClass('truncate', 'min-w-0');
    expect(node).toHaveAttribute('data-truncate');
  });

  it('shows the full text in a tooltip when it is clipped, and none when it fits', async () => {
    layout((node) => (node.textContent === LONG ? clipped() : fits()));
    const { user } = renderWithProviders(
      <>
        <Truncate text="crm pricing" />
        <Truncate text={LONG} />
      </>,
    );
    // Without a hover delay a tooltip is open when `hover` resolves, as the clipped value shows
    await user.hover(value('crm pricing'));
    expect(popups()).toHaveLength(0);
    await user.hover(value(LONG));
    expect(popups()).toHaveLength(1);
    expect(popups()[0]).toHaveTextContent(LONG);
    // The text itself is the accessible name, so the tooltip is not read a second time
    expect(popups()[0]).toHaveAttribute('aria-hidden', 'true');
    expect(value(LONG)).not.toHaveAttribute('aria-describedby');
  });

  it('measures when the pointer arrives, so a value that starts to fit stops having a tooltip', async () => {
    let width: [number, number] = clipped();
    layout(() => width);
    const { user } = renderWithProviders(<Truncate text={LONG} />);
    await user.hover(value(LONG));
    await waitFor(() => expect(popups()).toHaveLength(1));
    await user.unhover(value(LONG));
    await waitFor(() => expect(popups()).toHaveLength(0));
    width = fits();
    await user.hover(value(LONG));
    expect(popups()).toHaveLength(0);
  });

  it('shows a value shortened in the middle, reads the full one, and always has the tooltip', async () => {
    layout(fits);
    const full = '/blog/2026/guides/how-to-choose-a-crm';
    const { user, container } = renderWithProviders(<Truncate text={full} display="/blog/…/how-to-choose-a-crm" />);
    expect(screen.getByText('/blog/…/how-to-choose-a-crm')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(full)).toHaveClass('sr-only');
    await user.hover(container.querySelector('[data-truncate]') as HTMLElement);
    await waitFor(() => expect(popups()).toHaveLength(1));
    expect(popups()[0]).toHaveTextContent(full);
  });

  it('treats a display equal to the text as no shortening', () => {
    layout(fits);
    renderWithProviders(<Truncate text="/pricing" display="/pricing" />);
    expect(screen.getByText('/pricing')).not.toHaveAttribute('aria-hidden');
  });

  it('passes other attributes on, such as the language of content that is not English', () => {
    layout(fits);
    renderWithProviders(<Truncate text="beste crm software" lang="nl" id="keyword-7" className="max-w-40" />);
    const node = screen.getByText('beste crm software');
    expect(node).toHaveAttribute('lang', 'nl');
    expect(node).toHaveAttribute('id', 'keyword-7');
    expect(node).toHaveClass('max-w-40', 'truncate');
  });

  it('hands its element to the caller as well', () => {
    layout(fits);
    const asObject = { current: null as HTMLSpanElement | null };
    const asFunction = vi.fn();
    renderWithProviders(
      <>
        <Truncate text="crm pricing" ref={asObject} />
        <Truncate text="crm software" ref={asFunction} />
      </>,
    );
    expect(asObject.current).toBe(value('crm pricing'));
    expect(asFunction).toHaveBeenCalledWith(value('crm software'));
  });

  it('has no accessibility violations', async () => {
    layout(fits);
    const { container } = renderWithProviders(
      <p>
        <Truncate text="/blog/2026/guides/how-to-choose-a-crm" display="/blog/…/how-to-choose-a-crm" />
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
