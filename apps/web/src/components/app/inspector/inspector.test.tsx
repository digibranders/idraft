import { act, fireEvent, screen } from '@testing-library/react';
import { FileText } from 'lucide-react';
import { createElement, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Inspector } from './inspector';
import { InspectorLayout } from './inspector-layout';
import { InspectorSection } from './inspector-section';
import { InspectorBody, InspectorPanel, InspectorTabs } from './inspector-tabs';
import type { InspectorType } from '@/lib/inspector/placement';
import { InspectorWidthUserContext, writeInspectorWidth } from '@/lib/inspector/width-store';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const WIDTH_KEY = 'idraft.pref.u1.inspector-width';

/** A boxed preview that reports the width it has, as the browser's observer would. */
let boxWidth = 800;
class BoxObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: { width: boxWidth, height: 480 } } as unknown as ResizeObserverEntry],
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
  type = 'keyword',
  user,
  boxed = false,
  withStep = true,
  moreActions,
  extraBody,
}: {
  atFirst?: boolean;
  hideMoreActions?: boolean;
  title?: string;
  /** What the list beside the inspector holds. */
  list?: ReactNode;
  type?: InspectorType;
  /** Whose saved width the drawer reads and writes; none keeps the width in memory. */
  user?: string;
  boxed?: boolean;
  /** `false` leaves `onStep` out. */
  withStep?: boolean;
  moreActions?: readonly { id: string; label: string; onSelect: () => void }[];
  /** More controls in the Overview panel. */
  extraBody?: ReactNode;
}): ReactElement {
  return (
    <InspectorWidthUserContext value={user ?? null}>
      <InspectorLayout
        boxed={boxed}
        inspector={
          <Inspector
            type={type}
            backLabel="Back to Keywords"
            onClose={onClose}
            onStep={withStep ? onStep : undefined}
            hideMoreActions={hideMoreActions}
            header={{
              title,
              typeLabel: 'Keyword',
              typeNoun: 'keyword',
              positionText: '12 of 986',
              navigation: {
                onPrevious: () => onStep('previous'),
                onNext: () => onStep('next'),
                atFirst,
                atLast: false,
              },
              moreActions,
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
                {extraBody}
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
    </InspectorWidthUserContext>
  );
}

/** A drawer whose body belongs to the record: a step changes the title and replaces the button. */
function SteppingHarness(): ReactElement {
  const [title, setTitle] = useState('first keyword');
  return (
    <InspectorLayout
      inspector={
        <Inspector
          type="keyword"
          backLabel="Back to Keywords"
          onClose={onClose}
          onStep={() => setTitle('second keyword')}
          header={{ title, typeLabel: 'Keyword', typeNoun: 'keyword', positionText: title }}
        >
          <InspectorBody>
            <button key={title} type="button">
              Action of {title}
            </button>
          </InspectorBody>
        </Inspector>
      }
    >
      <p>List</p>
    </InspectorLayout>
  );
}

/** One element that uses the arrow keys itself, as the card's `ARROW_OWNERS` list names them. */
const ARROW_OWNER_CASES: readonly (readonly [string, string, Record<string, string>])[] = [
  ['an input', 'input', {}],
  ['a textarea', 'textarea', {}],
  ['a select', 'select', {}],
  ['a contenteditable element', 'div', { contenteditable: 'true' }],
  ['a textbox', 'div', { role: 'textbox' }],
  ['a combobox', 'div', { role: 'combobox' }],
  ['a listbox', 'div', { role: 'listbox' }],
  ['a menu', 'div', { role: 'menu' }],
  ['a menubar', 'div', { role: 'menubar' }],
  ['a tablist', 'div', { role: 'tablist' }],
  ['a radiogroup', 'div', { role: 'radiogroup' }],
  ['a slider', 'div', { role: 'slider' }],
  ['a spinbutton', 'div', { role: 'spinbutton' }],
  ['a separator', 'div', { role: 'separator' }],
  ['a grid', 'div', { role: 'grid' }],
  ['a treegrid', 'div', { role: 'treegrid' }],
  ['a tree', 'div', { role: 'tree' }],
  ['a button that opens a popup', 'button', { 'aria-haspopup': 'menu' }],
];

/** Built with `createElement` so the roles need not carry the props a real widget would. */
function ArrowOwner({ tag, attributes }: { tag: string; attributes: Record<string, string> }): ReactElement {
  return createElement(tag, { tabIndex: 0, 'data-testid': 'arrow-owner', ...attributes });
}

const inspector = (): HTMLElement => screen.getByRole('complementary', { name: 'best crm for startups' });
const separator = (): HTMLElement => screen.getByRole('separator', { name: 'Resize inspector' });
const title = (): HTMLElement => screen.getByRole('heading', { level: 2, name: 'best crm for startups' });

beforeEach(() => {
  boxWidth = 800;
  onClose.mockReset();
  onStep.mockReset();
  vi.stubGlobal('innerWidth', 1440);
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
  // A width kept in the module's memory must not reach the next test
  writeInspectorWidth('u1', null);
  writeInspectorWidth(null, null);
});

describe('Inspector', () => {
  it('lays over the list as a named aside at 640 px, and moves focus to its title', async () => {
    const { container } = renderWithProviders(<Harness />);
    expect(inspector()).toHaveStyle({ width: '640px' });
    expect(inspector().className).toContain('fixed');
    expect(inspector().className).not.toContain('sticky');
    expect(inspector()).toHaveAttribute('data-inspector', 'keyword');
    expect(title()).toHaveFocus();
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

  it('takes no room in the layout: the list is laid out the same with the drawer open or closed', () => {
    const closed = renderWithProviders(
      <InspectorLayout inspector={null}>
        <button type="button">A row of the list</button>
      </InspectorLayout>,
    );
    const listOf = (): HTMLElement => {
      const column = screen.getByRole('button', { name: 'A row of the list' }).parentElement;
      if (column === null) throw new Error('The list has no column');
      return column;
    };
    const closedColumn = { className: listOf().className, style: listOf().getAttribute('style') };
    const closedArea = listOf().parentElement?.className;
    closed.unmount();

    renderWithProviders(<Harness />);
    expect(listOf().className).toBe(closedColumn.className);
    expect(listOf().getAttribute('style')).toBe(closedColumn.style);
    expect(listOf().parentElement?.className).toBe(closedArea);
    expect(listOf().parentElement?.getAttribute('style')).toBeNull();
    // jsdom computes no Tailwind positions, so the classes are what keeps the card out of the flow
    for (const taken of ['sticky', 'static', 'relative']) expect(inspector().classList).not.toContain(taken);
    expect(inspector().classList).toContain('fixed');
    expect(inspector().style.marginLeft).toBe('');
    expect(inspector().style.marginRight).toBe('');
  });

  it('is a modal sheet with a back button below 900 px', async () => {
    vi.stubGlobal('innerWidth', 899);
    const { user } = renderWithProviders(<Harness />);
    expect(await screen.findByRole('dialog', { name: 'best crm for startups' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to Keywords' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('stays a card at 900 px, narrowed to 60% of the window', () => {
    vi.stubGlobal('innerWidth', 900);
    renderWithProviders(<Harness />);
    expect(inspector()).toHaveStyle({ width: '536px' });
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

  it('previews a drag and saves the width once, on release, for the user', () => {
    Object.defineProperty(Element.prototype, 'setPointerCapture', { configurable: true, value: () => undefined });
    renderWithProviders(<Harness user="u1" />);
    fireEvent.pointerDown(separator(), { button: 0, clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 720, pointerId: 1 });
    // Drawn 80 px wider, with nothing in the layout moving and nothing saved yet
    expect(inspector()).toHaveStyle({ width: '720px' });
    expect(inspector().style.marginLeft).toBe('');
    expect(window.localStorage.getItem(WIDTH_KEY)).toBeNull();
    fireEvent.pointerUp(separator(), { clientX: 720, pointerId: 1 });
    expect(inspector()).toHaveStyle({ width: '720px' });
    expect(window.localStorage.getItem(WIDTH_KEY)).toBe('720');
    Reflect.deleteProperty(Element.prototype, 'setPointerCapture');
  });

  it('names a disabled Previous by why it is disabled', () => {
    renderWithProviders(<Harness atFirst />);
    expect(screen.getByRole('button', { name: 'First keyword in this list' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Next keyword' })).toBeEnabled();
  });

  it('resizes from the keyboard within its limits, and resets with Enter and a double click', async () => {
    vi.stubGlobal('innerWidth', 1280);
    const { user } = renderWithProviders(<Harness user="u1" />);
    act(() => separator().focus());
    expect(separator()).toHaveAttribute('aria-valuenow', '640');
    expect(separator()).toHaveAttribute('aria-valuemin', '480');
    expect(separator()).toHaveAttribute('aria-valuemax', '768');
    await user.keyboard('{ArrowLeft}');
    expect(separator()).toHaveAttribute('aria-valuenow', '656');
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(separator()).toHaveAttribute('aria-valuenow', '592');
    await user.keyboard('{End}');
    expect(separator()).toHaveAttribute('aria-valuenow', '768');
    expect(window.localStorage.getItem(WIDTH_KEY)).toBe('768');
    await user.keyboard('{Home}');
    expect(inspector()).toHaveStyle({ width: '480px' });
    await user.keyboard('{Enter}');
    expect(separator()).toHaveAttribute('aria-valuenow', '640');
    expect(window.localStorage.getItem(WIDTH_KEY)).toBeNull();
    await user.keyboard('{ArrowLeft}');
    expect(separator()).toHaveAttribute('aria-valuenow', '656');
    fireEvent.doubleClick(separator());
    expect(separator()).toHaveAttribute('aria-valuenow', '640');
    expect(window.localStorage.getItem(WIDTH_KEY)).toBeNull();
  });

  it('uses one saved width for every type', () => {
    window.localStorage.setItem(WIDTH_KEY, '720');
    renderWithProviders(<Harness type="prompt" user="u1" />);
    expect(inspector()).toHaveStyle({ width: '720px' });
  });

  it('narrows a saved width the window cannot hold, and leaves what is stored', () => {
    vi.stubGlobal('innerWidth', 1280);
    window.localStorage.setItem(WIDTH_KEY, '960');
    renderWithProviders(<Harness user="u1" />);
    expect(inspector()).toHaveStyle({ width: '768px' });
    expect(window.localStorage.getItem(WIDTH_KEY)).toBe('960');
  });

  it('does not rewrite a saved width with a key press the window clamps to no change', async () => {
    vi.stubGlobal('innerWidth', 1280);
    window.localStorage.setItem(WIDTH_KEY, '960');
    const { user } = renderWithProviders(<Harness user="u1" />);
    // Drawn at 768, the most this window holds
    expect(inspector()).toHaveStyle({ width: '768px' });
    act(() => separator().focus());
    for (const keys of ['{End}', '{ArrowLeft}', '{Shift>}{ArrowLeft}{/Shift}']) {
      await user.keyboard(keys);
      expect(window.localStorage.getItem(WIDTH_KEY)).toBe('960');
    }
    // A key that does change the width still saves it
    await user.keyboard('{ArrowRight}');
    expect(separator()).toHaveAttribute('aria-valuenow', '752');
    expect(window.localStorage.getItem(WIDTH_KEY)).toBe('752');
  });

  it('leaves the More menu out when asked, and keeps Close', () => {
    renderWithProviders(<Harness hideMoreActions />);
    expect(screen.queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('offers no width items, and leaves More out when it has no actions', async () => {
    const { user, rerender } = renderWithProviders(<Harness />);
    expect(screen.queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument();
    rerender(<Harness moreActions={[{ id: 'archive', label: 'Archive keyword', onSelect: vi.fn() }]} />);
    await user.click(screen.getByRole('button', { name: 'More actions for best crm for startups' }));
    expect(await screen.findByRole('menuitem', { name: 'Archive keyword' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.queryByRole('menuitemradio')).toBeNull();
    for (const name of ['Width', 'Default', 'Wide', 'Maximum', 'Reset width']) {
      expect(screen.queryByText(name)).toBeNull();
    }
  });

  it('steps with ArrowDown and ArrowUp from inside the card', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.keyboard('{ArrowDown}');
    expect(onStep).toHaveBeenLastCalledWith('next');
    await user.keyboard('{ArrowUp}');
    expect(onStep).toHaveBeenLastCalledWith('previous');
    onStep.mockReset();
    act(() => screen.getByRole('button', { name: 'Close' }).focus());
    await user.keyboard('{ArrowDown}');
    expect(onStep).toHaveBeenLastCalledWith('next');
    await user.keyboard('{ArrowUp}');
    expect(onStep).toHaveBeenLastCalledWith('previous');
  });

  it.each(ARROW_OWNER_CASES)('leaves the arrows to %s', (_name, tag, attributes) => {
    renderWithProviders(<Harness extraBody={<ArrowOwner tag={tag} attributes={attributes} />} />);
    const owner = screen.getByTestId('arrow-owner');
    // fireEvent returns false when a handler prevented the default
    expect(fireEvent.keyDown(owner, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(owner, { key: 'ArrowUp' })).toBe(true);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('leaves the arrows to a tab list, a scroll region and the resize handle', () => {
    renderWithProviders(
      <Harness
        extraBody={
          <InspectorBody label="Details">
            <p>Long text</p>
          </InspectorBody>
        }
      />,
    );
    for (const element of [
      screen.getByRole('tab', { name: 'Overview' }),
      screen.getByRole('region', { name: 'Details' }),
      separator(),
    ]) {
      fireEvent.keyDown(element, { key: 'ArrowDown' });
    }
    expect(onStep).not.toHaveBeenCalled();
  });

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey'])('does not step with %s held', (modifier) => {
    renderWithProviders(<Harness />);
    fireEvent.keyDown(title(), { key: 'ArrowDown', [modifier]: true });
    expect(onStep).not.toHaveBeenCalled();
    // The same key without the modifier steps, so the modifier is what stopped it
    fireEvent.keyDown(title(), { key: 'ArrowDown' });
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it('does not step on a held key or while an input method composes', () => {
    renderWithProviders(<Harness />);
    fireEvent.keyDown(title(), { key: 'ArrowDown', repeat: true });
    fireEvent.keyDown(title(), { key: 'ArrowDown', isComposing: true });
    expect(onStep).not.toHaveBeenCalled();
  });

  it('does not step when a control inside the card already took the key', () => {
    renderWithProviders(
      <Harness
        extraBody={
          <button type="button" onKeyDown={(event) => event.preventDefault()}>
            Takes its own key
          </button>
        }
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Takes its own key' }), { key: 'ArrowDown' });
    expect(onStep).not.toHaveBeenCalled();
  });

  it('does not step from a portal child of the card, which is outside it in the page', () => {
    renderWithProviders(
      <Harness extraBody={createPortal(<button type="button">In a portal</button>, document.body)} />,
    );
    const portaled = screen.getByRole('button', { name: 'In a portal' });
    expect(inspector()).not.toContainElement(portaled);
    // React bubbles the event through the card, so only the DOM containment rule stops it
    fireEvent.keyDown(portaled, { key: 'ArrowDown' });
    expect(onStep).not.toHaveBeenCalled();
  });

  it('does not step while a popup is open elsewhere on the page, and steps again once it closes', () => {
    renderWithProviders(<Harness />);
    const popup = document.createElement('div');
    popup.setAttribute('role', 'listbox');
    popup.setAttribute('data-open', '');
    document.body.append(popup);
    try {
      act(() => screen.getByRole('button', { name: 'Close' }).focus());
      fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'ArrowDown' });
      expect(onStep).not.toHaveBeenCalled();
    } finally {
      popup.remove();
    }
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'ArrowDown' });
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it('does not step while a menu opened from the card is open', async () => {
    const { user } = renderWithProviders(
      <Harness moreActions={[{ id: 'archive', label: 'Archive keyword', onSelect: vi.fn() }]} />,
    );
    await user.click(screen.getByRole('button', { name: 'More actions for best crm for startups' }));
    await screen.findByRole('menuitem', { name: 'Archive keyword' });
    await user.keyboard('{ArrowDown}');
    expect(onStep).not.toHaveBeenCalled();
  });

  it('does not step with the arrows when the drawer has no onStep', () => {
    renderWithProviders(<Harness withStep={false} />);
    // fireEvent returns false when a handler prevented the default
    expect(fireEvent.keyDown(title(), { key: 'ArrowDown' })).toBe(true);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('returns focus to the title when a step removes the focused control', async () => {
    const { user } = renderWithProviders(<SteppingHarness />);
    act(() => screen.getByRole('button', { name: 'Action of first keyword' }).focus());
    await user.keyboard('{ArrowDown}');
    expect(screen.queryByRole('button', { name: 'Action of first keyword' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'second keyword' })).toHaveFocus();
  });

  it('sits inside a boxed layout, sized by the box', () => {
    vi.stubGlobal('ResizeObserver', BoxObserver);
    renderWithProviders(<Harness boxed />);
    expect(inspector().className).toContain('absolute');
    expect(inspector().className).not.toContain('fixed');
    expect(inspector()).toHaveStyle({ width: '480px' });
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
