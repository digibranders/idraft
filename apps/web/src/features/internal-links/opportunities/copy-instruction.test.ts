import { describe, expect, it } from 'vitest';

import { instruction } from './copy-instruction';

describe('the copied instruction', () => {
  it('names the source page, the words and the target page', () => {
    expect(
      instruction({
        source: { url: 'https://eventussecurity.com/blog/siem-use-cases' },
        target: { url: 'https://eventussecurity.com/services/incident-response' },
        phrase: 'incident response retainer',
      }),
    ).toBe(
      'On https://eventussecurity.com/blog/siem-use-cases link the words "incident response retainer" to https://eventussecurity.com/services/incident-response.',
    );
  });
});
