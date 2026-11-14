import { createTranslator } from 'next-intl';
import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CardEngine } from './card-engine';
import {
  frameSummary,
  mapReadToFrame,
  type DataSituation,
  type FrameContext,
  type FrameInput,
  type FrameWords,
  type ReadFacts,
} from './frame-state';
import messages from '../../../../../../messages/en.json';
import type { Say } from '../../../numbers/number-model';
import type { Route } from 'next';

const translator = (namespace: string): Say => {
  const translate = createTranslator({ locale: 'en', messages, namespace: namespace as never });
  return (key, values) => translate(key as never, values as never);
};
const status = translator('status.error');
const common = translator('common');

const words: FrameWords = {
  say: translator('aiOverview.competitors.common'),
  errorId: (id) => status('errorId', { id }),
  copyErrorId: status('copyErrorId'),
  copied: status('copied'),
  retry: common('retry'),
};

const context = (patch: Partial<FrameContext> = {}): FrameContext => ({
  enginesHref: '/acme/fynix/settings/engines' as Route,
  entitiesHref: '/acme/fynix/settings/entities' as Route,
  canManageEngines: true,
  canEditEntities: true,
  days: 28,
  ...patch,
});

const read = (patch: Partial<ReadFacts> = {}): ReadFacts => ({
  status: 'ready',
  errorId: null,
  stale: false,
  refetch: () => undefined,
  ...patch,
});

const asked: CardEngine = {
  code: 'chatgpt_web',
  label: 'ChatGPT',
  availability: 'asked',
};

const input = (patch: Partial<FrameInput> = {}): FrameInput => ({
  subject: 'share of voice',
  read: read(),
  previous: null,
  previousEmpty: false,
  engine: asked,
  situation: { kind: 'ready' },
  ...patch,
});

const map = (patch: Partial<FrameInput> = {}, ctx: Partial<FrameContext> = {}) =>
  mapReadToFrame(input(patch), words, context(ctx));

describe('mapReadToFrame', () => {
  it('is loading while the read loads, and while an asked engine has an idle read', () => {
    expect(map({ read: read({ status: 'loading' }) })).toMatchObject({ status: 'loading' });
    expect(map({ read: read({ status: 'idle' }) })).toMatchObject({ status: 'loading' });
  });

  it('is ready with no notice for a read that is ready', () => {
    const state = map();
    expect(state.status).toBe('ready');
    expect(state.notice).toBeUndefined();
  });

  it('is refetching while a scope change is read, keeping the data', () => {
    expect(map({ read: read({ status: 'refetching' }) }).status).toBe('refetching');
  });

  it('is an error with the error id and a retry that reads again', () => {
    const refetch = vi.fn();
    const state = map({ read: read({ status: 'error', errorId: 'req-7', refetch }) });
    expect(state.status).toBe('error');
    if (state.status !== 'error') return;
    expect(state.error.title).toBe('Could not load share of voice');
    expect(state.error.errorId?.id).toBe('req-7');
    expect(state.error.errorId?.label).toBe('Error ID req-7');
    expect(state.error.retryLabel).toBe('Try again');
    state.error.onRetry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('is an error with no error id when the read has none', () => {
    const state = map({ read: read({ status: 'error' }) });
    expect(state.status === 'error' && state.error.errorId).toBeNull();
  });

  it('keeps the data of a later failed read and says these are the last figures read', () => {
    const state = map({ read: read({ stale: true }) });
    expect(state.status).toBe('ready');
    expect(state.notice).toEqual({ kind: 'stale', text: 'These are the last figures read' });
  });

  it('keeps a refetch with stale data a refetch', () => {
    const state = map({ read: read({ status: 'refetching', stale: true }) });
    expect(state.status).toBe('refetching');
    expect(state.notice?.kind).toBe('stale');
  });

  it('says there is no comparison when only the previous read failed', () => {
    const state = map({ previous: read({ status: 'error' }) });
    expect(state.status).toBe('ready');
    expect(state.notice).toEqual({
      kind: 'partial',
      text: 'No comparison: the previous period could not be read',
    });
  });

  it('says there is no comparison when the previous period has no answers', () => {
    const state = map({ previous: read(), previousEmpty: true });
    expect(state.notice).toEqual({ kind: 'partial', text: 'No comparison: the previous period has no answers' });
  });

  it('has no notice when the comparison is off or fine', () => {
    expect(map({ previous: null }).notice).toBeUndefined();
    expect(map({ previous: read() }).notice).toBeUndefined();
  });

  it('prefers the stale notice to the partial one', () => {
    expect(map({ read: read({ stale: true }), previous: read({ status: 'error' }) }).notice?.kind).toBe('stale');
  });

  describe('an engine that is not asked', () => {
    const off: CardEngine = { code: 'gemini_web', label: 'Gemini', availability: 'off' };
    const outside: CardEngine = { code: 'gemini_web', label: 'Gemini', availability: 'outside' };

    it('is empty and says the engine is off, with the link to the engines for a member who can turn it on', () => {
      const state = map({ engine: off });
      expect(state.status).toBe('empty');
      if (state.status !== 'empty') return;
      expect(state.empty.title).toBe('Gemini is not asked in this scope');
      expect(state.empty.reason).toContain('turned off for this project');
      expect(isValidElement(state.empty.action)).toBe(true);
    });

    it('sends a viewer to a workspace admin, with no link', () => {
      const state = map({ engine: off }, { canManageEngines: false });
      expect(state.status === 'empty' && state.empty.reason).toContain('Ask a workspace admin to turn on an engine');
      expect(state.status === 'empty' && state.empty.action).toBeUndefined();
    });

    it('says an engine outside the filter is outside the filter, whoever looks', () => {
      for (const canManageEngines of [true, false]) {
        const state = map({ engine: outside }, { canManageEngines });
        expect(state.status === 'empty' && state.empty.reason).toContain('outside the engine filter');
        expect(state.status === 'empty' && state.empty.action).toBeUndefined();
      }
    });

    it('comes before a loading or a failed read', () => {
      expect(map({ engine: off, read: read({ status: 'loading' }) }).status).toBe('empty');
      expect(map({ engine: off, read: read({ status: 'error' }) }).status).toBe('empty');
    });
  });

  describe('a read with data that says too little', () => {
    const empty = (situation: DataSituation, ctx: Partial<FrameContext> = {}) => map({ situation }, ctx);

    it('says how many answers name a tracked brand when fewer than 4 do', () => {
      const state = empty({ kind: 'too_few', answers: 3 });
      expect(state.status === 'empty' && state.empty.title).toBe('Too few answers name a tracked brand (3)');
      expect(state.status === 'empty' && state.empty.reason).toContain('at least 4 answers');
    });

    it('says no competitor is tracked, with the link to the entities for an editor', () => {
      const state = empty({ kind: 'no_competitor' });
      expect(state.status === 'empty' && state.empty.title).toBe('No competitor is tracked');
      expect(state.status === 'empty' && isValidElement(state.empty.action)).toBe(true);
    });

    it('tells a viewer to ask a member who can edit entities, with no link', () => {
      const state = empty({ kind: 'no_competitor' }, { canEditEntities: false });
      expect(state.status === 'empty' && state.empty.reason).toContain('Ask a member who can edit entities');
      expect(state.status === 'empty' && state.empty.action).toBeUndefined();
    });

    it('names the engine and the days when no valid answer is in the window', () => {
      const state = empty({ kind: 'no_answers' });
      expect(state.status === 'empty' && state.empty.title).toBe('No valid answers on ChatGPT in these 28 days');
    });

    it('uses the singular for one day', () => {
      const state = map({ situation: { kind: 'no_answers' } }, { days: 1 });
      expect(state.status === 'empty' && state.empty.title).toBe('No valid answers on ChatGPT in this day');
    });

    it('does not show an empty state while the read is still loading', () => {
      expect(map({ read: read({ status: 'loading' }), situation: { kind: 'too_few', answers: 1 } }).status).toBe(
        'loading',
      );
    });
  });

  it('works for a card that has no engine of its own', () => {
    expect(map({ engine: null }).status).toBe('ready');
    const state = map({ engine: null, situation: { kind: 'no_answers' } });
    expect(state.status === 'empty' && state.empty.title).toBe('No valid answers in these 28 days');
  });
});

describe('frameSummary', () => {
  const figures = 'Share of voice on ChatGPT, of 0 answers that name a tracked brand: .';

  it('gives the sentence of the figures only for data that is read', () => {
    expect(frameSummary(map(), figures)).toBe(figures);
    expect(frameSummary(map({ read: read({ status: 'refetching' }) }), figures)).toBe(figures);
  });

  it('gives nothing for an engine that is not asked, never the figures', () => {
    const off: CardEngine = { code: 'chatgpt_web', label: 'ChatGPT', availability: 'outside' };
    expect(frameSummary(map({ engine: off }), figures)).toBe('');
  });

  it('gives nothing for an empty, failed or loading frame', () => {
    expect(frameSummary(map({ situation: { kind: 'no_answers' } }), figures)).toBe('');
    expect(frameSummary(map({ situation: { kind: 'too_few', answers: 3 } }), figures)).toBe('');
    expect(frameSummary(map({ read: read({ status: 'error' }) }), figures)).toBe('');
    expect(frameSummary(map({ read: read({ status: 'loading' }) }), figures)).toBe('');
  });
});
