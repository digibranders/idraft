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
  it('reads no cmp key as off: the table opens without a comparison', () => {
    render('');
    expect(screen.getByLabelText('compare')).toHaveTextContent('off');
  });

  it('reads cmp=previous as on', () => {
    render('?cmp=previous');
    expect(screen.getByLabelText('compare')).toHaveTextContent('on');
  });

  it('reads a link of the old default, cmp=off, as off', () => {
    render('?cmp=off');
    expect(screen.getByLabelText('compare')).toHaveTextContent('off');
  });

  it('writes cmp=previous with history replace when set to on', async () => {
    const { user, writes } = render('?tab=prompts');
    await user.click(screen.getByRole('button', { name: 'turn on' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).toContain('cmp=previous'));
    expect(writes.at(-1)?.queryString).toContain('tab=prompts');
    expect(writes.at(-1)?.history).toBe('replace');
    expect(screen.getByLabelText('compare')).toHaveTextContent('on');
  });

  it('removes the key when set to off, because a default writes nothing', async () => {
    const { user, writes } = render('?cmp=previous&tab=prompts');
    await user.click(screen.getByRole('button', { name: 'turn off' }));
    await waitFor(() => expect(writes.at(-1)?.queryString).not.toContain('cmp'));
    expect(writes.at(-1)?.queryString).toContain('tab=prompts');
    expect(screen.getByLabelText('compare')).toHaveTextContent('off');
  });

  it('reads an unknown value as off and leaves the address as it is', () => {
    const { writes } = render('?cmp=previous_year');
    expect(screen.getByLabelText('compare')).toHaveTextContent('off');
    expect(writes).toEqual([]);
  });
});
