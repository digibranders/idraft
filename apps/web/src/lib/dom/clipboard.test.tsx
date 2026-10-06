import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyText } from './clipboard';

const execCommand = vi.fn<(commandId: string) => boolean>();

/** What the temporary field held when the browser was asked to copy it. */
let copied: { value: string; focused: boolean; readOnly: boolean } | null = null;

function stubClipboard(writeText: ((text: string) => Promise<void>) | null): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText === null ? undefined : { writeText },
    configurable: true,
  });
}

beforeEach(() => {
  copied = null;
  execCommand.mockReset();
  execCommand.mockImplementation(() => {
    const field = document.querySelector('textarea');
    copied =
      field === null
        ? null
        : { value: field.value, focused: document.activeElement === field, readOnly: field.readOnly };
    return true;
  });
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
  document.body.replaceChildren();
});

describe('copyText', () => {
  it('writes the text through the Clipboard API, exactly as it is, and does not touch the document', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const text = 'say "hello"\nand\tgo?utm_source=a&b=1#part';
    await expect(copyText(text)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
    expect(execCommand).not.toHaveBeenCalled();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('tries the selection fallback first when the Clipboard API rejects, and gives focus back', async () => {
    stubClipboard(
      vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new DOMException('no', 'NotAllowedError')),
    );
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    await expect(copyText('line one\nline "two"')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy');
    expect(copied).toEqual({ value: 'line one\nline "two"', focused: true, readOnly: true });
    expect(document.querySelector('textarea')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('puts the temporary field beside the focused element, so focus stays in the same part of the page', async () => {
    stubClipboard(null);
    const cell = document.createElement('td');
    const button = document.createElement('button');
    cell.append(button);
    document.body.append(cell);
    button.focus();
    let parent: Element | null = null;
    execCommand.mockImplementationOnce(() => {
      parent = document.querySelector('textarea')?.parentElement ?? null;
      return true;
    });
    await expect(copyText('https://fynix.digital/blog')).resolves.toBe(true);
    expect(parent).toBe(cell);
    expect(cell.querySelector('textarea')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('uses the page body for the field when nothing has focus', async () => {
    stubClipboard(null);
    let parent: Element | null = null;
    execCommand.mockImplementationOnce(() => {
      parent = document.querySelector('textarea')?.parentElement ?? null;
      return true;
    });
    await expect(copyText('/pricing')).resolves.toBe(true);
    expect(parent).toBe(document.body);
  });

  it('uses the fallback when there is no Clipboard API at all', async () => {
    stubClipboard(null);
    await expect(copyText('/pricing')).resolves.toBe(true);
    expect(copied?.value).toBe('/pricing');
  });

  it('reports a failure when the fallback fails too, or throws, and still cleans up', async () => {
    stubClipboard(null);
    execCommand.mockReturnValueOnce(false);
    await expect(copyText('a')).resolves.toBe(false);
    execCommand.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    await expect(copyText('b')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('puts the selection back where it was', async () => {
    stubClipboard(null);
    const paragraph = document.createElement('p');
    paragraph.textContent = 'some selected text';
    document.body.append(paragraph);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    await copyText('x');
    expect(window.getSelection()?.toString()).toBe('some selected text');
  });
});
