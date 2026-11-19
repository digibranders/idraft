import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { FileText } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Inspector } from './inspector';
import { InspectorLayout } from './inspector-layout';
import { InspectorSection } from './inspector-section';
import { InspectorBody, InspectorPanel, InspectorTabs } from './inspector-tabs';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

/** The width beside the sidebar that the layout measures: a 1440 px window with the 208 px sidebar. */
let areaWidth = 1232;
class AreaObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: { width: areaWidth, height: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

const onClose = vi.fn();
const onStep = vi.fn();

function Harness({
  atFirst = false,
  title = 'best crm for startups',
  list = <button type="button">A row of the list</button>,
  hideMoreActions = false,
}: {
  atFirst?: boolean;
  hideMoreActions?: boolean;
  title?: string;
  /** What the list beside the inspector holds. */
  list?: ReactNode;
}): ReactElement {
  return (
    <InspectorLayout
      inspector={
        <Inspector
          type="keyword"
          backLabel="Back to Keywords"
          onClose={onClose}
          onStep={onStep}
          hideMoreActions={hideMoreActions}
          header={{
            title,
            typeLabel: 'Keyword',
            typeNoun: 'keyword',
            positionText: '12 of 986',
            navigation: { onPrevious: () => onStep('previous'), onNext: () => onStep('next'), atFirst, atLast: false },
          }}
        >
          <InspectorTabs
            label="Keyword sections"
            value="overview"
            onValueChange={() => undefined}
            items={[
              { value: 'overview', label: 'Overview' },
              { value: 'settings', label: 'Settings' },
            ]}
          >
            <InspectorPanel value="overview">
              <InspectorSection title="Demand" icon={FileText} status="ready">
                <p>8,100 searches a month</p>
              </InspectorSection>
            </InspectorPanel>
            <InspectorPanel value="settings">
              <InspectorSection title="Settings" icon={FileText} status="loading" />
            </InspectorPanel>
          </InspectorTabs>
        </Inspector>
      }
    >
      {list}
    </InspectorLayout>
  );
}

const inspector = (): HTMLElement => screen.getByRole('complementary', { name: 'best crm for startups' });
const separator = (): HTMLElement => screen.getByRole('separator', { name: 'Resize inspector' });

beforeEach(() => {
  areaWidth = 1232;
  onClose.mockReset();
  onStep.mockReset();
  vi.stubGlobal('ResizeObserver', AreaObserver);
  vi.stubGlobal('innerWidth', 1440);
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
});

describe('Inspector', () => {
  it('docks beside the list as a named aside, and moves focus to its title', async () => {
    const { container } = renderWithProviders(<Harness />);
    expect(inspector()).toHaveStyle({ width: '400px' });
    expect(inspector().className).toContain('sticky');
    expect(screen.getByRole('heading', { level: 2, name: 'best crm for startups' })).toHaveFocus();
    expect(screen.getByText('12 of 986')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('falls back to the type label for a record without a name yet, so the focused title and the landmark are never empty', () => {
    renderWithProviders(<Harness title="" />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Keyword' });
    expect(heading).toHaveFocus();
    expect(screen.getByRole('complementary', { name: 'Keyword' })).toBeInTheDocument();
  });

  it('lays over the list when the main column would be narrower than 720 px', () => {
    areaWidth = 1072;
    vi.stubGlobal('innerWidth', 1280);
    renderWithProviders(<Harness />);
    expect(inspector().className).toContain('fixed');
  });

  it('is a modal sheet with a back button below 768 px', async () => {
    vi.stubGlobal('innerWidth', 390);
    const { user } = renderWithProviders(<Harness />);
    expect(await screen.findByRole('dialog', { name: 'best crm for startups' })).toBeInTheDocument();
    expect(screen.queryByRole('separator')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to Keywords' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape from inside, and steps with J and K', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.keyboard('j');
    expect(onStep).toHaveBeenLastCalledWith('next');
    await user.keyboard('k');
    expect(onStep).toHaveBeenLastCalledWith('previous');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape and J to the list when focus is outside both', async () => {
    const { user } = renderWithProviders(<Harness />);
    act(() => screen.getByRole('button', { name: 'A row of the list' }).focus());
    await user.keyboard('{Escape}j');
    expect(onClose).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalled();
  });

  it('J and K step from a row of a treegrid, as from a row of a grid', async () => {
    const { user } = renderWithProviders(
      <Harness
        list={
          <div role="treegrid" aria-label="Cited domains">
            <div role="row">
              <div role="gridcell" tabIndex={0}>
                g2.com
              </div>
            </div>
          </div>
        }
      />,
    );
    act(() => screen.getByRole('gridcell', { name: 'g2.com' }).focus());
    await user.keyboard('j');
    expect(onStep).toHaveBeenLastCalledWith('next');
    await user.keyboard('k');
    expect(onStep).toHaveBeenLastCalledWith('previous');
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it('J and K still step from a row of a plain grid', async () => {
    const { user } = renderWithProviders(
      <Harness
        list={
          <div role="grid" aria-label="Keywords">
            <div role="row">
              <div role="gridcell" tabIndex={0}>
                crm
              </div>
            </div>
          </div>
        }
      />,
    );
    act(() => screen.getByRole('gridcell', { name: 'crm' }).focus());
    await user.keyboard('j');
    expect(onStep).toHaveBeenLastCalledWith('next');
    await user.keyboard('k');
    expect(onStep).toHaveBeenLastCalledWith('previous');
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it('previews a drag over the list and commits the width on release', () => {
    Object.defineProperty(Element.prototype, 'setPointerCapture', { configurable: true, value: () => undefined });
    renderWithProviders(<Harness />);
    fireEvent.pointerDown(separator(), { button: 0, clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 720, pointerId: 1 });
    // Drawn 80 px wider, while a negative margin keeps the layout at 400 px until release
    expect(inspector()).toHaveStyle({ width: '480px', marginLeft: '-80px' });
    expect(window.localStorage.getItem('inspector-width:keyword')).toBeNull();
    fireEvent.pointerUp(separator(), { clientX: 720, pointerId: 1 });
    expect(inspector()).toHaveStyle({ width: '480px' });
    expect(inspector().style.marginLeft).toBe('');
    expect(window.localStorage.getItem('inspector-width:keyword')).toBe('480');
    Reflect.deleteProperty(Element.prototype, 'setPointerCapture');
  });

  it('names a disabled Previous by why it is disabled', () => {
    renderWithProviders(<Harness atFirst />);
    expect(screen.getByRole('button', { name: 'First keyword in this list' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Next keyword' })).toBeEnabled();
  });

  it('resizes from the keyboard within its limits, remembers the width, and resets with Enter', async () => {
    const { user } = renderWithProviders(<Harness />);
    act(() => separator().focus());
    expect(separator()).toHaveAttribute('aria-valuenow', '400');
    expect(separator()).toHaveAttribute('aria-valuemax', '500');
    await user.keyboard('{ArrowLeft}');
    expect(separator()).toHaveAttribute('aria-valuenow', '416');
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(separator()).toHaveAttribute('aria-valuenow', '480');
    await user.keyboard('{End}');
    expect(separator()).toHaveAttribute('aria-valuenow', '500');
    expect(window.localStorage.getItem('inspector-width:keyword')).toBe('500');
    await user.keyboard('{Home}');
    expect(inspector()).toHaveStyle({ width: '360px' });
    await user.keyboard('{Enter}');
    expect(separator()).toHaveAttribute('aria-valuenow', '400');
    expect(window.localStorage.getItem('inspector-width:keyword')).toBeNull();
  });

  it('leaves the More menu out when asked, and keeps Close', () => {
    renderWithProviders(<Harness hideMoreActions />);
    expect(screen.queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('offers the widths in its More menu', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.click(screen.getByRole('button', { name: 'More actions for best crm for startups' }));
    expect(await screen.findByRole('menuitemradio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Wide' })).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByRole('menuitemradio', { name: 'Wide' }));
    await waitFor(() => {
      expect(inspector()).toHaveStyle({ width: '440px' });
    });
  });
});

describe('InspectorSection', () => {
  it('draws a meta after the title and a flush body for a table (WP-77)', () => {
    renderWithProviders(
      <InspectorSection
        title="Prompts that cite this page"
        meta="31 prompts · cited in 76 answers"
        status="ready"
        flush
      >
        <table aria-label="t" />
      </InspectorSection>,
    );
    expect(screen.getByText('31 prompts · cited in 76 answers')).toHaveClass('type-meta');
    expect(screen.getByRole('table', { name: 't' }).parentElement?.className ?? '').not.toContain('px-4');
  });

  it('wraps a meta to a second line instead of cutting it, as the preview header does', () => {
    renderWithProviders(
      <InspectorSection title="Prompts that cite this page" meta="31 prompts · cited in 76 answers" status="ready" />,
    );
    const meta = screen.getByText('31 prompts · cited in 76 answers');
    expect(meta).not.toHaveClass('truncate');
    expect(meta).toHaveClass('wrap-anywhere');
    const title = screen.getByRole('heading', { level: 3, name: 'Prompts that cite this page' });
    expect(title).not.toHaveClass('truncate');
    expect(title.parentElement).toHaveClass('flex-wrap');
    expect(title.parentElement?.parentElement).toHaveClass('min-h-12', 'py-3');
    expect(title.parentElement?.parentElement).not.toHaveClass('h-12');
  });

  it('can put its action on a second row until the card is 42 rem wide (a container query)', () => {
    const { container, rerender } = renderWithProviders(
      <InspectorSection
        title="Who is cited"
        meta="9 answers"
        action={<button type="button">Open</button>}
        status="ready"
      />,
    );
    expect(container.querySelector('section')).not.toHaveClass('@container');
    expect(screen.getByRole('button', { name: 'Open' }).parentElement).not.toHaveClass('basis-full');
    rerender(
      <InspectorSection
        title="Who is cited"
        meta="9 answers"
        action={<button type="button">Open</button>}
        stackAction
        status="ready"
      />,
    );
    expect(container.querySelector('section')).toHaveClass('@container');
    expect(screen.getByRole('button', { name: 'Open' }).parentElement).toHaveClass('basis-full', '@2xl:basis-auto');
    expect(screen.getByRole('heading', { level: 3 }).parentElement?.parentElement).toHaveClass(
      'flex-wrap',
      'min-h-12',
      'py-3',
    );
  });

  it('keeps a header without a meta one 48 px line that cuts a long title', () => {
    renderWithProviders(<InspectorSection title="Demand" icon={FileText} status="ready" />);
    const title = screen.getByRole('heading', { level: 3, name: 'Demand' });
    expect(title).toHaveClass('truncate', 'type-subsection-title');
    expect(title.parentElement?.parentElement).toHaveClass('h-12');
  });

  it('draws the title in section size when asked, and stays an h3', () => {
    renderWithProviders(<InspectorSection title="Summary" titleSize="section" status="ready" />);
    const title = screen.getByRole('heading', { level: 3, name: 'Summary' });
    expect(title).toHaveClass('type-section-title');
    expect(title).not.toHaveClass('type-subsection-title');
  });

  it('draws a flush empty state with no padding of its own, and pads a flush skeleton and error', () => {
    const { rerender } = renderWithProviders(
      <InspectorSection title="Cited alongside" status="empty" flush empty={<p>Cited alone</p>} />,
    );
    expect(screen.getByText('Cited alone').parentElement?.className ?? '').not.toContain('px-4');
    rerender(<InspectorSection title="Cited alongside" status="error" flush error={<p>Failed</p>} />);
    expect(screen.getByText('Failed').parentElement).toHaveClass('px-4', 'pb-4');
    rerender(<InspectorSection title="Cited alongside" status="loading" flush />);
    expect(document.querySelector('section > div:last-child')).toHaveClass('px-4', 'pb-4');
  });

  it('pads an empty state of a card that is not flush', () => {
    renderWithProviders(<InspectorSection title="Settings" status="empty" empty={<p>Nothing yet</p>} />);
    expect(screen.getByText('Nothing yet').parentElement).toHaveClass('px-4', 'pb-4');
  });

  it('still draws its icon and a padded body without them', () => {
    renderWithProviders(
      <InspectorSection title="Demand" icon={FileText} status="ready">
        <p>8,100 searches a month</p>
      </InspectorSection>,
    );
    expect(screen.getByText('8,100 searches a month').parentElement).toHaveClass('px-4');
  });
});

describe('InspectorBody', () => {
  it('without a label is a plain scroll container, as before', () => {
    renderWithProviders(
      <InspectorBody>
        <p>Run facts</p>
      </InspectorBody>,
    );
    const body = screen.getByText('Run facts').parentElement?.parentElement;
    expect(body).toBeDefined();
    expect(body).not.toHaveAttribute('tabindex');
    expect(body).not.toHaveAttribute('role');
    expect(body).not.toHaveAttribute('aria-label');
  });

  it('with a label is a focusable named region, so a keyboard user can scroll it', () => {
    renderWithProviders(
      <InspectorBody label="Run details">
        <p>Run facts</p>
      </InspectorBody>,
    );
    const region = screen.getByRole('region', { name: 'Run details' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.className).toContain('focus-visible:focus-ring-inset');
    expect(region).toContainElement(screen.getByText('Run facts'));
  });
});
