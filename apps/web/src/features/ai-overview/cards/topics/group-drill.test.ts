import { beforeEach, describe, expect, it } from 'vitest';

import { forgetDrill, platformForBack, rememberDrill } from './group-drill';

beforeEach(forgetDrill);

describe('Back from a group', () => {
  it('restores the platform the person came from while the click still stands', () => {
    rememberDrill('g1', null, 'gemini_web');
    expect(platformForBack('g1', 'gemini_web')).toBeNull();
  });

  it('restores a platform that was chosen before the click', () => {
    rememberDrill('g1', 'chatgpt_web', 'gemini_web');
    expect(platformForBack('g1', 'gemini_web')).toBe('chatgpt_web');
  });

  it('keeps the chosen platform when the person changed it after the click', () => {
    rememberDrill('g1', null, 'gemini_web');
    expect(platformForBack('g1', 'chatgpt_web')).toBe('chatgpt_web');
  });

  it('keeps the chosen platform for another group, and for a link with no click', () => {
    rememberDrill('g1', null, 'gemini_web');
    expect(platformForBack('g2', 'gemini_web')).toBe('gemini_web');
    expect(platformForBack('g2', 'gemini_web')).toBe('gemini_web');
  });

  it('forgets the click once Back has used it', () => {
    rememberDrill('g1', null, 'gemini_web');
    platformForBack('g1', 'gemini_web');
    expect(platformForBack('g1', 'gemini_web')).toBe('gemini_web');
  });
});
