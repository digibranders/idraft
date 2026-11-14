import { act, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InspectorTarget } from './placement';
import { useInspectorStepping, type StepDirection, type SteppableInspector } from './use-inspector-stepping';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { announce } from '@/lib/a11y/announcer';
import { renderWithProviders } from '@/test/render';

vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

const announced = vi.mocked(announce);
const liveText = (): string => document.getElementById('live-region-polite')?.textContent ?? '';

const domain = (id: string): InspectorTarget => ({ type: 'domain', id });

/** What `useInspector` is to the hook: an open target and a step that records what it was asked. */
function fakeInspector(target: InspectorTarget | null): SteppableInspector & { step: ReturnType<typeof vi.fn> } {
  return { target, step: vi.fn<(direction: StepDirection, orderedIds: readonly string[]) => void>() };
}

interface ProbeProps {
  inspector: SteppableInspector;
  order: readonly string[];
  guard?: ((run: () => void) => void) | undefined;
}

/** Shows what the hook returns, as text and buttons, so a test reads and drives it like a person. */
function Probe({ inspector, order, guard }: ProbeProps): ReactElement {
  const stepping = useInspectorStepping({
    inspector,
    type: 'domain',
    order,
    typeLabel: 'Domain',
    typeNoun: 'domain',
    guard,
  });
  return (
    <div>
      <p data-testid="position">{stepping.positionText ?? 'unknown'}</p>
      <p data-testid="ends">
        {stepping.navigation === null
          ? 'no navigation'
          : `first:${stepping.navigation.atFirst} last:${stepping.navigation.atLast}`}
      </p>
      <p data-testid="onstep">{stepping.onStep === undefined ? 'off' : 'on'}</p>
      <button type="button" onClick={stepping.navigation?.onPrevious}>
        Previous
      </button>
      <button type="button" onClick={stepping.navigation?.onNext}>
        Next
      </button>
      <button type="button" onClick={() => stepping.onStep?.('next')}>
        Step next
      </button>
    </div>
  );
}

const text = (id: string): string => screen.getByTestId(id).textContent;

beforeEach(() => {
  announced.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useInspectorStepping', () => {
  it('reports the position in the table order, as "N of M"', () => {
    renderWithProviders(<Probe inspector={fakeInspector(domain('b'))} order={['a', 'b', 'c']} />);
    expect(text('position')).toBe('2 of 3');
    expect(text('ends')).toBe('first:false last:false');
    expect(text('onstep')).toBe('on');
  });

  it('groups thousands in the spoken position too', async () => {
    const order = Array.from({ length: 1240 }, (_, index) => `d${index}`);
    const { user } = renderWithProviders(<Probe inspector={fakeInspector(domain('d1238'))} order={order} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(liveText()).toBe('Domain, 1,240 of 1,240');
  });

  it('groups thousands in the counter', () => {
    const order = Array.from({ length: 1240 }, (_, index) => `d${index}`);
    renderWithProviders(<Probe inspector={fakeInspector(domain('d1239'))} order={order} />);
    expect(text('position')).toBe('1,240 of 1,240');
  });

  it('steps through the inspector in the order it was given, and announces the new position once', async () => {
    const inspector = fakeInspector(domain('b'));
    const { user } = renderWithProviders(<Probe inspector={inspector} order={['a', 'b', 'c']} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(inspector.step).toHaveBeenCalledTimes(1);
    expect(inspector.step).toHaveBeenCalledWith('next', ['a', 'b', 'c']);
    expect(announced).toHaveBeenCalledTimes(1);
    expect(liveText()).toBe('Domain, 3 of 3');

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(inspector.step).toHaveBeenLastCalledWith('previous', ['a', 'b', 'c']);
    expect(announced).toHaveBeenCalledTimes(2);
    expect(liveText()).toBe('Domain, 1 of 3');
  });

  it('stops at the last row without wrapping, and says so', async () => {
    const inspector = fakeInspector(domain('c'));
    const { user } = renderWithProviders(<Probe inspector={inspector} order={['a', 'b', 'c']} />);
    expect(text('ends')).toBe('first:false last:true');
    await user.click(screen.getByRole('button', { name: 'Step next' }));
    expect(inspector.step).not.toHaveBeenCalled();
    expect(announced).toHaveBeenCalledTimes(1);
    expect(liveText()).toBe('Last domain in this list');
  });

  it('stops at the first row without wrapping, and says so', async () => {
    const inspector = fakeInspector(domain('a'));
    const { user } = renderWithProviders(<Probe inspector={inspector} order={['a', 'b', 'c']} />);
    expect(text('ends')).toBe('first:true last:false');
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(inspector.step).not.toHaveBeenCalled();
    expect(liveText()).toBe('First domain in this list');
  });

  it('has no position when the open record is not in the list, never a wrong "N of M"', async () => {
    const inspector = fakeInspector(domain('gone'));
    const { user } = renderWithProviders(<Probe inspector={inspector} order={['a', 'b']} />);
    expect(text('position')).toBe('unknown');
    expect(text('ends')).toBe('no navigation');
    expect(text('onstep')).toBe('off');
    await user.click(screen.getByRole('button', { name: 'Step next' }));
    expect(inspector.step).not.toHaveBeenCalled();
    expect(announced).not.toHaveBeenCalled();
  });

  it('does not match a record of another type that has the same id', () => {
    const inspector = fakeInspector({ type: 'topic', id: 'b' });
    renderWithProviders(<Probe inspector={inspector} order={['a', 'b', 'c']} />);
    expect(text('position')).toBe('unknown');
    expect(text('onstep')).toBe('off');
  });

  it('has no position while nothing is open', () => {
    renderWithProviders(<Probe inspector={fakeInspector(null)} order={['a', 'b']} />);
    expect(text('position')).toBe('unknown');
    expect(text('onstep')).toBe('off');
  });

  it('keeps a correct position while rows are removed, reordered or filtered away', () => {
    const inspector = fakeInspector(domain('c'));
    const { rerender } = renderWithProviders(<Probe inspector={inspector} order={['a', 'b', 'c', 'd']} />);
    expect(text('position')).toBe('3 of 4');
    rerender(<Probe inspector={inspector} order={['c', 'a', 'b', 'd']} />);
    expect(text('position')).toBe('1 of 4');
    expect(text('ends')).toBe('first:true last:false');
    rerender(<Probe inspector={inspector} order={['d', 'b', 'c']} />);
    expect(text('position')).toBe('3 of 3');
    expect(text('ends')).toBe('first:false last:true');
    rerender(<Probe inspector={inspector} order={['d', 'b']} />);
    expect(text('position')).toBe('unknown');
    expect(text('onstep')).toBe('off');
    rerender(<Probe inspector={inspector} order={['x', 'c']} />);
    expect(text('position')).toBe('2 of 2');
  });

  it('steps through the newest order, not the one the step was drawn with', async () => {
    const inspector = fakeInspector(domain('b'));
    const { user, rerender } = renderWithProviders(<Probe inspector={inspector} order={['a', 'b', 'c']} />);
    rerender(<Probe inspector={inspector} order={['c', 'b', 'a', 'z']} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(inspector.step).toHaveBeenCalledWith('next', ['c', 'b', 'a', 'z']);
    expect(liveText()).toBe('Domain, 3 of 4');
  });

  it('handles an empty list and a list of one row', async () => {
    const empty = renderWithProviders(<Probe inspector={fakeInspector(domain('a'))} order={[]} />);
    expect(text('position')).toBe('unknown');
    expect(text('onstep')).toBe('off');
    empty.unmount();

    const inspector = fakeInspector(domain('a'));
    const { user } = renderWithProviders(<Probe inspector={inspector} order={['a']} />);
    expect(text('position')).toBe('1 of 1');
    expect(text('ends')).toBe('first:true last:true');
    await user.click(screen.getByRole('button', { name: 'Step next' }));
    expect(inspector.step).not.toHaveBeenCalled();
    expect(liveText()).toBe('Last domain in this list');
  });

  it('hands the step to the guard, and moves and announces only when the guard runs it', async () => {
    const inspector = fakeInspector(domain('a'));
    let pending: (() => void) | null = null;
    const guard = vi.fn((run: () => void) => {
      pending = run;
    });
    const { user } = renderWithProviders(<Probe inspector={inspector} order={['a', 'b']} guard={guard} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(guard).toHaveBeenCalledTimes(1);
    expect(inspector.step).not.toHaveBeenCalled();
    expect(announced).not.toHaveBeenCalled();

    act(() => pending?.());
    expect(inspector.step).toHaveBeenCalledWith('next', ['a', 'b']);
    expect(liveText()).toBe('Domain, 2 of 2');
  });

  it('does not ask the guard for a step that goes nowhere', async () => {
    const guard = vi.fn((run: () => void) => run());
    const { user } = renderWithProviders(
      <Probe inspector={fakeInspector(domain('b'))} order={['a', 'b']} guard={guard} />,
    );
    await user.click(screen.getByRole('button', { name: 'Step next' }));
    expect(guard).not.toHaveBeenCalled();
  });

  it('does one pass over a very long list per change, never one per step', async () => {
    const size = 100_000;
    const ids = Array.from({ length: size }, (_, index) => `d${index}`);
    let reads = 0;
    const order = new Proxy(ids, {
      get(source, key, receiver): unknown {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(source, key, receiver);
      },
    });
    const inspector = fakeInspector(domain(`d${size / 2}`));
    const { user, rerender } = renderWithProviders(<Probe inspector={inspector} order={order} />);
    expect(text('position')).toBe('50,001 of 100,000');
    const afterMount = reads;
    expect(afterMount).toBeLessThanOrEqual(size);
    rerender(<Probe inspector={inspector} order={order} />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(reads).toBe(afterMount);
  });
});

/** A list page as a screen builds it: the grid, an input beside it, and an inspector fed by the hook. */
function Screen({ order: initial }: { order: readonly string[] }): ReactElement {
  const inspector = useInspector();
  const [order] = useState(initial);
  const stepping = useInspectorStepping({
    inspector,
    type: 'domain',
    order,
    typeLabel: 'Domain',
    typeNoun: 'domain',
  });
  return (
    <InspectorLayout
      inspector={
        inspector.target === null ? null : (
          <Inspector
            type="domain"
            backLabel="Back to Domains"
            onClose={inspector.close}
            onStep={stepping.onStep}
            header={{
              title: inspector.target.id,
              typeLabel: 'Domain',
              typeNoun: 'domain',
              positionText: stepping.positionText,
              navigation: stepping.navigation,
              moreActions: [],
            }}
          >
            <p>Details</p>
          </Inspector>
        )
      }
    >
      <div role="grid" aria-label="Domains">
        <div role="row">
          <div role="gridcell">
            <button type="button">A cell</button>
          </div>
          <div role="gridcell">
            <input aria-label="Filter" />
          </div>
          <div role="gridcell">
            <textarea aria-label="Note" />
          </div>
        </div>
      </div>
    </InspectorLayout>
  );
}

class AreaObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: { width: 1232, height: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

describe('useInspectorStepping inside a real Inspector', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', AreaObserver);
    vi.stubGlobal('innerWidth', 1440);
    Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(Element.prototype, 'getAnimations');
  });

  it('steps with J and K from the grid, announces, and stops at the ends', async () => {
    const urls: string[] = [];
    const { user } = renderWithProviders(<Screen order={['a', 'b', 'c']} />, {
      searchParams: '?inspect=domain:b',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'A cell' }).focus());

    // Exactly one announcement per key: a second J listener (the hook binding keys as well) would speak twice
    await user.keyboard('j');
    await waitFor(() => {
      expect(screen.getByText('3 of 3')).toBeInTheDocument();
    });
    expect(urls.at(-1)).toBe('?inspect=domain:c');
    expect(announced).toHaveBeenCalledTimes(1);
    expect(liveText()).toBe('Domain, 3 of 3');

    const updates = urls.length;
    await user.keyboard('j');
    expect(urls).toHaveLength(updates);
    expect(announced).toHaveBeenCalledTimes(2);
    expect(liveText()).toBe('Last domain in this list');
    expect(screen.getByRole('button', { name: 'Last domain in this list' })).toHaveAttribute('aria-disabled', 'true');

    await user.keyboard('k');
    await waitFor(() => {
      expect(screen.getByText('2 of 3')).toBeInTheDocument();
    });
    expect(urls.at(-1)).toBe('?inspect=domain:b');
    expect(announced).toHaveBeenCalledTimes(3);
    expect(liveText()).toBe('Domain, 2 of 3');

    await user.keyboard('k');
    await waitFor(() => {
      expect(screen.getByText('1 of 3')).toBeInTheDocument();
    });
    expect(urls.at(-1)).toBe('?inspect=domain:a');
    expect(announced).toHaveBeenCalledTimes(4);

    await user.keyboard('k');
    expect(announced).toHaveBeenCalledTimes(5);
    expect(liveText()).toBe('First domain in this list');
    expect(urls.at(-1)).toBe('?inspect=domain:a');
  });

  it('does nothing while a person types a j or k in a field or a text area', async () => {
    const urls: string[] = [];
    const { user } = renderWithProviders(<Screen order={['a', 'b', 'c']} />, {
      searchParams: '?inspect=domain:b',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    await user.click(screen.getByRole('textbox', { name: 'Filter' }));
    await user.keyboard('jk');
    expect(screen.getByRole('textbox', { name: 'Filter' })).toHaveValue('jk');
    await user.click(screen.getByRole('textbox', { name: 'Note' }));
    await user.keyboard('jk');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('jk');
    expect(urls).toHaveLength(0);
    expect(announced).not.toHaveBeenCalled();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  it('leaves Ctrl+J to the browser: a modifier is never a step', async () => {
    const urls: string[] = [];
    const { user } = renderWithProviders(<Screen order={['a', 'b', 'c']} />, {
      searchParams: '?inspect=domain:b',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    act(() => screen.getByRole('button', { name: 'A cell' }).focus());
    await user.keyboard('{Control>}j{/Control}');
    expect(urls).toHaveLength(0);
    expect(announced).not.toHaveBeenCalled();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  it('turns J and K off for a record that is not in the list', async () => {
    const urls: string[] = [];
    const { user } = renderWithProviders(<Screen order={['a', 'b']} />, {
      searchParams: '?inspect=domain:gone',
      onUrlUpdate: (event) => urls.push(event.queryString),
    });
    expect(screen.queryByText(/ of /)).toBeNull();
    act(() => screen.getByRole('button', { name: 'A cell' }).focus());
    await user.keyboard('jk');
    expect(urls).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /in this list/ })).toBeNull();
  });
});
