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

  it('writes the Prompts tab and the engine through the inspector on a plain click', async () => {
    const summary = summaryOf([
      topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4, [
        engine('chatgpt_web', { mentioned: { ...cell(3, 8), pooled: { successes: 3, trials: 8 } } }),
        engine('gemini_web', { mentioned: { ...cell(4, 8), pooled: { successes: 4, trials: 8 } } }),
      ]),
    ]);
    const writes: URLSearchParams[] = [];
    const { user } = renderDrawerPart(<EnginePanel />, {
      summary,
      searchParams: `?inspect=topic%3A${DRAWER_TOPIC_ID}`,
      onUrlUpdate: ({ searchParams }) => writes.push(new URLSearchParams(searchParams)),
    });
    const [chatgpt] = screen.getAllByRole('link');
    if (chatgpt === undefined) throw new Error('No engine row');
    // The router's own navigation changed the address and left the open drawer on Overview: the click does not use it
    // Read on the document, which the click reaches after the row's own handler has run
    let followed = true;
    const watch = (event: Event): void => {
      followed = !event.defaultPrevented;
    };
    document.addEventListener('click', watch);
    await user.click(chatgpt);
    document.removeEventListener('click', watch);
    expect(followed).toBe(false);
    const last = writes.at(-1);
    expect(last?.get('itab')).toBe('prompts');
    expect(last?.get('eng')).toBe('chatgpt_web');
    expect(last?.get('inspect')).toBe(`topic:${DRAWER_TOPIC_ID}`);
  });
});
