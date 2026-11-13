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
  subject: 'source diversity over time',
  read: { status: 'ready', errorId: null, stale: false, refetch: () => undefined },
  previous: null,
  previousEmpty: false,
  situation: { kind: 'ready' },
  ...patch,
});

describe('mapReadToFrame for the source diversity card', () => {
  it('says no week holds a citation unit, with a reason and no zero', () => {
    const state = mapReadToFrame(input({ situation: { kind: 'no_weekly_units' } }), words, context);
    if (state.status !== 'empty') throw new Error('expected an empty state');
    expect(state.empty.title).toBe('No source was cited in any week of this window');
    expect(state.empty.reason).toContain('Diversity is not drawn for a week without a citation unit');
  });

  it('keeps the loading state before it says anything about the weeks', () => {
    const state = mapReadToFrame(
      input({
        read: { status: 'loading', errorId: null, stale: false, refetch: () => undefined },
        situation: { kind: 'no_weekly_units' },
      }),
      words,
      context,
    );
    expect(state.status).toBe('loading');
  });
});
