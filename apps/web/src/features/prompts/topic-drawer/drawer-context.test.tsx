import { render, renderHook, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useTopicDrawer } from './drawer-context';
import { DRAWER_TOPIC_ID, renderDrawerPart } from '@/test/topic-drawer-harness';

function Probe(): ReactElement {
  const { topicKey, engines } = useTopicDrawer();
  return (
    <p>
      {topicKey} {engines.length}
    </p>
  );
}

describe('the topic drawer context', () => {
  it('throws outside the provider with a clear message', () => {
    // React logs the error it rethrows
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useTopicDrawer())).toThrow(/useTopicDrawer.*TopicDrawerProvider/);
    expect(() => render(<Probe />)).toThrow(/TopicDrawerProvider/);
    quiet.mockRestore();
  });

  it('gives the drawer parts the topic, the engines and the scope of the page', () => {
    renderDrawerPart(<Probe />);
    expect(screen.getByText(`${DRAWER_TOPIC_ID} 2`)).toBeInTheDocument();
  });
});
