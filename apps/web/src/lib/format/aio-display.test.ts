import { describe, expect, it } from 'vitest';

import { aioDisplay } from './aio-display';
import type { AioStateInfo } from '@/lib/api/types';

const aio = (state: AioStateInfo['state'], position: number | null = null): AioStateInfo => ({
  state,
  citation_position: position,
  observation_id: state === 'absent' || state === 'unknown' ? null : '17',
});

describe('aioDisplay', () => {
  it('shows a citation with its position', () => {
    expect(aioDisplay(aio('present_cited', 2), 'ranked')).toEqual({ kind: 'cited', position: 2 });
    expect(aioDisplay(aio('present_cited', null), 'beyond_depth')).toEqual({ kind: 'cited', position: null });
  });

  it('tells an AI Overview that does not cite the site from none at all', () => {
    expect(aioDisplay(aio('present_not_cited'), 'ranked')).toEqual({ kind: 'notCited' });
    expect(aioDisplay(aio('absent'), 'ranked')).toEqual({ kind: 'absent' });
  });

  it('says not loaded and unknown as such', () => {
    expect(aioDisplay(aio('not_loaded'), 'ranked')).toEqual({ kind: 'notLoaded' });
    expect(aioDisplay(aio('unknown'), 'failed')).toEqual({ kind: 'unknown' });
  });

  it('is pending before the first check, whatever the state says', () => {
    expect(aioDisplay(aio('unknown'), 'not_checked')).toEqual({ kind: 'pending' });
  });
});
