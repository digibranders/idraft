import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EngineLogo } from './engine-logo';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const ENGINES = [
  { engine: 'chatgpt_web', name: 'ChatGPT' },
  { engine: 'gemini_web', name: 'Gemini' },
  { engine: 'google_ai_mode', name: 'Google AI Mode' },
  { engine: 'google_ai_overview', name: 'Google AI Overview' },
] as const;

describe('EngineLogo', () => {
  it.each(ENGINES)('logos have accessible names: $engine', ({ engine, name }) => {
    renderWithProviders(
      <button type="button">
        <EngineLogo engine={engine} name={name} />
      </button>,
    );
    const image = screen.getByRole('presentation');
    expect(image).toHaveAttribute('alt', '');
    expect(screen.getByText(name)).toBeVisible();
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('shows the name alone for an engine without a mark, and when hidden', () => {
    const { rerender } = renderWithProviders(<EngineLogo engine="perplexity_web" name="Perplexity" />);
    expect(screen.getByText('Perplexity')).toBeInTheDocument();
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
    rerender(<EngineLogo engine="chatgpt_web" name="ChatGPT" hidden />);
    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
  });

  it('gives the mark a fixed 16 px box', () => {
    renderWithProviders(<EngineLogo engine="gemini_web" name="Gemini" />);
    const image = screen.getByRole('presentation');
    expect(image).toHaveAttribute('width', '16');
    expect(image).toHaveAttribute('height', '16');
    expect(image).toHaveClass('size-icon', 'shrink-0');
  });

  it('lets the OpenAI mark follow the text colour', () => {
    renderWithProviders(
      <>
        {ENGINES.map(({ engine, name }) => (
          <EngineLogo key={engine} engine={engine} name={name} />
        ))}
      </>,
    );
    const inverted = screen.getAllByRole('presentation').filter((image) => image.classList.contains('dark:invert'));
    expect(inverted).toHaveLength(1);
    expect(inverted[0]?.parentElement).toHaveTextContent('ChatGPT');
  });

  it('uses the Google mark for AI Mode and AI Overview', () => {
    renderWithProviders(
      <>
        <EngineLogo engine="google_ai_mode" name="Google AI Mode" />
        <EngineLogo engine="google_ai_overview" name="Google AI Overview" />
        <EngineLogo engine="gemini_web" name="Gemini" />
      </>,
    );
    const [mode, overview, gemini] = screen.getAllByRole('presentation');
    expect(mode?.getAttribute('src')).toBeTruthy();
    expect(mode?.getAttribute('src')).toBe(overview?.getAttribute('src'));
    expect(mode?.getAttribute('src')).not.toBe(gemini?.getAttribute('src'));
  });

  it('truncates the name when asked, without losing the full text', () => {
    renderWithProviders(<EngineLogo engine="chatgpt_web" name="ChatGPT" truncate />);
    expect(screen.getByText('ChatGPT')).toHaveAttribute('data-truncate');
  });

  it('is axe clean in a list of four engines', async () => {
    const { container } = renderWithProviders(
      <ul>
        {ENGINES.map(({ engine, name }) => (
          <li key={engine}>
            <EngineLogo engine={engine} name={name} />
          </li>
        ))}
      </ul>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
