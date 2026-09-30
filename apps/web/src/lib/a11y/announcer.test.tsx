import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIVE_REGION_ID, announce } from './announcer';
import { LiveRegions } from '@/providers/live-regions';

const region = (politeness: 'polite' | 'assertive'): HTMLElement => {
  const node = document.getElementById(LIVE_REGION_ID[politeness]);
  if (!node) throw new Error(`No ${politeness} live region in the document`);
  return node;
};

describe('announce (20-accessibility.md section 10.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    render(<LiveRegions />);
  });
  afterEach(() => {
    // Let every pending message and clear run out, so no timer of one test writes into the next
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('writes to the polite region by default and leaves the assertive one alone', () => {
    announce('12 keywords archived');
    expect(region('polite')).toHaveTextContent('12 keywords archived');
    expect(region('assertive')).toBeEmptyDOMElement();
  });

  it('writes errors to the assertive region', () => {
    announce('The run could not be queued', { politeness: 'assertive' });
    expect(region('assertive')).toHaveTextContent('The run could not be queued');
    expect(region('polite')).toBeEmptyDOMElement();
  });

  it('empties the region one second after a message', () => {
    announce('Saved');
    vi.advanceTimersByTime(999);
    expect(region('polite')).toHaveTextContent('Saved');
    vi.advanceTimersByTime(1);
    expect(region('polite')).toBeEmptyDOMElement();
  });

  it('announces the same text again later', () => {
    announce('Saved');
    vi.advanceTimersByTime(1_500);
    announce('Saved');
    expect(region('polite')).toHaveTextContent('Saved');
  });

  it('makes the same text a change when it is sent again while still shown', () => {
    announce('Saved');
    vi.advanceTimersByTime(300);
    announce('Saved');
    expect(region('polite')).toBeEmptyDOMElement();
    vi.advanceTimersByTime(50);
    expect(region('polite')).toHaveTextContent('Saved');
    vi.advanceTimersByTime(1_000);
    expect(region('polite')).toBeEmptyDOMElement();
  });

  it('holds one message at a time: a new one replaces the one before it', () => {
    announce('12 selected');
    announce('13 selected');
    expect(region('polite')).toHaveTextContent('13 selected');
    expect(region('polite')).not.toHaveTextContent('12 selected');
    // The clear of the first message does not cut the second short
    vi.advanceTimersByTime(999);
    expect(region('polite')).toHaveTextContent('13 selected');
  });

  it('waits for the debounce, and a newer message with the same key cancels the one waiting', () => {
    announce('1 selected', { key: 'selection', debounceMs: 300 });
    vi.advanceTimersByTime(200);
    announce('2 selected', { key: 'selection', debounceMs: 300 });
    vi.advanceTimersByTime(299);
    expect(region('polite')).toBeEmptyDOMElement();
    vi.advanceTimersByTime(1);
    expect(region('polite')).toHaveTextContent('2 selected');
  });

  it('cancels a waiting message when one with the same key is sent without a debounce', () => {
    announce('Filtering', { key: 'results', debounceMs: 300 });
    announce('240 keywords', { key: 'results' });
    vi.advanceTimersByTime(500);
    expect(region('polite')).toHaveTextContent('240 keywords');
  });

  it('does not let messages with different keys cancel each other', () => {
    announce('3 selected', { key: 'selection', debounceMs: 100 });
    announce('240 keywords', { key: 'results', debounceMs: 200 });
    vi.advanceTimersByTime(100);
    expect(region('polite')).toHaveTextContent('3 selected');
    vi.advanceTimersByTime(100);
    expect(region('polite')).toHaveTextContent('240 keywords');
  });

  it('stays one node however many messages arrive', () => {
    for (let i = 0; i < 200; i += 1) announce(`Message ${i}`);
    expect(region('polite').childNodes).toHaveLength(1);
    expect(region('polite')).toHaveTextContent('Message 199');
  });

  it('says nothing for an empty message', () => {
    announce('   ');
    expect(region('polite')).toBeEmptyDOMElement();
  });

  it('does nothing when the regions are not mounted', () => {
    document.body.replaceChildren();
    expect(() => announce('Saved')).not.toThrow();
    expect(() => vi.runAllTimers()).not.toThrow();
  });

  it('exposes the regions as status and alert, with aria-live written out for modals', () => {
    expect(region('polite')).toHaveAttribute('role', 'status');
    expect(region('polite')).toHaveAttribute('aria-live', 'polite');
    expect(region('assertive')).toHaveAttribute('role', 'alert');
    expect(region('assertive')).toHaveAttribute('aria-live', 'assertive');
  });
});
