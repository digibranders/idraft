import { render, screen } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFragmentParam } from './use-fragment-param';

function Show({ name }: { name: string }): ReactNode {
  const value = useFragmentParam(name);
  return <p>{value === undefined ? 'reading' : value === null ? 'none' : value}</p>;
}

const at = (url: string): void => window.history.replaceState(null, '', url);

describe('useFragmentParam', () => {
  afterEach(() => at('/'));

  it('reads the value and removes it from the address bar, keeping the path, query and other values', async () => {
    at('/reset-password?next=%2Fsettings#token=abc123&tab=security');
    render(
      <StrictMode>
        <Show name="token" />
      </StrictMode>,
    );
    expect(await screen.findByText('abc123')).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/reset-password?next=%2Fsettings#tab=security',
    );
  });

  it('removes the fragment entirely when the token was its only value', async () => {
    at('/verify-email#token=xyz');
    render(<Show name="token" />);
    expect(await screen.findByText('xyz')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(window.location.href.endsWith('/verify-email')).toBe(true);
  });

  it('reads the address again on a later visit, instead of giving the value of the last one', async () => {
    at('/verify-email#token=xyz');
    const { unmount } = render(<Show name="token" />);
    expect(await screen.findByText('xyz')).toBeInTheDocument();
    unmount();
    // Past the moment a strict-mode remount would still be served from memory
    await Promise.resolve();
    await Promise.resolve();
    const seen: (string | null | undefined)[] = [];
    function Record(): ReactNode {
      const value = useFragmentParam('token');
      seen.push(value);
      return null;
    }
    render(<Record />);
    // Never the old token, not even for one render: a screen would send it again
    expect(seen).toEqual([undefined, null]);
  });

  it('removes the value with a state of its own, so the router adopts the new address', async () => {
    at('/verify-email#token=xyz');
    const replace = vi.spyOn(window.history, 'replaceState');
    render(<Show name="token" />);
    expect(await screen.findByText('xyz')).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith(null, '', '/verify-email');
    replace.mockRestore();
  });

  it('says there is none when the fragment has no such value', async () => {
    at('/invite');
    render(<Show name="token" />);
    expect(await screen.findByText('none')).toBeInTheDocument();
  });
});
