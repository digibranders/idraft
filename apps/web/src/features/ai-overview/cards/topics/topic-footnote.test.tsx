import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TopicFootnote } from './topic-footnote';
import { MIN_OBSERVATIONS } from '@/lib/stats';
import { renderWithProviders } from '@/test/render';

const base = { overlapPrompts: null, pooled: false, weighting: 'prompt' } as const;

describe('TopicFootnote', () => {
  it('always says topics overlap', () => {
    renderWithProviders(<TopicFootnote {...base} />);
    expect(screen.getByText(/a prompt in two topics counts in both/i)).toBeInTheDocument();
  });

  it('says how many prompts are in more than one topic when known', () => {
    renderWithProviders(<TopicFootnote {...base} overlapPrompts={4} />);
    expect(screen.getByText(/4 prompts are in more than one topic/)).toBeInTheDocument();
  });

  it('says one prompt in the singular and says nothing when the count is unknown', () => {
    const { rerender } = renderWithProviders(<TopicFootnote {...base} overlapPrompts={1} />);
    expect(screen.getByText(/1 prompt is in more than one topic/)).toBeInTheDocument();
    rerender(<TopicFootnote {...base} overlapPrompts={null} />);
    expect(screen.queryByText(/in more than one topic/)).not.toBeInTheDocument();
  });

  it('says the pooled sentence only when a point is pooled', () => {
    const { rerender } = renderWithProviders(<TopicFootnote {...base} pooled={false} />);
    expect(screen.queryByText(/together \(clipped to the window\)/)).not.toBeInTheDocument();
    rerender(<TopicFootnote {...base} pooled />);
    expect(
      screen.getByText(
        'A topic weekly point with fewer than 10 prompts answering that week shows the last 4 weeks together (clipped to the window); a prompt point always shows 4 weeks.',
      ),
    ).toBeInTheDocument();
  });

  it('says the prompt weighting or the answer weighting', () => {
    const { rerender } = renderWithProviders(<TopicFootnote {...base} weighting="prompt" />);
    expect(screen.getByText(/each prompt counts once/i)).toBeInTheDocument();
    rerender(<TopicFootnote {...base} weighting="answer" />);
    expect(screen.getByText(/each valid answer counts once/i)).toBeInTheDocument();
    expect(screen.queryByText(/each prompt counts once/i)).not.toBeInTheDocument();
  });

  it('says the test is unpaired on pooled counts when asked', () => {
    const { rerender } = renderWithProviders(<TopicFootnote {...base} />);
    expect(screen.queryByText(/unpaired test on pooled counts/i)).not.toBeInTheDocument();
    rerender(<TopicFootnote {...base} compareTest />);
    expect(screen.getByText(/unpaired test on pooled counts/i)).toBeInTheDocument();
  });

  it('says rates under 4 answers are not shown', () => {
    renderWithProviders(<TopicFootnote {...base} />);
    expect(MIN_OBSERVATIONS).toBe(4);
    expect(screen.getByText(/under 4 valid answers shows its answer count and no percent/i)).toBeInTheDocument();
  });

  it('puts extra text after the fixed sentences', () => {
    renderWithProviders(<TopicFootnote {...base} extra={<span>Seven bins</span>} />);
    expect(screen.getByText('Seven bins')).toBeInTheDocument();
  });
});
