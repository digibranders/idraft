import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FactsFooter, shortHash, type FactsFooterFacts } from './facts-footer';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const ANSWER_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const RAW_HASH = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';

const FACTS: FactsFooterFacts = {
  ownMentioned: true,
  ownDomainCited: false,
  ownMentionOrder: 2,
  ownProminence: 0.5,
  ownCitationCount: 0,
  totalCitationCount: 7,
  derivationId: 41,
};

const writeText = vi.fn<(text: string) => Promise<void>>();
beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
});
afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

/** The value beside a label of the footer's list. */
const valueOf = (label: string): HTMLElement => {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`No value beside ${label}`);
  return value;
};

describe('shortHash', () => {
  it('keeps the first 12 characters', () => {
    expect(shortHash(ANSWER_HASH)).toBe('a1b2c3d4e5f6');
  });
});

describe('FactsFooter', () => {
  it('is a description list of the facts the API gives, with counts and the derivation', async () => {
    const { container } = renderWithProviders(
      <FactsFooter facts={FACTS} answerSha256={ANSWER_HASH} rawSha256={RAW_HASH} />,
    );
    expect(container.querySelector('dl')).toHaveAttribute('aria-label', 'Extracted facts');
    expect(valueOf('Names the brand')).toHaveTextContent('Yes');
    expect(valueOf('Cites the brand’s domain')).toHaveTextContent('No');
    expect(valueOf('Order among the brands named')).toHaveTextContent('2');
    expect(valueOf('Prominence')).toHaveTextContent('0.500');
    expect(valueOf('Sources on the brand’s domain')).toHaveTextContent('0');
    expect(valueOf('Sources cited in all')).toHaveTextContent('7');
    expect(valueOf('Derivation')).toHaveTextContent('41');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows n/a, never 0, for every fact it does not know', () => {
    renderWithProviders(<FactsFooter facts={null} answerSha256={null} rawSha256={null} />);
    for (const label of [
      'Names the brand',
      'Cites the brand’s domain',
      'Order among the brands named',
      'Prominence',
      'Sources on the brand’s domain',
      'Sources cited in all',
      'Derivation',
    ]) {
      expect(valueOf(label)).toHaveTextContent(/^n\/a$/);
    }
  });

  it('shows n/a for an order and a prominence the answer has none of, and a real 0 as 0', () => {
    renderWithProviders(
      <FactsFooter
        facts={{ ...FACTS, ownMentioned: false, ownMentionOrder: null, ownProminence: null }}
        answerSha256={null}
        rawSha256={null}
      />,
    );
    expect(valueOf('Order among the brands named')).toHaveTextContent(/^n\/a$/);
    expect(valueOf('Prominence')).toHaveTextContent(/^n\/a$/);
    expect(valueOf('Sources on the brand’s domain')).toHaveTextContent(/^0$/);
  });

  it('shows the first 12 characters of each hash and copies the full value', async () => {
    const { user } = renderWithProviders(<FactsFooter facts={FACTS} answerSha256={ANSWER_HASH} rawSha256={RAW_HASH} />);
    // The user-event setup brings its own clipboard, so the stub goes in after it
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(valueOf('Answer SHA-256')).toHaveTextContent('a1b2c3d4e5f6');
    expect(valueOf('Answer SHA-256')).not.toHaveTextContent(ANSWER_HASH);
    expect(valueOf('Raw SHA-256')).toHaveTextContent('0f1e2d3c4b5a');
    await user.click(within(valueOf('Answer SHA-256')).getByRole('button', { name: 'Copy the full answer SHA-256' }));
    await act(async () => Promise.resolve());
    expect(writeText).toHaveBeenLastCalledWith(ANSWER_HASH);
    await user.click(within(valueOf('Raw SHA-256')).getByRole('button', { name: 'Copy the full raw SHA-256' }));
    await act(async () => Promise.resolve());
    expect(writeText).toHaveBeenLastCalledWith(RAW_HASH);
  });

  it('has no answer line, and never a zero hash, when only the answer hash is null', () => {
    const { container } = renderWithProviders(<FactsFooter facts={FACTS} answerSha256={null} rawSha256={RAW_HASH} />);
    expect(screen.queryByText('Answer SHA-256')).toBeNull();
    expect(screen.getByText('Raw SHA-256')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/0{12}/);
  });

  it('announces a copy politely, by the name of the hash that was copied', async () => {
    const { user } = renderWithProviders(<FactsFooter facts={FACTS} answerSha256={ANSWER_HASH} rawSha256={RAW_HASH} />);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const live = (): string => document.getElementById('live-region-polite')?.textContent ?? '';
    await user.click(within(valueOf('Answer SHA-256')).getByRole('button', { name: 'Copy the full answer SHA-256' }));
    await act(async () => Promise.resolve());
    expect(live()).toContain('Answer SHA-256 copied');
    await user.click(within(valueOf('Raw SHA-256')).getByRole('button', { name: 'Copy the full raw SHA-256' }));
    await act(async () => Promise.resolve());
    expect(live()).toContain('Raw SHA-256 copied');
  });

  it('has no line for a hash that is null or missing, and never a zero hash', () => {
    const { container } = renderWithProviders(
      <FactsFooter facts={FACTS} answerSha256={ANSWER_HASH} rawSha256={null} />,
    );
    expect(screen.queryByText('Raw SHA-256')).toBeNull();
    expect(screen.getByText('Answer SHA-256')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/0{12}/);
  });
});
