import { readFileSync } from 'node:fs';
import path from 'node:path';

import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TokensSection } from './tokens-section';
import { CONTRAST_PAIRS } from './token-groups';
import { renderWithProviders } from '@/test/render';

// import.meta.url is an http URL under jsdom, so the file is found from the directory instead
const tokens = readFileSync(path.join(import.meta.dirname, '../../styles/tokens.css'), 'utf8');

/** Loads a stylesheet into the document, the way the app's stylesheet declares the tokens on `<html>`. */
function addStyles(text: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = text;
  document.head.append(style);
  return style;
}

const pairsTable = (): HTMLElement => screen.getByRole('table', { name: /paired tokens/ });
const matrix = (): HTMLElement => screen.getByRole('table', { name: /each text token on each surface/ });
const firstRatio = (): string => within(matrix()).getAllByRole('cell')[0]?.textContent ?? '';

describe('TokensSection with the real tokens', () => {
  beforeEach(() => {
    addStyles(tokens);
  });

  afterEach(() => {
    for (const style of document.head.querySelectorAll('style')) style.remove();
    document.documentElement.className = '';
  });

  it('shows the value of every swatch and a ratio in every cell', async () => {
    renderWithProviders(<TokensSection />);
    const surface = await screen.findByText('surface', { selector: 'span' });
    expect(surface.nextElementSibling?.textContent).toMatch(/^#[0-9A-F]{6}$/);
    expect(screen.queryByText('Not read yet')).not.toBeInTheDocument();
    expect(within(matrix()).queryByText('n/a')).not.toBeInTheDocument();
    expect(firstRatio()).toMatch(/^\d+\.\d{2}:1$/);
    expect(within(pairsTable()).getAllByText('Pass')).toHaveLength(CONTRAST_PAIRS.length);
  });

  it('reads the tokens again when the theme class changes', async () => {
    renderWithProviders(<TokensSection />);
    await waitFor(() => expect(firstRatio()).toMatch(/:1$/));
    const light = firstRatio();
    document.documentElement.classList.add('dark');
    await waitFor(() => expect(firstRatio()).not.toBe(light));
    expect(firstRatio()).toMatch(/^\d+\.\d{2}:1$/);
  });

  it('marks a pair that misses its ratio, in words as well as color', async () => {
    // The label color of the primary button, made the same as its fill. jsdom does not resolve var(), so the
    // light value of --primary is copied from tokens.css
    const primary = /--primary:\s*([^;]+);/.exec(tokens)?.[1];
    if (!primary) throw new Error('tokens.css declares no --primary');
    addStyles(`:root { --primary-foreground: ${primary}; }`);
    renderWithProviders(<TokensSection />);
    const row = (await within(pairsTable()).findByText('Primary button label')).closest('tr');
    if (!row) throw new Error('the row of the primary button label is missing');
    expect(within(row).getByText('Fail')).toBeInTheDocument();
    expect(within(row).getByText(/below the required 4.5:1/)).toBeInTheDocument();
  });
});

describe('TokensSection without a stylesheet', () => {
  it('says that nothing could be read instead of showing a ratio', () => {
    renderWithProviders(<TokensSection />);
    expect(screen.getAllByText('Not read yet').length).toBeGreaterThan(90);
    expect(within(pairsTable()).getAllByText('Not read')).toHaveLength(CONTRAST_PAIRS.length);
  });
});
