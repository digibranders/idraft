import { screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { projectEngine } from './compare/change-test-data';
import { PlatformSelect, platformChoice, withoutFullPlatformSet } from './engine-select';
import type { FilterValues } from '@/components/app/filters/types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const THREE = [projectEngine('google_ai_mode'), projectEngine('chatgpt_web'), projectEngine('gemini_web')];

function Harness({ initial = [] }: { initial?: readonly string[] }): ReactElement {
  const [chosen, setChosen] = useState<readonly string[]>(initial);
  return (
    <>
      <PlatformSelect engines={THREE} chosen={chosen} onChange={setChosen} />
      <output aria-label="filter">{chosen.join(',')}</output>
    </>
  );
}

describe('platformChoice', () => {
  const ON = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

  it('is all for none or every platform that is on, one for one, a set for two or more of three', () => {
    expect(platformChoice([], ON)).toBe('all');
    expect(platformChoice(ON, ON)).toBe('all');
    expect(platformChoice(['gemini_web'], ON)).toBe('gemini_web');
    expect(platformChoice(['gemini_web', 'chatgpt_web'], ON)).toBe('set');
  });

  it('counts a platform that is off for nothing', () => {
    expect(platformChoice(['perplexity_web'], ON)).toBe('all');
    expect(platformChoice(['perplexity_web', 'gemini_web'], ON)).toBe('gemini_web');
  });
});

describe('withoutFullPlatformSet', () => {
  const ON = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
  const filter = (codes: readonly string[]): FilterValues => ({
    engine: { kind: 'enum', values: codes },
    branded: { kind: 'enum', values: ['include'] },
  });

  it('drops the Platform filter when it names every platform that is on, and keeps the other filters', () => {
    expect(withoutFullPlatformSet(filter(ON), ON)).toEqual({ branded: { kind: 'enum', values: ['include'] } });
    expect(withoutFullPlatformSet(filter([...ON, 'perplexity_web']), ON)).not.toHaveProperty('engine');
  });

  it('keeps a set of two of three, one platform, and a filter while no platform is known', () => {
    const two = filter(['chatgpt_web', 'gemini_web']);
    expect(withoutFullPlatformSet(two, ON)).toBe(two);
    const one = filter(['gemini_web']);
    expect(withoutFullPlatformSet(one, ON)).toBe(one);
    expect(withoutFullPlatformSet(two, [])).toBe(two);
  });
});

describe('PlatformSelect', () => {
  it('is named Platform and lists All platforms, then the platforms in the product order, each with a mark', async () => {
    const { user } = renderWithProviders(<Harness />);
    const select = screen.getByRole('combobox', { name: 'Platform' });
    expect(select).toHaveTextContent('All platforms');
    await user.click(select);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'All platforms',
      'ChatGPT',
      'Gemini',
      'Google AI Mode',
    ]);
    expect(options.slice(1).every((option) => option.querySelector('img') !== null)).toBe(true);
  });

  it('chooses one platform, and All platforms again empties the filter', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.click(screen.getByRole('combobox', { name: 'Platform' }));
    await user.click(await screen.findByRole('option', { name: 'Google AI Mode' }));
    expect(screen.getByLabelText('filter')).toHaveTextContent('google_ai_mode');
    expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveTextContent('Google AI Mode');
    await user.click(screen.getByRole('combobox', { name: 'Platform' }));
    await user.click(await screen.findByRole('option', { name: 'All platforms' }));
    expect(screen.getByLabelText('filter')).toBeEmptyDOMElement();
  });

  it('shows a set of two as its count, and choosing the set again changes nothing', async () => {
    const { user } = renderWithProviders(<Harness initial={['chatgpt_web', 'gemini_web']} />);
    const select = screen.getByRole('combobox', { name: 'Platform' });
    expect(select).toHaveTextContent('2 platforms');
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: '2 platforms' }));
    expect(screen.getByLabelText('filter')).toHaveTextContent('chatgpt_web,gemini_web');
  });

  it('has no accessibility violation', async () => {
    const { container } = renderWithProviders(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
