import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sha256Hex } from './sha256';

const nodeDigest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it('gives the published digests of the empty text and of "abc"', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('agrees with the platform digest around the block edges and for text past U+FFFF', () => {
    const rocket = String.fromCodePoint(0x1f680);
    for (const text of [
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(63),
      'a'.repeat(64),
      `Fynix ${rocket} leads`.repeat(40),
    ]) {
      expect(sha256Hex(text)).toBe(nodeDigest(text));
    }
  });

  it('gives 64 lowercase hex characters', () => {
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
