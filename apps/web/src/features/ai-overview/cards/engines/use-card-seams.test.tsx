import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { useCardDrill, useCardExport } from './use-card-seams';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const TYPE = 'ai.by_engine';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useCardDrill', () => {
  it('carries both slugs of the page and the engine into the link of a destination that is live', async () => {
    function Card(): ReactElement {
      const drill = useCardDrill();
      return (
        <>
          <p>{`prompts:${drill('prompts', { engine: 'chatgpt_web' }) ?? 'none'}`}</p>
          <p>{`prompt:${drill('prompt') ?? 'none'}`}</p>
        </>
      );
    }
    renderWithProviders(cardInOverview({ type: TYPE, Card }));
    const link = await screen.findByText(/^prompts:/);
    expect(link.textContent).toMatch(/^prompts:\/digibranders\/fynix\/ai\/prompts\?/);
    expect(link.textContent).toContain('engine=chatgpt_web');
    // A prompt without an id has no page to open: the number stays plain text
    expect(screen.getByText('prompt:none')).toBeInTheDocument();
  });
});

describe('useCardExport', () => {
  it('registers the block of the item while mounted and removes it on unmount', async () => {
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      const reader = useExportBlocks();
      read = reader;
      return <></>;
    }
    function Exporting(): ReactElement {
      useCardExport('item-1', () => ({ id: 'item-1', header: ['Engine'], rows: [['ChatGPT']] }));
      return <></>;
    }
    function Card(): ReactElement {
      const [shown, setShown] = useState(true);
      return (
        <ExportProvider>
          <Reader />
          {shown ? <Exporting /> : null}
          <button
            type="button"
            onClick={() => {
              setShown(false);
            }}
          >
            Remove
          </button>
        </ExportProvider>
      );
    }
    const { user } = renderWithProviders(cardInOverview({ type: TYPE, Card }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(read().blocks).toEqual([]);
  });

  it('keeps the block while mounted', async () => {
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Card(): ReactElement {
      const reader = useExportBlocks();
      read = reader;
      useCardExport('item-1', () => ({ id: 'item-1', header: ['Engine'], rows: [['ChatGPT']] }));
      return <p>mounted</p>;
    }
    function Page(): ReactElement {
      return (
        <ExportProvider>
          <Card />
        </ExportProvider>
      );
    }
    renderWithProviders(cardInOverview({ type: TYPE, Card: Page }));
    await screen.findByText('mounted');
    expect(read().blocks).toEqual([{ id: 'item-1', header: ['Engine'], rows: [['ChatGPT']] }]);
  });

  it('is a no-op outside an export provider', async () => {
    function Card(): ReactElement {
      useCardExport('item-1', () => null);
      return <p>alone</p>;
    }
    renderWithProviders(cardInOverview({ type: TYPE, Card }));
    expect(await screen.findByText('alone')).toBeInTheDocument();
  });
});
