import { createTranslator } from 'next-intl';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { mapReadToFrame, type FrameContext, type FrameInput, type FrameWords } from './frame-state';
import messages from '../../../../../../messages/en.json';
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

const context: FrameContext = {
  enginesHref: '/acme/fynix/settings/engines' as Route,
  canManageEngines: true,
  days: 28,
  minUnits: 2,
};

const input = (patch: Partial<FrameInput>): FrameInput => ({
  subject: 'what ChatGPT searched',
  read: { status: 'ready', errorId: null, stale: false, refetch: () => undefined },
  previous: null,
  previousEmpty: false,
  situation: { kind: 'ready' },
  ...patch,
});

describe('mapReadToFrame for the fan-out card', () => {
  it('says which engines do not show their queries, and is empty before anything is read', () => {
    const state = mapReadToFrame(
      input({
        read: { status: 'idle', errorId: null, stale: false, refetch: () => undefined },
        situation: { kind: 'no_fanout', engines: 'Gemini and AI Mode' },
      }),
      words,
      context,
    );
    if (state.status !== 'empty') throw new Error('expected an empty state');
    expect(state.empty.title).toBe('Fan-out is not exposed by Gemini and AI Mode');
    expect(state.empty.reason).toContain('do not show the searches they run');
  });

  it('says the same when the read came back with every engine in scope without fan-out', () => {
    const state = mapReadToFrame(input({ situation: { kind: 'no_fanout', engines: 'Gemini' } }), words, context);
    expect(state.status).toBe('empty');
  });

  it('says no answer ran a search, with the answers collected', () => {
    const state = mapReadToFrame(input({ situation: { kind: 'none_issued', answers: 40 } }), words, context);
    if (state.status !== 'empty') throw new Error('expected an empty state');
    expect(state.empty.title).toBe('No answer ran a search in this window');
    expect(state.empty.reason).toContain('40 answers were collected');
  });

  it('says no query reaches the minimum', () => {
    const state = mapReadToFrame(input({ situation: { kind: 'queries_under_min', min: 3 } }), words, context);
    if (state.status !== 'empty') throw new Error('expected an empty state');
    expect(state.empty.title).toBe('No search was run by 3 or more answers');
  });

  it('keeps the skeleton while a read of a scope that can be asked loads, and the error of a failed one', () => {
    const loading = mapReadToFrame(
      input({
        read: { status: 'loading', errorId: null, stale: false, refetch: () => undefined },
        situation: { kind: 'none_issued', answers: 1 },
      }),
      words,
      context,
    );
    expect(loading.status).toBe('loading');
    const failed = mapReadToFrame(
      input({ read: { status: 'error', errorId: 'r1', stale: false, refetch: () => undefined } }),
      words,
      context,
    );
    expect(failed.status).toBe('error');
  });
});
