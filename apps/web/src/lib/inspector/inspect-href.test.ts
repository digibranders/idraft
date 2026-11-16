import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { promptInspectHref } from './inspect-href';
import { parseInspectTarget } from './placement';

const BASE = '/digibranders/fynix/ai/prompts' as Route;

describe('promptInspectHref', () => {
  it('writes the prompt as the inspect key of the page, and the key reads back as that prompt', () => {
    const href = promptInspectHref(BASE, '0192f0a1-3c44-7e10');
    expect(href).toBe('/digibranders/fynix/ai/prompts?inspect=prompt%3A0192f0a1-3c44-7e10');
    const value = new URL(href, 'http://localhost').searchParams.get('inspect');
    expect(parseInspectTarget(value)).toEqual({ type: 'prompt', id: '0192f0a1-3c44-7e10' });
  });
});
