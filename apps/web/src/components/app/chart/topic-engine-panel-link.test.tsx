import { screen } from '@testing-library/react';
import type { Route } from 'next';
import type { ComponentProps, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TopicEnginePanel, type EnginePanelRow } from './topic-engine-panel';
import { renderWithProviders } from '@/test/render';

// The router's link does not say in the document whether it replaces or pushes: the stand-in does
vi.mock('next/link', () => ({
  default: ({ href, replace, children, ...props }: ComponentProps<'a'> & { replace?: boolean }): ReactElement => (
    <a href={String(href)} data-replace={replace === true ? 'true' : 'false'} {...props}>
      {children}
    </a>
  ),
}));

const row = (over: Partial<EnginePanelRow> = {}): EnginePanelRow => ({
  code: 'chatgpt_web',
  label: 'ChatGPT',
  state: 'ok',
  value: 0.375,
  valueText: '38%',
  contextText: '3 of 8 answers, 4 prompts',
  answers: 8,
  noneText: 'No answers',
  accessibleText: 'ChatGPT: 38%, 3 of 8 answers',
  href: '/ws/p/ai/prompts?inspect=topic:1&itab=prompts&eng=chatgpt_web' as Route,
  ...over,
});

const WORDS = {
  caption: 'Mention by engine',
  labelHeader: 'Engine',
  valueHeader: 'Mention',
  contextHeader: 'Answers',
} as const;

describe('TopicEnginePanel: how a row link moves the history', () => {
  it('pushes an entry by default, as a link to a list does', () => {
    renderWithProviders(<TopicEnginePanel {...WORDS} rows={[row()]} />);
    expect(screen.getByRole('link', { name: 'ChatGPT: 38%, 3 of 8 answers' })).toHaveAttribute('data-replace', 'false');
  });

  it('replaces the entry when the row says so, for a link that moves a drawer that is already open', () => {
    renderWithProviders(<TopicEnginePanel {...WORDS} rows={[row({ replace: true })]} />);
    expect(screen.getByRole('link', { name: 'ChatGPT: 38%, 3 of 8 answers' })).toHaveAttribute('data-replace', 'true');
  });
});
