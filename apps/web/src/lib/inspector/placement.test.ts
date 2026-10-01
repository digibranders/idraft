import { describe, expect, it } from 'vitest';

import {
  defaultInspectorWidth,
  fitInspectorWidth,
  formatInspectTarget,
  inspectorPlacement,
  parseInspectTarget,
} from './placement';

const SIDEBAR = { expanded: 208, collapsed: 56 };

describe('inspect targets', () => {
  it('reads a known type and an id, and writes them back', () => {
    expect(parseInspectTarget('keyword:0192f0a1-3c44-7e10')).toEqual({ type: 'keyword', id: '0192f0a1-3c44-7e10' });
    expect(parseInspectTarget('domain:hubspot.com')).toEqual({ type: 'domain', id: 'hubspot.com' });
    expect(formatInspectTarget({ type: 'prompt', id: 'p1' })).toBe('prompt:p1');
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
  it('gives prompts, citations and answers the wide default', () => {
    expect(defaultInspectorWidth('keyword')).toBe(400);
    expect(defaultInspectorWidth('citation')).toBe(440);
  });

  it('snaps to 8 px and keeps between the minimum and the maximum', () => {
    expect(fitInspectorWidth(413, 640)).toBe(416);
    expect(fitInspectorWidth(300, 640)).toBe(360);
    expect(fitInspectorWidth(900, 500)).toBe(500);
  });
});

describe('inspectorPlacement, the table of 16 section 2.6', () => {
  const place = (viewport: number, sidebar: number, preferred = 400): ReturnType<typeof inspectorPlacement> =>
    inspectorPlacement({ areaWidth: viewport - sidebar, viewportWidth: viewport, preferred });

  it('docks wherever the main column keeps 720 px', () => {
    expect(place(1920, SIDEBAR.expanded)).toEqual({ mode: 'docked', width: 400, maxWidth: 640 });
    expect(place(1920, SIDEBAR.expanded, 440).width).toBe(440);
    expect(place(1440, SIDEBAR.expanded)).toEqual({ mode: 'docked', width: 400, maxWidth: 500 });
    expect(place(1440, SIDEBAR.collapsed).mode).toBe('docked');
    expect(place(1280, SIDEBAR.collapsed)).toEqual({ mode: 'docked', width: 400, maxWidth: 492 });
  });

  it('docks narrower than preferred rather than overlaying', () => {
    // The available 500 px caps the width, even off the 8 px grid
    expect(place(1440, SIDEBAR.expanded, 600)).toEqual({ mode: 'docked', width: 500, maxWidth: 500 });
  });

  it('overlays below that from 768 px, and is a sheet below 768 px', () => {
    expect(place(1280, SIDEBAR.expanded)).toEqual({ mode: 'overlay', width: 400, maxWidth: 640 });
    expect(place(1024, SIDEBAR.collapsed, 440)).toEqual({ mode: 'overlay', width: 440, maxWidth: 640 });
    expect(place(800, 0, 640)).toEqual({ mode: 'overlay', width: 640, maxWidth: 640 });
    expect(place(390, 0).mode).toBe('sheet');
  });
});
