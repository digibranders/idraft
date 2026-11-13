import { describe, expect, it } from 'vitest';

import { engine, head, projectEngine, weighted } from './cells-fixtures';
import { topicListLines } from './list-lines';

const ENGINES = [projectEngine('chatgpt_web'), projectEngine('gemini_web'), projectEngine('google_ai_mode')];

describe('topicListLines: the second line of a topic on a phone', () => {
  it('names the best engine with its rate and counts the engines that show a rate', () => {
    const lines = topicListLines(
      head('tech', 'Technical SEO', {
        path: 'SEO / Technical SEO',
        engines: [
          engine('chatgpt_web', { mentioned: weighted(3, 8, 2) }),
          engine('gemini_web', { mentioned: weighted(6, 8, 2) }),
          // Too few answers: it shows no rate, so it is not counted
          engine('google_ai_mode', { mentioned: weighted(2, 3, 2) }),
        ],
      }),
      ENGINES,
    );
    expect(lines.identity).toBe('SEO / Technical SEO');
    expect(lines.best).toEqual({ code: 'gemini_web', value: 0.75, successes: 6, answers: 8 });
    expect(lines.engines).toBe(2);
  });

  it('says no engine has a rate yet', () => {
    const lines = topicListLines(
      head('x', 'Empty', { engines: [engine('chatgpt_web', { mentioned: weighted(1, 2, 1) })] }),
      ENGINES,
    );
    expect(lines.best).toBeNull();
    expect(lines.engines).toBe(0);
    expect(topicListLines(head('y', 'Nothing'), ENGINES).engines).toBe(0);
  });

  it('never names an engine with a best rate of 0', () => {
    const lines = topicListLines(
      head('z', 'Zero', {
        engines: [
          engine('chatgpt_web', { mentioned: weighted(0, 8, 2) }),
          engine('gemini_web', { mentioned: weighted(0, 9, 2) }),
        ],
      }),
      ENGINES,
    );
    expect(lines.best).toBeNull();
    // Both engines show a rate, 0 percent: the count of engines is still right
    expect(lines.engines).toBe(2);
  });

  it('takes rates that differ by float noise as a tie, which goes to the engine shown first', () => {
    // 0.1 + 0.2 is 0.30000000000000004: the same 30 percent for every reader
    const noisy = { ...weighted(3, 10, 2), value: 0.1 + 0.2 };
    const lines = topicListLines(
      head('n', 'Noisy', {
        engines: [engine('chatgpt_web', { mentioned: weighted(3, 10, 2) }), engine('gemini_web', { mentioned: noisy })],
      }),
      ENGINES,
    );
    expect(lines.best?.code).toBe('chatgpt_web');
    const flipped = topicListLines(
      head('n', 'Noisy', {
        engines: [engine('chatgpt_web', { mentioned: noisy }), engine('gemini_web', { mentioned: weighted(3, 10, 2) })],
      }),
      ENGINES,
    );
    expect(flipped.best?.code).toBe('chatgpt_web');
  });

  it('gives a tie to the engine shown first', () => {
    const lines = topicListLines(
      head('t', 'Tied', {
        engines: [
          engine('gemini_web', { mentioned: weighted(4, 8, 2) }),
          engine('chatgpt_web', { mentioned: weighted(4, 8, 2) }),
        ],
      }),
      ENGINES,
    );
    expect(lines.best?.code).toBe('chatgpt_web');
  });
});
