import { describe, expect, it } from 'vitest';

import { cardPhase, type PhaseInput } from './card-phase';
import type { ReadStatus } from '../../data/read-state';

const read = (status: ReadStatus, stale = false): PhaseInput['current'] => ({ status, stale });

/** Both windows read and settled, with something to show: the card is ready. */
const READY: PhaseInput = {
  current: read('ready'),
  previous: read('ready'),
  need: 'required',
  settled: true,
  hasContent: true,
};
const phaseOf = (patch: Partial<PhaseInput>): ReturnType<typeof cardPhase> => cardPhase({ ...READY, ...patch });

describe('cardPhase', () => {
  it('is ready when every read is settled and there is something to show', () => {
    expect(phaseOf({})).toEqual({ phase: 'ready', stale: false, partialPrevious: false });
  });

  it('error with no data is error', () => {
    expect(phaseOf({ current: read('error') }).phase).toBe('error');
    expect(phaseOf({ current: read('error'), need: 'none', previous: null }).phase).toBe('error');
  });

  it('a failed previous read on a card that needs it is error', () => {
    expect(phaseOf({ previous: read('error'), need: 'required' }).phase).toBe('error');
  });

  it('a failed previous read on a card that does not need it is ready with partial', () => {
    expect(phaseOf({ previous: read('error'), need: 'optional' })).toEqual({
      phase: 'ready',
      stale: false,
      partialPrevious: true,
    });
  });

  it('a previous read that nothing asked for never makes a card partial or failed', () => {
    expect(phaseOf({ previous: read('error'), need: 'none' })).toEqual({
      phase: 'ready',
      stale: false,
      partialPrevious: false,
    });
  });

  it('idle current read is empty', () => {
    expect(phaseOf({ current: read('idle'), previous: null, need: 'none', settled: true }).phase).toBe('empty');
  });

  it('any loading required read is loading', () => {
    expect(phaseOf({ current: read('loading'), settled: false }).phase).toBe('loading');
    expect(phaseOf({ previous: read('loading'), need: 'required', settled: false }).phase).toBe('loading');
  });

  it('a loading previous read of a card that can do without it is not loading: the card keeps its data', () => {
    expect(phaseOf({ previous: read('loading'), need: 'optional', settled: false }).phase).toBe('refetching');
  });

  it('unsettled periods are refetching, never ready', () => {
    expect(phaseOf({ settled: false }).phase).toBe('refetching');
    expect(phaseOf({ current: read('refetching'), settled: true }).phase).toBe('refetching');
    expect(phaseOf({ previous: read('refetching'), settled: true }).phase).toBe('refetching');
  });

  it('is refetching, not empty, while it reads again with nothing to show yet (what is shown may be the last scope)', () => {
    expect(phaseOf({ hasContent: false, settled: false }).phase).toBe('refetching');
  });

  it('ready without content is empty', () => {
    expect(phaseOf({ hasContent: false }).phase).toBe('empty');
  });

  it('a card that needs the previous window and has none by design (comparison off) is empty', () => {
    expect(phaseOf({ previous: null, need: 'required' }).phase).toBe('empty');
  });

  it('stale comes from the required reads only', () => {
    expect(phaseOf({ current: read('ready', true), need: 'none', previous: null }).stale).toBe(true);
    expect(phaseOf({ previous: read('ready', true), need: 'required' }).stale).toBe(true);
    expect(phaseOf({ previous: read('ready', true), need: 'optional' }).stale).toBe(false);
    expect(phaseOf({ previous: read('ready', true), need: 'none' }).stale).toBe(false);
  });
});
