import { afterEach, describe, expect, it } from 'vitest';

import { getTopicOrder, setTopicOrder, subscribeTopicOrder } from './topic-order-store';

afterEach(() => {
  setTopicOrder('project-a', null);
  setTopicOrder('project-b', null);
});

describe('the topic order store', () => {
  it('keeps the order per project', () => {
    setTopicOrder('project-a', ['seo', 'ppc']);
    setTopicOrder('project-b', ['crm']);
    expect(getTopicOrder('project-a')).toEqual(['seo', 'ppc']);
    expect(getTopicOrder('project-b')).toEqual(['crm']);
  });

  it('empties', () => {
    setTopicOrder('project-a', ['seo']);
    setTopicOrder('project-a', null);
    expect(getTopicOrder('project-a')).toBeNull();
  });

  it('tells a listener when an order changes', () => {
    const seen: (readonly string[] | null)[] = [];
    const stop = subscribeTopicOrder(() => seen.push(getTopicOrder('project-a')));
    setTopicOrder('project-a', ['seo']);
    setTopicOrder('project-a', null);
    stop();
    setTopicOrder('project-a', ['ppc']);
    expect(seen).toEqual([['seo'], null]);
  });

  it('does not notify when the order set is the order held', () => {
    let notified = 0;
    const stop = subscribeTopicOrder(() => (notified += 1));
    setTopicOrder('project-a', ['seo', 'ppc']);
    // A new array of the same keys in the same order is the same order
    setTopicOrder('project-a', ['seo', 'ppc']);
    expect(notified).toBe(1);
    setTopicOrder('project-a', ['ppc', 'seo']);
    expect(notified).toBe(2);
    setTopicOrder('project-a', ['ppc']);
    expect(notified).toBe(3);
    setTopicOrder('project-a', null);
    setTopicOrder('project-a', null);
    stop();
    expect(notified).toBe(4);
    expect(getTopicOrder('project-a')).toBeNull();
  });

  it('keeps the array it was first given when an equal one comes', () => {
    const first = ['seo'];
    setTopicOrder('project-a', first);
    setTopicOrder('project-a', ['seo']);
    expect(getTopicOrder('project-a')).toBe(first);
  });

  it('has no order for a project that was never set', () => {
    expect(getTopicOrder('project-a')).toBeNull();
  });
});
