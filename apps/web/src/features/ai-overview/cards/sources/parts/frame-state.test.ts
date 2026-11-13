import { createTranslator } from 'next-intl';
import type { Route } from 'next';
import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { mapReadToFrame, type FrameContext, type FrameInput, type FrameWords, type ReadFacts } from './frame-state';
import messages from '../../../../../../messages/en.json';
import type { Say } from '../../../numbers/number-model';

const translator = (namespace: string): Say => {
  const translate = createTranslator({ locale: 'en', messages, namespace: namespace as never });
  return (key, values) => translate(key as never, values as never);
};
const status = translator('status.error');
const common = translator('common');

const words: FrameWords = {
  say: translator('aiOverview.sources.common'),
  errorId: (id) => status('errorId', { id }),
  copyErrorId: status('copyErrorId'),
  copied: status('copied'),
  retry: common('retry'),
};

const context = (patch: Partial<FrameContext> = {}): FrameContext => ({
  enginesHref: '/acme/fynix/settings/engines' as Route,
  canManageEngines: true,
  days: 28,
  minUnits: 2,
  ...patch,
});

const read = (patch: Partial<ReadFacts> = {}): ReadFacts => ({
  status: 'ready',
  errorId: null,
  stale: false,
  refetch: () => undefined,
  ...patch,
});

const input = (patch: Partial<FrameInput> = {}): FrameInput => ({
  subject: 'top cited domains',
  read: read(),
  previous: null,
  previousEmpty: false,
  situation: { kind: 'ready' },
  ...patch,
});

const map = (patch: Partial<FrameInput> = {}, ctx: Partial<FrameContext> = {}) =>
  mapReadToFrame(input(patch), words, context(ctx));

describe('mapReadToFrame', () => {
  it('is loading while the read loads, and for an idle read of a scope that can be asked', () => {
    expect(map({ read: read({ status: 'loading' }) })).toMatchObject({ status: 'loading' });
    expect(map({ read: read({ status: 'idle' }) })).toMatchObject({ status: 'loading' });
  });

  it('is ready with no notice for a read that is ready, and refetching keeps the data', () => {
    expect(map().status).toBe('ready');
    expect(map().notice).toBeUndefined();
    expect(map({ read: read({ status: 'refetching' }) }).status).toBe('refetching');
  });

  it('is an error with its title, retry and error id for a read that failed with nothing to show', () => {
    const refetch = vi.fn();
    const state = map({ read: read({ status: 'error', errorId: 'req-9', refetch }) });
    expect(state.status).toBe('error');
    if (state.status !== 'error') throw new Error('expected an error state');
    expect(state.error.title).toBe('Could not load top cited domains');
    expect(state.error.errorId?.label).toBe('Error ID req-9');
    state.error.onRetry();
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('is empty before anything is read when no engine is on, with the link only for who may turn one on', () => {
    const editor = map({ situation: { kind: 'no_engine' }, read: read({ status: 'idle' }) });
    expect(editor.status).toBe('empty');
    if (editor.status !== 'empty') throw new Error('expected an empty state');
    expect(editor.empty.title).toBe('No engine is on for this project');
    expect(isValidElement(editor.empty.action)).toBe(true);
    const viewer = map(
      { situation: { kind: 'no_engine' }, read: read({ status: 'idle' }) },
      { canManageEngines: false },
    );
    if (viewer.status !== 'empty') throw new Error('expected an empty state');
    expect(viewer.empty.action).toBeUndefined();
    expect(viewer.empty.reason).toContain('Ask a workspace admin to turn on an engine.');
  });

  it('is empty with its reason for branded prompts alone', () => {
    const state = map({ situation: { kind: 'branded_only' }, read: read({ status: 'idle' }) });
    if (state.status !== 'empty') throw new Error('expected an empty state');
    expect(state.empty.title).toBe('Sources cannot be read for branded prompts alone');
  });

  it('says no valid answer, no cited source, or no domain over the minimum, each with its own words', () => {
    const titles = [
      { kind: 'no_answers' as const },
      { kind: 'no_citations' as const, answers: 12 },
      { kind: 'none_listed' as const },
    ].map((situation) => {
      const state = map({ situation });
      if (state.status !== 'empty') throw new Error('expected an empty state');
      return [state.empty.title, state.empty.reason];
    });
    expect(titles).toEqual([
      ['No valid answers in these 28 days', 'Answers appear after the next run, or widen the date range.'],
      ['No answer cited a source in this window', '12 answers were collected in this window, and none cited a source.'],
      [
        'No domain has 2 or more citation units',
        'Domains below the minimum are not listed. Widen the date range or change the domains shown.',
      ],
    ]);
  });

  it('keeps the data and says these are the last figures read when a later read failed', () => {
    const state = map({ read: read({ stale: true }) });
    expect(state.status).toBe('ready');
    expect(state.notice).toEqual({ kind: 'stale', text: 'These are the last figures read' });
  });

  it('says the comparison is missing when the previous read failed, or the window before had no answers', () => {
    expect(map({ previous: read({ status: 'error' }) }).notice).toEqual({
      kind: 'partial',
      text: 'No comparison: the previous period could not be read',
    });
    expect(map({ previous: read(), previousEmpty: true }).notice).toEqual({
      kind: 'partial',
      text: 'No comparison: the previous period has no answers',
    });
  });

  it('puts the last figures read before a missing comparison', () => {
    expect(map({ read: read({ stale: true }), previous: read({ status: 'error' }) }).notice?.kind).toBe('stale');
  });
});
