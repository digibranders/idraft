import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CardInfoProvider } from './card-info';
import { ChartFrame, type ChartFrameProps } from './chart-frame';
import * as chartPng from './chart-png';
import * as csvWrite from '@/lib/csv/csv-write';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

vi.mock('./echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('./chart-png', () => ({
  renderChartPng: vi.fn(() => Promise.resolve(new Blob(['png'], { type: 'image/png' }))),
  echartBody: vi.fn(() => vi.fn()),
}));
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csvWrite>()),
  downloadBlob: vi.fn(),
}));

const NOTE = 'Topics overlap, so the rows do not add up to the total.';

const html = (extra: Partial<ChartFrameProps> = {}): ReactElement => (
  <ChartFrame
    kind="html"
    variant="panel"
    title="Topic heat map"
    meta="Last 28 days"
    footnote={NOTE}
    height={180}
    summary="A grid of rates."
    body={<p>Body</p>}
    table={<p>Table</p>}
    status="ready"
    {...({ ...extra } as object)}
  />
);

const infoButton = (): HTMLElement => screen.getByRole('button', { name: 'About Topic heat map' });
const tip = (): Element | null => document.querySelector('[data-slot="tooltip"]');
const popover = (): Element | null => document.querySelector('[data-slot="popover"]');

describe('card info mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prints the footnote and has no info button without the provider', () => {
    renderWithProviders(html());
    expect(screen.queryByRole('button', { name: /^About / })).toBeNull();
    const printed = screen.getByText(NOTE);
    expect(printed).toBeVisible();
    expect(printed).not.toHaveClass('sr-only');
  });

  it('prints no footnote but keeps its text in the document, hidden visually, and adds the i button', () => {
    renderWithProviders(<CardInfoProvider>{html()}</CardInfoProvider>);
    expect(infoButton()).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toHaveClass('sr-only');
  });

  it('adds no button for a card without a footnote', () => {
    renderWithProviders(<CardInfoProvider>{html({ footnote: undefined })}</CardInfoProvider>);
    expect(screen.queryByRole('button', { name: /^About / })).toBeNull();
  });

  it('puts the button at the right edge of the header, after the title and the views', () => {
    renderWithProviders(<CardInfoProvider>{html()}</CardInfoProvider>);
    const heading = screen.getByRole('heading', { level: 2, name: 'Topic heat map' });
    const edge = infoButton().parentElement;
    expect(edge?.lastElementChild).toBe(infoButton());
    expect(edge?.firstElementChild).toContainElement(heading);
  });

  it('adds no button for an empty footnote', () => {
    renderWithProviders(<CardInfoProvider>{html({ footnote: '' })}</CardInfoProvider>);
    expect(screen.queryByRole('button', { name: /^About / })).toBeNull();
  });

  it('shows the footnote in a tooltip on hover', async () => {
    const { user } = renderWithProviders(<CardInfoProvider>{html()}</CardInfoProvider>);
    await user.hover(infoButton());
    await waitFor(() => expect(tip()).toHaveTextContent(NOTE));
  });

  it('shows it on keyboard focus too, and Escape closes the tooltip', async () => {
    const { user } = renderWithProviders(<CardInfoProvider>{html()}</CardInfoProvider>);
    // The button is the last in the header, after the view controls
    for (let step = 0; step < 8 && document.activeElement !== infoButton(); step += 1) await user.tab();
    await waitFor(() => expect(infoButton()).toHaveFocus());
    await waitFor(() => expect(tip()).toHaveTextContent(NOTE));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(tip()).toBeNull());
  });

  it('opens a popover with the same text on click, without the tooltip, and Escape closes it', async () => {
    const { user } = renderWithProviders(<CardInfoProvider>{html()}</CardInfoProvider>);
    await user.click(infoButton());
    await waitFor(() => expect(popover()).not.toBeNull());
    const dialog = screen.getByRole('dialog', { name: 'About Topic heat map' });
    expect(within(dialog).getByText(NOTE)).toBeInTheDocument();
    expect(infoButton()).toHaveAttribute('aria-expanded', 'true');
    expect(tip()).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popover()).toBeNull());
    expect(infoButton()).toHaveFocus();
  });

  describe('with info', () => {
    const INFO = { what: 'How each group does on each platform.', how: 'Each cell is a rate over valid answers.' };
    const withInfo = (extra: Partial<ChartFrameProps> = {}): ReactElement => html({ info: INFO, ...extra });

    it('shows what the card shows, then how it is counted, in the popover, and not the footnote', async () => {
      const { user } = renderWithProviders(<CardInfoProvider>{withInfo()}</CardInfoProvider>);
      await user.click(infoButton());
      const dialog = await screen.findByRole('dialog', { name: 'About Topic heat map' });
      const [what, how] = within(dialog).getAllByText(/./, { selector: 'p' });
      expect(what).toHaveTextContent(INFO.what);
      expect(how).toHaveTextContent(`How it is counted: ${INFO.how}`);
      expect(within(how as HTMLElement).getByText('How it is counted:').tagName).toBe('STRONG');
      expect(within(dialog).queryByText(NOTE)).toBeNull();
    });

    it('reads both paragraphs in the tooltip', async () => {
      const { user } = renderWithProviders(<CardInfoProvider>{withInfo()}</CardInfoProvider>);
      await user.hover(infoButton());
      await waitFor(() => expect(tip()).toHaveTextContent(`${INFO.what} How it is counted: ${INFO.how}`));
      expect(tip()).not.toHaveTextContent(NOTE);
    });

    it('keeps the footnote hidden in the document, and draws the button for a card without a footnote', () => {
      renderWithProviders(<CardInfoProvider>{withInfo()}</CardInfoProvider>);
      expect(screen.getByText(NOTE)).toHaveClass('sr-only');
      expect(infoButton()).toBeInTheDocument();
    });

    it('draws the button with info alone, and none without the provider', () => {
      const { unmount } = renderWithProviders(<CardInfoProvider>{withInfo({ footnote: undefined })}</CardInfoProvider>);
      expect(infoButton()).toBeInTheDocument();
      unmount();
      renderWithProviders(withInfo());
      expect(screen.queryByRole('button', { name: /^About / })).toBeNull();
      expect(screen.getByText(NOTE)).not.toHaveClass('sr-only');
    });
  });

  it('keeps the button in an empty card, and has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <CardInfoProvider>
        {html({
          status: 'empty',
          empty: { title: 'No topics', reason: 'Group prompts into topics first.' },
        } as Partial<ChartFrameProps>)}
      </CardInfoProvider>,
    );
    expect(infoButton()).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no accessibility violations with the popover open', async () => {
    const { user, container } = renderWithProviders(<CardInfoProvider>{html()}</CardInfoProvider>);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(infoButton());
    await screen.findByRole('dialog');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('still writes the footnote into the PNG', async () => {
    const png = vi.fn(() => Promise.resolve({ image: new Blob(), height: 10 }) as never);
    const { user } = renderWithProviders(
      <CardInfoProvider>{html({ menu: { fileName: 'heat', png } } as Partial<ChartFrameProps>)}</CardInfoProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'More actions for Topic heat map' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download PNG' }));
    await waitFor(() => expect(chartPng.renderChartPng).toHaveBeenCalledTimes(1));
    expect(chartPng.renderChartPng).toHaveBeenCalledWith(
      expect.objectContaining({ frame: expect.objectContaining({ title: 'Topic heat map', footnote: NOTE }) }),
    );
  });
});
