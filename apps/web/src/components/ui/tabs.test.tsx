import { screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tabs, TabsPanel, type TabItem } from './tabs';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

type Section = 'overview' | 'serp' | 'competitors';
const ITEMS: readonly TabItem<Section>[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'serp', label: 'SERP history', count: '12' },
  { value: 'competitors', label: 'Competitors', disabled: true },
];

function KeywordTabs({
  variant = 'underline',
  onChange,
}: {
  variant?: 'underline' | 'segmented';
  onChange?: (value: Section) => void;
}): ReactElement {
  const [value, setValue] = useState<Section>('overview');
  return (
    <Tabs
      variant={variant}
      label="Keyword sections"
      value={value}
      items={ITEMS}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    >
      <TabsPanel value="overview">Rank over time</TabsPanel>
      <TabsPanel value="serp">Snapshots</TabsPanel>
      <TabsPanel value="competitors">Rivals</TabsPanel>
    </Tabs>
  );
}
const tab = (name: RegExp): HTMLElement => screen.getByRole('tab', { name });

describe('Tabs', () => {
  it('is a named tab list with one tab per item and the panel of the chosen one', () => {
    renderWithProviders(<KeywordTabs />);
    expect(screen.getByRole('tablist', { name: 'Keyword sections' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(tab(/Overview/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Rank over time');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Overview');
  });

  it('switches the panel on click', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<KeywordTabs onChange={onChange} />);
    await user.click(tab(/SERP history/));
    expect(onChange).toHaveBeenCalledWith('serp');
    expect(tab(/SERP history/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Snapshots');
  });

  it('chooses the tab as the arrow keys move focus, and is one tab stop', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <>
        <KeywordTabs onChange={onChange} />
        <button type="button">After</button>
      </>,
    );
    await user.tab();
    expect(tab(/Overview/)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab(/SERP history/)).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('serp');
    await user.keyboard('{Home}');
    expect(tab(/Overview/)).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('overview');
  });

  it('lets focus reach a disabled tab, so it can be read, but never chooses it', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(<KeywordTabs onChange={onChange} />);
    await user.tab();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(tab(/Competitors/)).toHaveFocus();
    expect(tab(/Competitors/)).toHaveAttribute('aria-disabled', 'true');
    expect(onChange).not.toHaveBeenCalledWith('competitors');
    await user.click(tab(/Competitors/));
    expect(onChange).not.toHaveBeenCalledWith('competitors');
    expect(tab(/SERP history/)).toHaveAttribute('aria-selected', 'true');
  });

  it('ties every tab to its panel, and makes the panel a tab stop', async () => {
    const { user } = renderWithProviders(<KeywordTabs />);
    const panel = screen.getByRole('tabpanel');
    expect(tab(/Overview/)).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab(/Overview/).id);
    await user.tab();
    await user.tab();
    expect(panel).toHaveFocus();
  });

  it('draws 44 px underline tabs 24 px apart, the chosen one in the primary text color at the heavier weight', () => {
    renderWithProviders(<KeywordTabs />);
    expect(screen.getByRole('tablist')).toHaveClass('gap-6', 'border-b', 'border-border');
    expect(tab(/Overview/)).toHaveClass(
      'h-tab',
      'type-body',
      'text-foreground-secondary',
      'data-active:type-body-strong',
      'data-active:text-primary-text',
      'focus-visible:focus-ring-inset',
    );
    expect(tab(/Overview/)).toHaveAttribute('data-active');
  });

  it('marks the chosen tab with a 2 px indicator that does not animate', () => {
    renderWithProviders(<KeywordTabs />);
    const indicator = screen.getByRole('tablist').querySelector('span.absolute');
    expect(indicator).toHaveClass(
      'bottom-0',
      'h-0.5',
      'bg-primary',
      'left-(--active-tab-left)',
      'w-(--active-tab-width)',
    );
    expect(indicator?.className).not.toContain('transition');
  });

  it('reserves the width of the heavier label and shows a count after it', () => {
    renderWithProviders(<KeywordTabs />);
    const copies = screen.getAllByText('SERP history');
    expect(copies[1]).toHaveClass('invisible', 'type-body-strong');
    expect(copies[1]).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('12')).toHaveClass('type-micro', 'text-foreground-tertiary', 'num');
    expect(tab(/SERP history/)).toHaveAccessibleName('SERP history 12');
  });

  it('draws segmented tabs like a segmented control, without counts or indicator', () => {
    renderWithProviders(<KeywordTabs variant="segmented" />);
    expect(tab(/Overview/)).toHaveClass('h-control-sm', 'border', 'data-checked:bg-primary-subtle');
    expect(tab(/Overview/)).toHaveAttribute('data-checked');
    expect(tab(/SERP history/)).not.toHaveAttribute('data-checked');
    expect(screen.queryByText('12')).toBeNull();
    expect(screen.getByRole('tablist').querySelector('span.absolute')).toBeNull();
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(3);
  });

  it('passes other attributes on to its root', () => {
    const { container } = renderWithProviders(
      <Tabs
        variant="underline"
        label="Sections"
        value="a"
        items={[{ value: 'a', label: 'A' }]}
        onValueChange={vi.fn()}
        id="sections"
      >
        <TabsPanel value="a" className="pt-4">
          Panel
        </TabsPanel>
      </Tabs>,
    );
    expect(container.querySelector('[data-slot="tabs"]')).toHaveAttribute('id', 'sections');
    expect(screen.getByRole('tabpanel')).toHaveClass('pt-4');
  });

  it('has no accessibility violations in either variant', async () => {
    const { container } = renderWithProviders(
      <div>
        <KeywordTabs />
        <KeywordTabs variant="segmented" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

type Prompt = 'latest' | 'history' | 'citations' | 'competitors' | 'fanout' | 'stats';
const SIX: readonly TabItem<Prompt>[] = [
  { value: 'latest', label: 'Latest' },
  { value: 'history', label: 'History' },
  { value: 'citations', label: 'Citations' },
  { value: 'competitors', label: 'Competitors' },
  { value: 'fanout', label: 'Fan-out' },
  { value: 'stats', label: 'Stats' },
];

function PromptTabs({
  overflowLabel,
  initial = 'latest',
  onChange,
}: {
  overflowLabel?: string;
  initial?: Prompt;
  onChange?: (value: Prompt) => void;
}): ReactElement {
  const [value, setValue] = useState<Prompt>(initial);
  return (
    <>
      <Tabs
        variant="underline"
        label="Prompt sections"
        value={value}
        items={SIX}
        overflowLabel={overflowLabel}
        onValueChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      >
        {SIX.map((item) => (
          <TabsPanel key={item.value} value={item.value}>
            {item.label} panel
          </TabsPanel>
        ))}
      </Tabs>
      <button type="button">After</button>
    </>
  );
}

const TAB_WIDTH = 60;
const MORE_WIDTH = 32;
const stubLayout = (rowWidth: number): void => {
  // jsdom has no layout: every measured tab is 60 px, the More button 32 px, and the row is `rowWidth` wide
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    const kind = this.getAttribute('data-measure');
    return kind === 'tab' ? TAB_WIDTH : kind === 'more' ? MORE_WIDTH : 0;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        const entry = { target, contentRect: { width: rowWidth } };
        this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
};
const visibleTabs = (): string[] =>
  within(screen.getByRole('tablist'))
    .getAllByRole('tab')
    .map((element) => (element.firstElementChild?.firstElementChild?.textContent ?? '').trim());
const moreButton = (): HTMLElement => screen.getByRole('button', { name: 'More tabs' });

describe('Tabs overflow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('moves the tabs that do not fit into a More tabs menu outside the tab list', async () => {
    stubLayout(400);
    const { user } = renderWithProviders(<PromptTabs overflowLabel="More tabs" />);
    // 4 tabs and the button: 4 x 60 + 3 x 24 + 24 + 32 = 368 px; a fifth tab would need 452 px
    expect(visibleTabs()).toEqual(['Latest', 'History', 'Citations', 'Competitors']);
    expect(screen.getByRole('tablist')).not.toContainElement(moreButton());
    await user.click(moreButton());
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Fan-out', 'Stats']);
  });

  it('keeps the chosen tab visible, swapping out the last visible one', async () => {
    stubLayout(400);
    const onChange = vi.fn();
    const { user } = renderWithProviders(<PromptTabs overflowLabel="More tabs" onChange={onChange} />);
    await user.click(moreButton());
    await user.click(await screen.findByRole('menuitem', { name: 'Stats' }));
    expect(onChange).toHaveBeenCalledWith('stats');
    expect(visibleTabs()).toEqual(['Latest', 'History', 'Citations', 'Stats']);
    expect(screen.getByRole('tab', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Stats panel');
    await user.click(moreButton());
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Competitors', 'Fan-out']);
  });

  it('keeps a chosen tab that was beyond the fit visible from the start', () => {
    stubLayout(400);
    renderWithProviders(<PromptTabs overflowLabel="More tabs" initial="fanout" />);
    expect(visibleTabs()).toEqual(['Latest', 'History', 'Citations', 'Fan-out']);
  });

  it('shows no More tabs button when every tab fits, or when no overflowLabel is given', () => {
    stubLayout(600);
    const { unmount } = renderWithProviders(<PromptTabs overflowLabel="More tabs" />);
    // 6 x 60 + 5 x 24 = 480 px
    expect(visibleTabs()).toHaveLength(6);
    expect(screen.queryByRole('button', { name: 'More tabs' })).toBeNull();
    unmount();
    stubLayout(100);
    renderWithProviders(<PromptTabs />);
    expect(visibleTabs()).toHaveLength(6);
    expect(screen.queryByRole('button', { name: 'More tabs' })).toBeNull();
  });

  it('moves arrow keys, Home and End among the visible tabs only', async () => {
    stubLayout(400);
    const { user } = renderWithProviders(<PromptTabs overflowLabel="More tabs" />);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Latest' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Competitors' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Latest' })).toHaveFocus();
  });

  it('reaches the menu by keyboard, and Escape closes it with focus back on the button', async () => {
    stubLayout(400);
    const { user } = renderWithProviders(<PromptTabs overflowLabel="More tabs" />);
    await user.tab();
    await user.tab();
    expect(moreButton()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(moreButton()).toHaveFocus();
  });

  it('has no accessibility violations with the menu button', async () => {
    stubLayout(400);
    const { container } = renderWithProviders(<PromptTabs overflowLabel="More tabs" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
