/** The card registry (plan WP-15, section 2.2): components load lazily, once, and are never rebuilt by a render. */
import { act, render, screen } from '@testing-library/react';
import { Component, Suspense, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CardSkeleton, defineCards, type CardProps, type CardRegistry } from './registry';
import { axe } from '@/test/axe';

const PROPS: CardProps = {
  item: { id: 'a-1', type: 'seo.top_movers', width: 'half', options: { rows: '5' } },
  options: { rows: '5' },
  width: 'half',
  mode: 'customize',
  live: false,
};

function Probe({ item, options, width, mode, live }: CardProps): ReactElement {
  return (
    <p data-testid="probe">
      {item.id}|{options.rows}|{width}|{mode}|{String(live)}
    </p>
  );
}

/** A `load` the test settles by hand, so the pending state can be looked at. */
function deferredLoad(): {
  load: () => Promise<{ default: ComponentType<CardProps> }>;
  settle: () => Promise<void>;
  calls: () => number;
} {
  let calls = 0;
  let resolve: (module: { default: ComponentType<CardProps> }) => void = () => undefined;
  const pending = new Promise<{ default: ComponentType<CardProps> }>((done) => {
    resolve = done;
  });
  return {
    load: () => {
      calls += 1;
      return pending;
    },
    settle: () => act(async () => resolve({ default: Probe })),
    calls: () => calls,
  };
}

function Slot({ registry, type }: { registry: CardRegistry; type: string }): ReactElement {
  const card = registry[type];
  if (!card) throw new Error(`no card ${type}`);
  return (
    <Suspense fallback={<card.Skeleton />}>
      <card.Component {...PROPS} />
    </Suspense>
  );
}

describe('defineCards', () => {
  it('does not load a card until it is rendered', () => {
    const load = vi.fn(() => Promise.resolve({ default: Probe }));
    const registry = defineCards({ a: { load } });
    expect(registry.a).toBeDefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads the card when Suspense renders it, and passes the props through', async () => {
    const load = vi.fn(() => Promise.resolve({ default: Probe }));
    const registry = defineCards({ a: { load } });
    render(<Slot registry={registry} type="a" />);
    expect(await screen.findByTestId('probe')).toHaveTextContent('a-1|5|half|customize|false');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows the default skeleton while the card is pending', async () => {
    const { load, settle } = deferredLoad();
    const registry = defineCards({ a: { load } });
    render(<Slot registry={registry} type="a" />);
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByTestId('probe')).toBeNull();
    await settle();
    expect(screen.getByTestId('probe')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it('shows the custom skeleton when the registration has one', async () => {
    const { load, settle } = deferredLoad();
    const registry = defineCards({
      a: { load, skeleton: () => <div data-testid="custom-skeleton" /> },
    });
    render(<Slot registry={registry} type="a" />);
    expect(screen.getByTestId('custom-skeleton')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
    await settle();
    expect(screen.queryByTestId('custom-skeleton')).toBeNull();
  });

  it('gives every registration the default skeleton when it names none', () => {
    const registry = defineCards({ a: { load: () => Promise.resolve({ default: Probe }) } });
    expect(registry.a?.Skeleton).toBe(CardSkeleton);
  });

  it('keeps one Component per type, so a re-render does not load or remount the card', async () => {
    const load = vi.fn(() => Promise.resolve({ default: Probe }));
    const registry = defineCards({ a: { load } });
    const component = registry.a?.Component;
    const view = render(<Slot registry={registry} type="a" />);
    expect(await screen.findByTestId('probe')).toBeInTheDocument();
    view.rerender(<Slot registry={registry} type="a" />);
    expect(registry.a?.Component).toBe(component);
    expect(screen.getByTestId('probe')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads each type on its own', async () => {
    const loadA = vi.fn(() => Promise.resolve({ default: Probe }));
    const loadB = vi.fn(() => Promise.resolve({ default: Probe }));
    const registry = defineCards({ a: { load: loadA }, b: { load: loadB } });
    render(<Slot registry={registry} type="b" />);
    expect(await screen.findByTestId('probe')).toBeInTheDocument();
    expect(loadA).not.toHaveBeenCalled();
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it('has no entry for a type nobody registered', () => {
    expect(defineCards({})['seo.top_movers']).toBeUndefined();
  });
});

/** Shows what an error boundary would: the failure of a card, in place of the card. */
class Catch extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? <p>caught</p> : this.props.children;
  }
}

describe('reset', () => {
  it('after a failed load makes the next render load again', async () => {
    // React reports the error it hands to the boundary
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi
      .fn<() => Promise<{ default: ComponentType<CardProps> }>>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValue({ default: Probe });
    const registry = defineCards({ a: { load } });
    const component = registry.a?.Component;
    const first = render(
      <Catch>
        <Slot registry={registry} type="a" />
      </Catch>,
    );
    expect(await screen.findByText('caught')).toBeInTheDocument();
    first.unmount();

    // Without a reset the failure is remembered, and nothing is asked of the network again
    const stuck = render(
      <Catch>
        <Slot registry={registry} type="a" />
      </Catch>,
    );
    expect(await screen.findByText('caught')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    stuck.unmount();

    registry.a?.reset();
    render(
      <Catch>
        <Slot registry={registry} type="a" />
      </Catch>,
    );
    expect(await screen.findByTestId('probe')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    // Callers keep the one Component they were given
    expect(registry.a?.Component).toBe(component);
    consoleError.mockRestore();
  });

  it('after a good load keeps the loaded component', async () => {
    const load = vi.fn(() => Promise.resolve({ default: Probe }));
    const registry = defineCards({ a: { load } });
    const first = render(<Slot registry={registry} type="a" />);
    expect(await screen.findByTestId('probe')).toBeInTheDocument();
    first.unmount();

    registry.a?.reset();
    render(<Slot registry={registry} type="a" />);
    expect(await screen.findByTestId('probe')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('counts a load that throws at once as a failed load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let broken = true;
    const registry = defineCards({
      a: {
        load: () => {
          if (broken) throw new Error('no network');
          return Promise.resolve({ default: Probe });
        },
      },
    });
    const first = render(
      <Catch>
        <Slot registry={registry} type="a" />
      </Catch>,
    );
    expect(await screen.findByText('caught')).toBeInTheDocument();
    first.unmount();
    broken = false;
    registry.a?.reset();
    render(<Slot registry={registry} type="a" />);
    expect(await screen.findByTestId('probe')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});

describe('CardSkeleton', () => {
  it('is one block with a minimum height, hidden from assistive technology', () => {
    render(<CardSkeleton />);
    const blocks = document.querySelectorAll('[data-slot="skeleton"]');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveClass('min-h-30');
    expect(blocks[0]).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes axe', async () => {
    const { container } = render(<CardSkeleton />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
