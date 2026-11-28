import { screen, waitFor } from '@testing-library/react';
import { useContext, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { usePromptOpener } from './use-prompt-opener';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { PromptOrderContext } from '@/lib/inspector/prompt-order';
import { renderWithProviders } from '@/test/render';

function Harness(): ReactElement {
  const inspector = useInspector();
  const { order, openPrompt } = usePromptOpener(inspector);
  return (
    <PromptOrderContext.Provider value={order}>
      <OrderReadout />
      <button type="button" onClick={() => openPrompt('p1', ['p1', 'p2'])}>
        Open p1
      </button>
      <button type="button" onClick={() => openPrompt('p3')}>
        Open p3
      </button>
    </PromptOrderContext.Provider>
  );
}

function OrderReadout(): ReactElement {
  const order = useContext(PromptOrderContext);
  return <output data-testid="order">{order.join(',')}</output>;
}

describe('usePromptOpener', () => {
  it('writes inspect=prompt:<id>, drops itab from a previous page drawer tab, and updates PromptOrderContext', async () => {
    const onUrlUpdate = vi.fn();
    const { user } = renderWithProviders(<Harness />, {
      searchParams: '?inspect=page:108&itab=ai',
      onUrlUpdate,
    });

    await user.click(screen.getByRole('button', { name: 'Open p1' }));

    await waitFor(() => expect(screen.getByTestId('order')).toHaveTextContent('p1,p2'));
    const last = onUrlUpdate.mock.calls.at(-1)?.[0] as { queryString: string } | undefined;
    expect(last?.queryString).toBe('?inspect=prompt:p1');
    expect(last?.queryString).not.toContain('itab');
  });

  it('keeps the previous order when openPrompt is called without an id list', async () => {
    const onUrlUpdate = vi.fn();
    const { user } = renderWithProviders(<Harness />, { onUrlUpdate });

    await user.click(screen.getByRole('button', { name: 'Open p1' }));
    await waitFor(() => expect(screen.getByTestId('order')).toHaveTextContent('p1,p2'));

    await user.click(screen.getByRole('button', { name: 'Open p3' }));
    const last = onUrlUpdate.mock.calls.at(-1)?.[0] as { queryString: string } | undefined;
    expect(last?.queryString).toBe('?inspect=prompt:p3');
    expect(screen.getByTestId('order')).toHaveTextContent('p1,p2');
  });
});
