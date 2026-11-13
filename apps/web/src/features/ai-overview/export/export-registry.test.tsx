import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ExportBlock } from './export-model';
import { ExportProvider, useExportBlock, useExportBlocks, type ExportRead } from './export-registry';

const block = (id: string, value: number = 1): ExportBlock => ({ id, header: ['x'], rows: [[value]] });

function Card({ id, getBlock }: { id: string; getBlock: () => ExportBlock | null }): null {
  useExportBlock(id, getBlock);
  return null;
}

/** Hands the reader of the registry to the test, as the menu item would hold it. */
function Menu({ onReader }: { onReader: (read: () => ExportRead) => void }): null {
  onReader(useExportBlocks());
  return null;
}

function setup(cards: Record<string, () => ExportBlock | null>): {
  read: () => ExportRead;
  rerender: (cards: Record<string, () => ExportBlock | null>) => void;
  unmount: () => void;
} {
  let reader: (() => ExportRead) | null = null;
  const tree = (current: Record<string, () => ExportBlock | null>): ReactElement => (
    <ExportProvider>
      {Object.entries(current).map(([id, getBlock]) => (
        <Card key={id} id={id} getBlock={getBlock} />
      ))}
      <Menu
        onReader={(read) => {
          reader = read;
        }}
      />
    </ExportProvider>
  );
  const view = render(tree(cards));
  return {
    read: () => {
      if (reader === null) throw new Error('The menu did not render');
      return reader();
    },
    rerender: (next) => view.rerender(tree(next)),
    unmount: view.unmount,
  };
}

describe('the export registry', () => {
  it('has a card register a block with useExportBlock(id, getBlock) and unregister it on unmount', () => {
    const view = setup({ 'ai.by_engine': () => block('ai.by_engine') });
    expect(view.read()).toEqual({ blocks: [block('ai.by_engine')], loading: 0 });
    view.rerender({});
    expect(view.read()).toEqual({ blocks: [], loading: 0 });
  });

  it('leaves out a block that returns null (still loading) and counts it', () => {
    const view = setup({
      'ai.a': () => block('ai.a'),
      'ai.b': () => null,
      'ai.c': () => null,
    });
    expect(view.read()).toEqual({ blocks: [block('ai.a')], loading: 2 });
  });

  it('reads the blocks when the menu item runs, not on every render', () => {
    const getBlock = vi.fn(() => block('ai.a'));
    const view = setup({ 'ai.a': getBlock });
    view.rerender({ 'ai.a': getBlock });
    view.rerender({ 'ai.a': getBlock });
    expect(getBlock).not.toHaveBeenCalled();
    view.read();
    expect(getBlock).toHaveBeenCalledTimes(1);
    view.read();
    expect(getBlock).toHaveBeenCalledTimes(2);
  });

  it('reads the latest getBlock a card passed, without registering again', () => {
    const first = vi.fn(() => block('ai.a', 1));
    const second = vi.fn(() => block('ai.a', 2));
    const view = setup({ 'ai.a': first });
    view.rerender({ 'ai.a': second });
    expect(view.read().blocks).toEqual([block('ai.a', 2)]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('gives the blocks in the order of their ids, whichever card mounted first', () => {
    const view = setup({ 'ai.b': () => block('ai.b'), 'ai.a': () => block('ai.a'), 'ai.c': () => block('ai.c') });
    expect(view.read().blocks.map((entry) => entry.id)).toEqual(['ai.a', 'ai.b', 'ai.c']);
  });

  it('lets the newer card of an id win, and keeps it when the older one unmounts', () => {
    const held: { read: (() => ExportRead) | null } = { read: null };
    const tree = (older: boolean): ReactElement => (
      <ExportProvider>
        {older ? <Card id="ai.a" getBlock={() => block('ai.a', 1)} /> : null}
        <Card id="ai.a" getBlock={() => block('ai.a', 2)} />
        <Menu
          onReader={(read) => {
            held.read = read;
          }}
        />
      </ExportProvider>
    );
    const view = render(tree(true));
    expect(held.read?.().blocks).toEqual([block('ai.a', 2)]);
    view.rerender(tree(false));
    expect(held.read?.().blocks).toEqual([block('ai.a', 2)]);
  });

  it('shares the outer registry when a provider sits inside another, so the outer reader sees the inner cards', () => {
    const held: { read: (() => ExportRead) | null } = { read: null };
    render(
      <ExportProvider>
        <ExportProvider>
          <Card id="ai.a" getBlock={() => block('ai.a')} />
        </ExportProvider>
        <Menu
          onReader={(read) => {
            held.read = read;
          }}
        />
      </ExportProvider>,
    );
    expect(held.read?.().blocks).toEqual([block('ai.a')]);
  });

  it('is a no-op outside an ExportProvider, so a card renders alone and the reader is empty', () => {
    const getBlock = vi.fn(() => block('ai.a'));
    const held: { read: (() => ExportRead) | null } = { read: null };
    render(
      <>
        <Card id="ai.a" getBlock={getBlock} />
        <Menu
          onReader={(read) => {
            held.read = read;
          }}
        />
      </>,
    );
    expect(getBlock).not.toHaveBeenCalled();
    expect(held.read?.()).toEqual({ blocks: [], loading: 0 });
  });
});
