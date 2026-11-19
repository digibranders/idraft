import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MentionText } from './mention-text';

describe('the mention in its sentence', () => {
  it('marks the phrase where the sentence has it, without regard to case', () => {
    const { container } = render(
      <MentionText context="Teams ask about Managed SOC Pricing early." phrase="managed soc pricing" />,
    );
    const marked = container.querySelectorAll('[data-mention]');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent('Managed SOC Pricing');
    expect(container.textContent).toBe('Teams ask about Managed SOC Pricing early.');
  });

  it('shows the sentence plain when lowercasing it shifts the offsets', () => {
    const context = 'İstanbul offices hold the managed soc pricing talks.';
    expect(context.toLowerCase().length).not.toBe(context.length);
    const { container } = render(<MentionText context={context} phrase="managed soc pricing" />);
    expect(container.querySelector('[data-mention]')).toBeNull();
    expect(container.textContent).toBe(context);
  });

  it('puts the phrase first when the sentence does not hold it', () => {
    const { container } = render(<MentionText context="A different sentence." phrase="the phrase" />);
    expect(container.querySelector('[data-mention]')).toHaveTextContent('the phrase');
    expect(container.textContent).toBe('the phrase A different sentence.');
  });
});
