import { screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { useCompare } from './use-compare';
import { renderWithProviders } from '@/test/render';

function Probe(): ReactElement {
  const { compare, setCompare } = useCompare();
  return (
    <div>
      <output aria-label="compare">{compare ? 'on' : 'off'}</output>
      <button type="button" onClick={() => setCompare(false)}>
        turn off
      </button>
      <button type="button" onClick={() => setCompare(true)}>
        turn on
      </button>
    </div>
  );
}

interface Write {
  queryString: string;
  history: string | undefined;
}

const render = (searchParams: string): ReturnType<typeof renderWithProviders> & { writes: Write[] } => {
  const writes: Write[] = [];
  const rendered = renderWithProviders(<Probe />, {
    searchParams,
    onUrlUpdate: ({ queryString, options }) => writes.push({ queryString, history: options.history }),
  });
  return { ...rendered, writes };
};

describe('useCompare', () => {
  it('reads no cmp key as on', () => {
    render('');
    expect(screen.getByLabelText('compare')).toHaveTextContent('on');
  });

  it('reads cmp=off as off', () => {
    render('?cmp=off');
    expect(screen.getByLabelText('compare')).toHaveTextContent('off');
  });

  it('writes cmp=off with history replace when set to off', async () => {
    const { user, writes } = render('');
    await user.click(screen.getByRole('button', { name: 'turn off' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('cmp=off'));
    expect(writes.at(-1)?.history).toBe('replace');
    expect(screen.getByLabelText('compare')).toHaveTextContent('off');
  });

  it('removes the key when set to on, because a default writes nothing', async () => {
    const { user, writes } = render('?cmp=off&tab=prompts');
    await user.click(screen.getByRole('button', { name: 'turn on' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).not.toContain('cmp'));
    expect(writes.at(-1)?.queryString).toContain('tab=prompts');
    expect(screen.getByLabelText('compare')).toHaveTextContent('on');
  });

  it('reads an unknown value as on and leaves the address as it is', () => {
    const { writes } = render('?cmp=previous_year');
    expect(screen.getByLabelText('compare')).toHaveTextContent('on');
    expect(writes).toEqual([]);
  });
});
