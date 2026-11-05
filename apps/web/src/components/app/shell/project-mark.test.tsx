import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProjectMark } from './project-mark';

/** jsdom loads no images, so a test says how wide the one it "loaded" is. */
function loaded(image: HTMLElement, width: number): void {
  Object.defineProperty(image, 'naturalWidth', { value: width, configurable: true });
  fireEvent.load(image);
}

const icon = (container: HTMLElement): HTMLImageElement => {
  const image = container.querySelector('img');
  if (image === null) throw new Error('no icon requested');
  return image;
};

describe('ProjectMark', () => {
  it('is the first letter of the name where the project has no domain, and requests nothing', () => {
    const { container } = render(<ProjectMark name="  eventus Security" />);
    expect(container).toHaveTextContent('E');
    expect(container.querySelector('img')).toBeNull();
  });

  it('asks the favicon service for the domain, with no referrer, and shows the letter until it arrives', () => {
    const { container } = render(<ProjectMark name="Eventus" domain="eventussecurity.com" />);
    const image = icon(container);
    expect(image).toHaveAttribute('src', 'https://www.google.com/s2/favicons?domain=eventussecurity.com&sz=64');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).toHaveAttribute('alt', '');
    expect(container).toHaveTextContent('E');
    expect(image.parentElement).toHaveClass('hidden');
  });

  it('shows the icon and drops the letter once a real icon has loaded', () => {
    const { container } = render(<ProjectMark name="Eventus" domain="eventussecurity.com" />);
    loaded(icon(container), 64);
    expect(container).not.toHaveTextContent('E');
    expect(icon(container).parentElement).toHaveClass('flex');
  });

  it('keeps the letter where the service sent its 16 px placeholder instead of an icon', () => {
    const { container } = render(<ProjectMark name="Idraft" domain="idraft.ai" />);
    loaded(icon(container), 16);
    expect(container).toHaveTextContent('I');
    expect(icon(container).parentElement).toHaveClass('hidden');
  });

  it('keeps the letter when the icon cannot be loaded', () => {
    const { container } = render(<ProjectMark name="Fynix" domain="fynix.com" />);
    fireEvent.error(icon(container));
    expect(container).toHaveTextContent('F');
    expect(icon(container).parentElement).toHaveClass('hidden');
  });

  it('starts again from the letter when the domain changes', () => {
    const { container, rerender } = render(<ProjectMark name="Eventus" domain="eventussecurity.com" />);
    loaded(icon(container), 64);
    rerender(<ProjectMark name="Eventus" domain="other.com" />);
    expect(container).toHaveTextContent('E');
    expect(icon(container)).toHaveAttribute('src', expect.stringContaining('domain=other.com'));
  });
});
