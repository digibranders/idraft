import { screen } from '@testing-library/react';
import type { ComponentProps, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EnginePanel } from './engine-panel';
import { cell, engine, topicRow } from '@/features/prompts/topics-by-engine/cells-fixtures';
import { DRAWER_TOPIC_ID, renderDrawerPart, summaryOf } from '@/test/topic-drawer-harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

// The router's link does not say in the document whether it replaces or pushes: the stand-in does
vi.mock('next/link', () => ({
  default: ({ href, replace, children, ...props }: ComponentProps<'a'> & { replace?: boolean }): ReactElement => (
    <a href={String(href)} data-replace={replace === true ? 'true' : 'false'} {...props}>
      {children}
    </a>
  ),
}));

describe('EnginePanel: the engine rows move the open drawer', () => {
  it('replaces the history entry: the drawer is already open, so Close must still take it away in one step', () => {
    const summary = summaryOf([
      topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4, [
        engine('chatgpt_web', { mentioned: { ...cell(3, 8), pooled: { successes: 3, trials: 8 } } }),
        engine('gemini_web', { mentioned: { ...cell(4, 8), pooled: { successes: 4, trials: 8 } } }),
      ]),
    ]);
    renderDrawerPart(<EnginePanel />, { summary });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('data-replace', 'true');
  });
});
