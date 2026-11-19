import { screen, waitFor } from '@testing-library/react';
import type { UrlUpdateEvent } from 'nuqs/adapters/testing';
import { createElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { parseMinSupport, useFanoutMinSupport, useFanoutView } from './use-fanout-view-state';
import { renderWithProviders } from '@/test/render';

describe('parseMinSupport', () => {
  it('is 2 by default', () => {
    expect(parseMinSupport(null)).toBe(2);
    expect(parseMinSupport(undefined)).toBe(2);
    expect(parseMinSupport('')).toBe(2);
  });

  it('reads a whole number', () => {
    expect(parseMinSupport('7')).toBe(7);
    expect(parseMinSupport(' 10 ')).toBe(10);
  });

  it('clamps 0 to 1 and 5000 to 1000', () => {
    expect(parseMinSupport('0')).toBe(1);
    expect(parseMinSupport('-3')).toBe(1);
    expect(parseMinSupport('5000')).toBe(1000);
  });

  it('is 2 for text that is not a whole number', () => {
    expect(parseMinSupport('abc')).toBe(2);
    expect(parseMinSupport('2.5')).toBe(2);
    expect(parseMinSupport('5 answers')).toBe(2);
  });
});

/** The state of the hooks as a page would hold it: the value on screen and one button per change to ask for. */
function MinProbe(): ReactElement {
  const [minSupport, setMinSupport] = useFanoutMinSupport();
  return createElement(
    'div',
    null,
    createElement('output', { 'aria-label': 'minimum' }, String(minSupport)),
    createElement('button', { type: 'button', onClick: () => setMinSupport(5) }, 'five'),
    createElement('button', { type: 'button', onClick: () => setMinSupport(2) }, 'two'),
    createElement('button', { type: 'button', onClick: () => setMinSupport(null) }, 'default'),
  );
}

function ViewProbe(): ReactElement {
  const [view, setView] = useFanoutView();
  return createElement(
    'div',
    null,
    createElement('output', { 'aria-label': 'view' }, view),
    createElement('button', { type: 'button', onClick: () => setView('topics') }, 'topics'),
    createElement('button', { type: 'button', onClick: () => setView('queries') }, 'queries'),
  );
}

interface Write {
  query: URLSearchParams;
  history: string | undefined;
}

function writes(): { onUrlUpdate: (event: UrlUpdateEvent) => void; all: Write[] } {
  const all: Write[] = [];
  return {
    all,
    onUrlUpdate: (event) => all.push({ query: new URLSearchParams(event.queryString), history: event.options.history }),
  };
}

describe('useFanoutMinSupport', () => {
  it('is 2 when the address has no fmin, and 2 is not written to the address', async () => {
    const url = writes();
    const { user } = renderWithProviders(createElement(MinProbe), { onUrlUpdate: url.onUrlUpdate });
    expect(screen.getByLabelText('minimum')).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: 'five' }));
    await waitFor(() => expect(url.all.at(-1)?.query.get('fmin')).toBe('5'));
    await user.click(screen.getByRole('button', { name: 'two' }));
    await waitFor(() => expect(screen.getByLabelText('minimum')).toHaveTextContent('2'));
    expect(url.all.at(-1)?.query.has('fmin')).toBe(false);
  });

  it('writes 5 as fmin=5 with history replace', async () => {
    const url = writes();
    const { user } = renderWithProviders(createElement(MinProbe), { onUrlUpdate: url.onUrlUpdate });
    await user.click(screen.getByRole('button', { name: 'five' }));
    await waitFor(() => expect(screen.getByLabelText('minimum')).toHaveTextContent('5'));
    expect(url.all.at(-1)?.query.get('fmin')).toBe('5');
    expect(url.all.at(-1)?.history).toBe('replace');
  });

  it('clears the key for null, the default the select reports', async () => {
    const url = writes();
    const { user } = renderWithProviders(createElement(MinProbe), {
      searchParams: '?fmin=7',
      onUrlUpdate: url.onUrlUpdate,
    });
    await user.click(screen.getByRole('button', { name: 'default' }));
    await waitFor(() => expect(screen.getByLabelText('minimum')).toHaveTextContent('2'));
    expect(url.all.at(-1)?.query.has('fmin')).toBe(false);
  });

  it('reads fmin=7', () => {
    renderWithProviders(createElement(MinProbe), { searchParams: '?fmin=7' });
    expect(screen.getByLabelText('minimum')).toHaveTextContent('7');
  });

  it('keeps the other keys of the address', async () => {
    const url = writes();
    const { user } = renderWithProviders(createElement(MinProbe), {
      searchParams: '?tab=fanout&role=own',
      onUrlUpdate: url.onUrlUpdate,
    });
    await user.click(screen.getByRole('button', { name: 'five' }));
    await waitFor(() => expect(url.all.at(-1)?.query.get('fmin')).toBe('5'));
    expect(url.all.at(-1)?.query.get('tab')).toBe('fanout');
    expect(url.all.at(-1)?.query.get('role')).toBe('own');
  });
});

describe('useFanoutView', () => {
  it('is queries when the address has no fview', () => {
    renderWithProviders(createElement(ViewProbe));
    expect(screen.getByLabelText('view')).toHaveTextContent('queries');
  });

  it('writes topics as fview=topics, and queries is not written', async () => {
    const url = writes();
    const { user } = renderWithProviders(createElement(ViewProbe), { onUrlUpdate: url.onUrlUpdate });
    await user.click(screen.getByRole('button', { name: 'topics' }));
    await waitFor(() => expect(url.all.at(-1)?.query.get('fview')).toBe('topics'));
    expect(screen.getByLabelText('view')).toHaveTextContent('topics');
    await user.click(screen.getByRole('button', { name: 'queries' }));
    await waitFor(() => expect(screen.getByLabelText('view')).toHaveTextContent('queries'));
    expect(url.all.at(-1)?.query.has('fview')).toBe(false);
  });

  it('reads fview=topics, and any other value is queries', () => {
    const { unmount } = renderWithProviders(createElement(ViewProbe), { searchParams: '?fview=topics' });
    expect(screen.getByLabelText('view')).toHaveTextContent('topics');
    unmount();
    renderWithProviders(createElement(ViewProbe), { searchParams: '?fview=anything' });
    expect(screen.getByLabelText('view')).toHaveTextContent('queries');
  });
});
