import { describe, expect, it } from 'vitest';

import {
  fitInspectorWidth,
  formatInspectTarget,
  INSPECTOR_WIDTH,
  inspectorMaxWidth,
  inspectorPlacement,
  parseInspectTarget,
} from './placement';

describe('inspect targets', () => {
  it('reads a known type and an id, and writes them back', () => {
    expect(parseInspectTarget('keyword:0192f0a1-3c44-7e10')).toEqual({ type: 'keyword', id: '0192f0a1-3c44-7e10' });
    expect(parseInspectTarget('domain:hubspot.com')).toEqual({ type: 'domain', id: 'hubspot.com' });
    expect(formatInspectTarget({ type: 'prompt', id: 'p1' })).toBe('prompt:p1');
  });

  it('reads a keyword group, "Not grouped" included', () => {
    expect(parseInspectTarget('group:0192f0a1-3c44-7e10')).toEqual({ type: 'group', id: '0192f0a1-3c44-7e10' });
    expect(parseInspectTarget('group:__none')).toEqual({ type: 'group', id: '__none' });
  });

  it('reads the two Citations drawers (WP-77)', () => {
    expect(parseInspectTarget('cited-page:12')).toEqual({ type: 'cited-page', id: '12' });
    expect(parseInspectTarget('gap-prompt:0192d1a8-c177-7000-8000-000000000001')).toMatchObject({
      type: 'gap-prompt',
    });
    expect(parseInspectTarget('cann-keyword:0192d1a8-c177-7000-8000-000000000001')).toMatchObject({
      type: 'cann-keyword',
    });
  });

  it('opens nothing for an unknown type, an empty or spaced id, or no colon', () => {
    expect(parseInspectTarget('report:1')).toBeNull();
    expect(parseInspectTarget('keyword:')).toBeNull();
    expect(parseInspectTarget('keyword:a b')).toBeNull();
    expect(parseInspectTarget('keyword')).toBeNull();
    expect(parseInspectTarget(`keyword:${'x'.repeat(201)}`)).toBeNull();
    expect(parseInspectTarget(null)).toBeNull();
  });
});

describe('widths', () => {
  it('has one default for every type: 640, from 480 to 960', () => {
    expect(INSPECTOR_WIDTH).toEqual({ min: 480, max: 960, default: 640 });
  });

  it('opens a topic from the address', () => {
    expect(parseInspectTarget('topic:__none')).toEqual({ type: 'topic', id: '__none' });
  });

  it('caps the width at 60% of the frame, on the 8 px grid, never above 960 or below 480', () => {
    expect(inspectorMaxWidth(900)).toBe(536);
    expect(inspectorMaxWidth(1024)).toBe(608);
    expect(inspectorMaxWidth(1280)).toBe(768);
    expect(inspectorMaxWidth(1537)).toBe(920);
    expect(inspectorMaxWidth(1600)).toBe(960);
    expect(inspectorMaxWidth(2560)).toBe(960);
    expect(inspectorMaxWidth(700)).toBe(480);
  });

  it('snaps to 8 px and keeps between the minimum and the maximum', () => {
    expect(fitInspectorWidth(643, 768)).toBe(640);
    expect(fitInspectorWidth(100, 768)).toBe(480);
    expect(fitInspectorWidth(2000, 768)).toBe(768);
  });
});

describe('inspectorPlacement', () => {
  it('is a sheet below 900 px and lays over the page from 900 px', () => {
    expect(inspectorPlacement({ viewportWidth: 899, preferred: 640 })).toEqual({
      mode: 'sheet',
      width: 899,
      maxWidth: 899,
    });
    expect(inspectorPlacement({ viewportWidth: 900, preferred: 640 })).toEqual({
      mode: 'overlay',
      width: 536,
      maxWidth: 536,
    });
  });

  it('opens at the preferred width where it fits', () => {
    expect(inspectorPlacement({ viewportWidth: 1280, preferred: 640 })).toEqual({
      mode: 'overlay',
      width: 640,
      maxWidth: 768,
    });
    expect(inspectorPlacement({ viewportWidth: 1537, preferred: 640 })).toEqual({
      mode: 'overlay',
      width: 640,
      maxWidth: 920,
    });
  });

  it('narrows a wider saved width to what this viewport allows', () => {
    expect(inspectorPlacement({ viewportWidth: 1280, preferred: 960 }).width).toBe(768);
    expect(inspectorPlacement({ viewportWidth: 1920, preferred: 960 }).width).toBe(960);
  });

  it('takes 60% of a boxed preview, not of the window', () => {
    expect(inspectorPlacement({ viewportWidth: 1440, frameWidth: 800, preferred: 640 })).toEqual({
      mode: 'overlay',
      width: 480,
      maxWidth: 480,
    });
  });
});
