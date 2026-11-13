import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ResponsePreview } from './response-preview';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

function show(props: Partial<Parameters<typeof ResponsePreview>[0]> = {}): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <ResponsePreview
      model="gpt-5"
      observedAt="2026-11-12T02:00:00Z"
      exact="Nov 12, 2026 02:00 UTC"
      relative="2 days ago"
      answerSha256={HASH}
      rawSha256={null}
      {...props}
    >
      <p>The answer text.</p>
    </ResponsePreview>,
  );
}

describe('ResponsePreview', () => {
  it('has the header line, the text and the slots in order', async () => {
    const { container } = show({
      notes: <p>A note.</p>,
      facts: (
        <ul aria-label="Facts">
          <li>Mentioned</li>
        </ul>
      ),
      sources: <p>Sources slot</p>,
      action: <button type="button">Open</button>,
    });
    const header = container.querySelector('p');
    expect(header).toHaveTextContent('gpt-5');
    expect(header).toHaveTextContent('2 days ago');
    expect(container.querySelector('time')).toHaveAttribute('dateTime', '2026-11-12T02:00:00Z');
    expect(container.querySelector('time')).toHaveAttribute('aria-label', 'Nov 12, 2026 02:00 UTC');
    const text = ['gpt-5', 'The answer text.', 'A note.', 'Mentioned', 'Sources slot', 'Answer SHA-256', 'Open'].map(
      (part) => container.textContent?.indexOf(part) ?? -1,
    );
    expect(text.every((at) => at >= 0)).toBe(true);
    expect([...text].sort((a, b) => a - b)).toEqual(text);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('leaves the model out of the header line when the engine did not name one', () => {
    const { container } = show({ model: null });
    expect(container.querySelector('p')).not.toHaveTextContent('gpt-5');
  });

  it('shows one type-meta line per hash it has, the first 12 characters with a copy button, and none for a null hash', () => {
    show({ rawSha256: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0' });
    const answer = screen.getByText('Answer SHA-256').closest('p');
    expect(answer).toHaveClass('type-meta');
    expect(answer).toHaveTextContent('Answer SHA-256 a1b2c3d4e5f6');
    expect(
      within(answer as HTMLElement).getByRole('button', { name: 'Copy the full answer SHA-256' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Raw SHA-256').closest('p')).toHaveTextContent('Raw SHA-256 0f1e2d3c4b5a');
  });

  it('shows no hash line, and never a zero hash, when both are null or missing', () => {
    const { container } = show({ answerSha256: null, rawSha256: undefined });
    expect(screen.queryByText('Answer SHA-256')).toBeNull();
    expect(screen.queryByText('Raw SHA-256')).toBeNull();
    expect(container.textContent).not.toMatch(/0{12}/);
  });

  it('keeps the action reachable and calls it once', async () => {
    const onOpen = vi.fn<() => void>();
    const { user } = show({
      action: (
        <button type="button" onClick={onOpen}>
          Open evidence
        </button>
      ),
    });
    await user.click(screen.getByRole('button', { name: 'Open evidence' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
