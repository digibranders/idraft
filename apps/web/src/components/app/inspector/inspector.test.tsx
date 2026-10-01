import { act, screen, waitFor } from '@testing-library/react';
import { FileText } from 'lucide-react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Inspector } from './inspector';
import { InspectorLayout } from './inspector-layout';
import { InspectorSection } from './inspector-section';
import { InspectorPanel, InspectorTabs } from './inspector-tabs';
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

function Harness({ atFirst = false }: { atFirst?: boolean }): ReactElement {
  return (
    <InspectorLayout
      inspector={
        <Inspector
          type="keyword"
          backLabel="Back to Rankings"
          onClose={onClose}
          onStep={onStep}
          header={{
            title: 'best crm for startups',
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
      <button type="button">A row of the list</button>
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
    await user.click(screen.getByRole('button', { name: 'Back to Rankings' }));
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

  it('offers the widths in its More menu', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Wide' }));
    await waitFor(() => {
      expect(inspector()).toHaveStyle({ width: '440px' });
    });
  });
});
