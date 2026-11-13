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

  it('has no order for a project that was never set', () => {
    expect(getTopicOrder('project-a')).toBeNull();
  });
});
