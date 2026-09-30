import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Avatar, initialsOf } from './avatar';
import { axe } from '@/test/axe';

describe('initialsOf', () => {
  it.each([
    ['Ana Brandt', 'AB'],
    ['Tomás de la Rivera', 'TR'],
    ['priya', 'P'],
    ['  Lin   Wei  ', 'LW'],
    ['Émile Zola', 'ÉZ'],
    ['', ''],
  ])('%s gives %s', (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });

  it('takes a whole character, not half of an emoji or a surrogate pair', () => {
    expect(initialsOf('𝒜da Lovelace')).toBe('𝒜L');
  });
});

/** jsdom never loads an image, so the browser's `Image` is replaced by one the test settles by hand. */
function controlledImage(): { load: () => void; fail: () => void } {
  const pending: { onload: (() => void) | null; onerror: (() => void) | null }[] = [];
  class ControlledImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin: string | null = null;
    src = '';
    complete = false;
    naturalWidth = 0;
    constructor() {
      pending.push(this);
    }
  }
  vi.stubGlobal('Image', ControlledImage);
  return {
    load: () => act(() => pending.forEach((image) => image.onload?.())),
    fail: () => act(() => pending.forEach((image) => image.onerror?.())),
  };
}

describe('Avatar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the initials when there is no photo', () => {
    const { container } = render(<Avatar name="Ana Brandt" />);
    expect(container).toHaveTextContent('AB');
    expect(container.querySelector('img')).toBeNull();
  });

  it('is decoration: the name is always beside it', () => {
    const { container } = render(<Avatar name="Ana Brandt" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('is a 32 px circle by default and 20 px with one initial when small', () => {
    const medium = render(<Avatar name="Ana Brandt" />).container;
    expect(medium.firstElementChild).toHaveClass('size-avatar', 'rounded-full', 'bg-neutral-subtle', 'type-micro');
    const small = render(<Avatar name="Ana Brandt" size="sm" />).container;
    expect(small.firstElementChild).toHaveClass('size-5');
    expect(small).toHaveTextContent('A');
    expect(small).not.toHaveTextContent('AB');
  });

  it('keeps the initials until the photo has loaded, then shows the photo without a text alternative', () => {
    const image = controlledImage();
    const { container } = render(<Avatar name="Ana Brandt" imageUrl="https://example.com/ana.png" />);
    expect(container).toHaveTextContent('AB');
    expect(container.querySelector('img')).toBeNull();
    image.load();
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/ana.png');
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(container).not.toHaveTextContent('AB');
  });

  it('stays on the initials when the photo fails to load, so a broken image never shows', () => {
    const image = controlledImage();
    const { container } = render(<Avatar name="Ana Brandt" imageUrl="https://example.com/missing.png" />);
    image.fail();
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('AB');
  });

  it('treats a null photo as no photo', () => {
    const { container } = render(<Avatar name="Ana Brandt" imageUrl={null} />);
    expect(container).toHaveTextContent('AB');
  });

  it('passes other attributes on to its root', () => {
    const { container } = render(<Avatar name="Ana Brandt" id="owner" className="ml-auto" />);
    expect(container.firstElementChild).toHaveAttribute('id', 'owner');
    expect(container.firstElementChild).toHaveClass('ml-auto', 'size-avatar');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <p>
        <Avatar name="Ana Brandt" /> Ana Brandt
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
