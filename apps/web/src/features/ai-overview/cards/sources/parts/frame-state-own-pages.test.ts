import { createTranslator } from 'next-intl';
import type { Route } from 'next';
import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { mapReadToFrame, type FrameContext, type FrameInput, type FrameWords } from './frame-state';
import messages from '../../../../../../messages/en.json';
import { drillHref } from '../../../drilldown/drill-links';
import { scopeOf } from '../model/source-fixtures';
import type { Say } from '../../../numbers/number-model';

const translator = (namespace: string): Say => {
  const translate = createTranslator({ locale: 'en', messages, namespace: namespace as never });
  return (key, values) => translate(key as never, values as never);
};
const status = translator('status.error');

const words: FrameWords = {
  say: translator('aiOverview.sources.common'),
  errorId: (id) => status('errorId', { id }),
  copyErrorId: status('copyErrorId'),
  copied: status('copied'),
  retry: 'Try again',
};

const context = (patch: Partial<FrameContext> = {}): FrameContext => ({
  enginesHref: '/acme/fynix/settings/engines' as Route,
  canManageEngines: true,
  days: 28,
  minUnits: 2,
  ...patch,
});

const input: FrameInput = {
  subject: 'your pages',
  read: { status: 'ready', errorId: null, stale: false, refetch: () => undefined },
  previous: null,
  previousEmpty: false,
  situation: { kind: 'no_own_pages' },
};

describe('mapReadToFrame with no own page cited', () => {
  it('says no answer cited your pages, and why, with a link to Prompts when there is one', () => {
    const state = mapReadToFrame(input, words, context({ promptsHref: '/acme/fynix/prompts' as Route }));
    if (state.status !== 'empty') throw new Error('expected an empty state');
    expect(state.empty.title).toBe('No answer cited your pages in this window');
    expect(state.empty.reason).toContain('named');
    expect(isValidElement(state.empty.action)).toBe(true);
  });

  it('links the Prompts page with the scope and no outcome or opportunity filter, which that page does not read yet', () => {
    const promptsHref = drillHref('prompts', scopeOf(), {}, { workspace: 'acme', project: 'fynix' });
    const state = mapReadToFrame(input, words, context({ promptsHref }));
    if (state.status !== 'empty' || !isValidElement(state.empty.action)) throw new Error('expected a link');
    const render = (state.empty.action.props as { render: ReactElement<{ href: string }> }).render;
    const query = new URL(render.props.href, 'http://localhost').searchParams;
    expect(new URL(render.props.href, 'http://localhost').pathname).toBe('/acme/fynix/ai/prompts');
    expect(query.has('outcome')).toBe(false);
    expect(query.has('opportunity')).toBe(false);
  });

  it('has no action where the Prompts page cannot show the scope', () => {
    for (const promptsHref of [null, undefined]) {
      const state = mapReadToFrame(input, words, context({ promptsHref }));
      if (state.status !== 'empty') throw new Error('expected an empty state');
      expect(state.empty.action).toBeUndefined();
    }
  });

  it('still shows a skeleton while the read loads, and an error when it failed', () => {
    const loading = mapReadToFrame({ ...input, read: { ...input.read, status: 'loading' } }, words, context());
    expect(loading.status).toBe('loading');
    const failed = mapReadToFrame(
      { ...input, read: { ...input.read, status: 'error', errorId: 'r1' } },
      words,
      context(),
    );
    expect(failed.status).toBe('error');
  });
});
