import { render, renderHook, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Kbd, SingleKeyShortcutsContext, useAriaKeyShortcuts } from './kbd';
import { axe } from '@/test/axe';

const onMac = (): void => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
};
const caps = (): string[] => [...document.querySelectorAll('kbd')].map((node) => node.textContent ?? '');

describe('Kbd', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes modifiers as words off the Mac', () => {
    render(<Kbd keys={['mod', 'shift', 'k']} />);
    expect(caps()).toEqual(['Ctrl', 'Shift', 'K']);
  });

  it('writes modifiers as glyphs on a Mac', () => {
    onMac();
    render(<Kbd keys={['mod', 'shift', 'alt', 'k']} />);
    expect(caps()).toEqual(['⌘', '⇧', '⌥', 'K']);
  });

  it('renders the words on the server for every platform, so a Mac hydrates without a mismatch', () => {
    onMac();
    const html = renderToString(<Kbd keys={['mod', 'k']} />);
    expect(html).toContain('Ctrl');
    expect(html).not.toContain('⌘');
  });

  it('renders one kbd element per key', () => {
    render(<Kbd keys={['shift', 'f10']} />);
    expect(caps()).toEqual(['Shift', 'F10']);
  });

  it('hides a single-key hint while single-key shortcuts are off', () => {
    render(
      <SingleKeyShortcutsContext value={false}>
        <Kbd keys={['/']} />
      </SingleKeyShortcutsContext>,
    );
    expect(caps()).toEqual([]);
  });

  it('keeps a combination, a named key and a function key while single-key shortcuts are off', () => {
    render(
      <SingleKeyShortcutsContext value={false}>
        <Kbd keys={['mod', 'k']} />
        <Kbd keys={['esc']} />
        <Kbd keys={['f2']} />
      </SingleKeyShortcutsContext>,
    );
    expect(caps()).toEqual(['Ctrl', 'K', 'Esc', 'F2']);
  });

  it('shows a single-key hint regardless of the setting when asked to', () => {
    render(
      <SingleKeyShortcutsContext value={false}>
        <Kbd keys={['/']} singleKey="always" />
      </SingleKeyShortcutsContext>,
    );
    expect(caps()).toEqual(['/']);
  });

  it('renders a sequence that repeats a key', () => {
    render(<Kbd keys={['g', 'g']} />);
    expect(caps()).toEqual(['G', 'G']);
  });

  it('is read as key names, not as glyphs: the caps are hidden and the names are spoken', () => {
    onMac();
    const { container } = render(<Kbd keys={['mod', 'shift', 'up']} />);
    expect(caps()).toEqual(['⌘', '⇧', '↑']);
    for (const cap of container.querySelectorAll('kbd')) expect(cap).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.sr-only')).toHaveTextContent('Command Shift Up arrow');
  });

  it('names the platform modifier Control off the Mac', () => {
    const { container } = render(<Kbd keys={['mod', 'k']} />);
    expect(container.querySelector('.sr-only')).toHaveTextContent('Control K');
  });

  it('is hidden from assistive technology inside an interactive element, which declares the shortcut itself', () => {
    render(
      <button type="button" aria-keyshortcuts="Control+k">
        Search <Kbd keys={['mod', 'k']} decorative />
      </button>,
    );
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="kbd"]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes other attributes on to its root', () => {
    render(<Kbd keys={['esc']} id="hint" className="ml-auto" />);
    const root = document.querySelector('[data-slot="kbd"]');
    expect(root).toHaveAttribute('id', 'hint');
    expect(root).toHaveClass('ml-auto', 'inline-flex');
  });

  it('renders nothing without keys', () => {
    const { container } = render(<Kbd keys={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <p>
        Press <Kbd keys={['mod', 'k']} /> to search.
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('useAriaKeyShortcuts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the keys the way aria-keyshortcuts expects', () => {
    expect(renderHook(() => useAriaKeyShortcuts(['mod', 'k'])).result.current).toBe('Control+k');
    expect(renderHook(() => useAriaKeyShortcuts(['shift', 'esc'])).result.current).toBe('Shift+Escape');
    expect(renderHook(() => useAriaKeyShortcuts(['/'])).result.current).toBe('/');
  });

  it.each([
    [['shift', 'f10'], 'Shift+F10'],
    [['home'], 'Home'],
    [['mod', 'pageup'], 'Control+PageUp'],
    [['alt', 'down'], 'Alt+ArrowDown'],
    [['mod', '+'], 'Control+Plus'],
    [['mod', 'enter'], 'Control+Enter'],
  ])('writes %j as %s', (keys, expected) => {
    expect(renderHook(() => useAriaKeyShortcuts(keys)).result.current).toBe(expected);
  });

  it.each([[['g', 'k']], [['g', 'g']], [['mod', 'shift']]])(
    'is undefined for %j, which the attribute cannot express',
    (keys) => {
      expect(renderHook(() => useAriaKeyShortcuts(keys)).result.current).toBeUndefined();
    },
  );

  it('uses Meta for the platform modifier on a Mac', () => {
    onMac();
    expect(renderHook(() => useAriaKeyShortcuts(['mod', 'k'])).result.current).toBe('Meta+k');
  });

  it('is undefined without a shortcut', () => {
    expect(renderHook(() => useAriaKeyShortcuts(undefined)).result.current).toBeUndefined();
    expect(renderHook(() => useAriaKeyShortcuts([])).result.current).toBeUndefined();
  });
});
