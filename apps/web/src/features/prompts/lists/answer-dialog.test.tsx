import { describe, expect, it } from 'vitest';

import { imageSource } from './answer-dialog';

describe('imageSource', () => {
  it('accepts the API path of a stored screenshot', () => {
    const path =
      '/api/v1/workspaces/3f0c1d3e-0000-4000-8000-000000000001/projects/3f0c1d3e-0000-4000-8000-000000000002/ai/observations/77/screenshot';
    expect(imageSource(path)).toBe(path);
  });

  it('still accepts an https address and an inline image', () => {
    expect(imageSource('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(imageSource('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('refuses a script, another scheme and a path outside the API', () => {
    expect(imageSource('javascript:alert(1)')).toBeNull();
    expect(imageSource('file:///etc/passwd')).toBeNull();
    expect(imageSource('/other/path.png')).toBeNull();
    expect(imageSource('//evil.example.com/a.png')).toBeNull();
    expect(imageSource('/api/v1/../admin/screenshot')).toBeNull();
    expect(imageSource('/api/v1/workspaces/w/projects/p/ai/observations/77/raw')).toBeNull();
  });
});
