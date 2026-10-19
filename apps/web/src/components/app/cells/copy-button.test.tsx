import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopyButton } from './copy-button';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const writeText = vi.fn<(text: string) => Promise<void>>();
const execCommand = vi.fn<(commandId: string) => boolean>();

const NAME = 'Copy keyword seo agency';
const button = (): HTMLElement => screen.getByRole('button', { name: NAME });
const copiedButton = (): HTMLElement => screen.getByRole('button', { name: 'Copied' });
const polite = (): HTMLElement | null => document.getElementById('live-region-polite');
const glyph = (element: HTMLElement): string | null => element.querySelector('svg')?.getAttribute('class') ?? null;

/** A click, and the promise of the copy settled. */
async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

function stubClipboard(clipboard: { writeText: typeof writeText } | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  execCommand.mockReset();
  execCommand.mockReset();
  execCommand.mockReturnValue(false);
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
});

/** Rendered, and then given the clipboard: rendering sets up user-event, which installs a clipboard of its own. */
function renderButton(text = 'seo agency'): ReturnType<typeof renderWithProviders> {
  const view = renderWithProviders(<CopyButton text={text} label={NAME} announcement="Keyword copied" />);
  stubClipboard({ writeText });
  return view;
}

describe('CopyButton', () => {
  it('is a button named for what it copies, with a Copy glyph, outside the tab order and marked for the table', () => {
    renderButton();
    expect(button()).toHaveAttribute('tabindex', '-1');
    expect(button()).toHaveAttribute('data-cell-control');
    expect(glyph(button())).toContain('lucide-copy');
    button().focus();
    expect(button()).toHaveFocus();
  });

  it('copies exactly the text it was given, quotes, line breaks and parameters included', async () => {
    const text = 'say "hi"\nthen\tgo https://fynix.digital/a?utm_source=x&b=1#frag';
    renderButton(text);
    await click(button());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
  });

  it('shows a check for 2 seconds, then the Copy glyph again, and says it was copied', async () => {
    renderButton();
    await click(button());
    expect(glyph(copiedButton())).toContain('lucide-check');
    expect(polite()).toHaveTextContent('Keyword copied');
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(glyph(copiedButton())).toContain('lucide-check');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(glyph(button())).toContain('lucide-copy');
  });

  it('keeps focus on the button after a copy', async () => {
    renderButton();
    button().focus();
    await click(button());
    expect(copiedButton()).toHaveFocus();
  });

  it('starts the 2 seconds again on a repeated click', async () => {
    renderButton();
    await click(button());
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await click(copiedButton());
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(glyph(copiedButton())).toContain('lucide-check');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(glyph(button())).toContain('lucide-copy');
  });

  it('leaves no timer behind when it goes while showing the check', async () => {
    const { unmount } = renderButton();
    await click(button());
    // The announcer empties its region after a second; what is left after that is this button's
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tries the selection fallback when the Clipboard API rejects, and stays quiet when that copies', async () => {
    writeText.mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    execCommand.mockReturnValue(true);
    renderButton();
    await click(button());
    expect(writeText).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy');
    expect(glyph(copiedButton())).toContain('lucide-check');
    expect(screen.queryByText(/Could not copy/)).toBeNull();
  });

  it('shows an error toast, and no check, when the Clipboard API and the fallback both fail', async () => {
    writeText.mockRejectedValue(new DOMException('no', 'NotAllowedError'));
    renderButton();
    await click(button());
    expect(execCommand).toHaveBeenCalledOnce();
    // The wait for the toast polls on timers of its own
    vi.useRealTimers();
    // The toast says it once on screen and once more for a screen reader
    expect(
      (await screen.findAllByText('Could not copy. Select the text and copy it yourself.')).length,
    ).toBeGreaterThan(0);
    expect(glyph(button())).toContain('lucide-copy');
    expect(polite()).not.toHaveTextContent('Keyword copied');
  });

  it('uses the fallback when there is no Clipboard API', async () => {
    execCommand.mockReturnValue(true);
    renderButton();
    stubClipboard(undefined);
    await click(button());
    expect(execCommand).toHaveBeenCalledOnce();
    expect(glyph(copiedButton())).toContain('lucide-check');
  });

  it('keeps the click to itself: a row around it neither sees a click nor a middle click', async () => {
    const onClick = vi.fn();
    const onAuxClick = vi.fn();
    renderWithProviders(
      // The wrapper stands for a table row, which opens its record on a click
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div onClick={onClick} onAuxClick={onAuxClick}>
        <CopyButton text="x" label={NAME} announcement="Keyword copied" />
      </div>,
    );
    stubClipboard({ writeText });
    const named = button();
    await click(named);
    fireEvent(named, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(onClick).not.toHaveBeenCalled();
    expect(onAuxClick).not.toHaveBeenCalled();
  });

  it('is hidden by opacity alone, so it is still there for the keyboard and a screen reader, and shows on hover, focus and touch', () => {
    renderButton();
    const wrapper = button().parentElement;
    expect(wrapper).toHaveClass(
      'opacity-0',
      'group-hover:opacity-100',
      'group-focus-within/cell:opacity-100',
      'pointer-coarse:opacity-100',
      'data-copied:opacity-100',
    );
    expect(wrapper).not.toHaveClass('hidden', 'invisible');
  });

  it('stays visible while it shows the check, even when the pointer has left the row', async () => {
    renderButton();
    expect(button().parentElement).not.toHaveAttribute('data-copied');
    await click(button());
    expect(copiedButton().parentElement).toHaveAttribute('data-copied');
  });

  it('is laid over the end of the cell, or beside the content, as asked', () => {
    const { rerender } = renderWithProviders(<CopyButton text="x" label={NAME} announcement="Copied it" />);
    expect(button().parentElement).toHaveClass('absolute', 'right-0', 'bg-inherit');
    rerender(<CopyButton text="x" label={NAME} announcement="Copied it" placement="inline" />);
    expect(button().parentElement).toHaveClass('shrink-0');
    expect(button().parentElement).not.toHaveClass('absolute');
  });

  it('passes the accessibility check, and so does the confirmation', async () => {
    // axe waits on timers of its own
    vi.useRealTimers();
    const { container } = renderButton();
    expect(await axe(container)).toHaveNoViolations();
    await click(button());
    expect(await axe(container)).toHaveNoViolations();
  });
});
