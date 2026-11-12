import { describe, expect, it } from 'vitest';

import { PNG_PADDING, PNG_SCALE, pngLayout, type MeasureText, type PngLayoutInput } from './png-layout';

// Seven pixels a character, whatever the font: the layout is tested without a canvas
const measure: MeasureText = (text) => text.length * 7;

const input: PngLayoutInput = {
  width: 400,
  bodyHeight: 100,
  title: 'Title',
  meta: 'Meta',
  legend: [
    { name: 'Alpha', color: 'alpha-color', dash: 'solid' },
    { name: 'Beta', color: 'beta-color', dash: 'dashed' },
  ],
  footnote: 'Note',
};

describe('pngLayout', () => {
  it('uses a padding of 16 and draws at twice the size', () => {
    expect(PNG_PADDING).toBe(16);
    expect(PNG_SCALE).toBe(2);
  });

  it('puts the title at the padding and the meta 24 px below it', () => {
    const { texts } = pngLayout(input, measure);
    expect(texts[0]).toEqual({ text: 'Title', x: 16, y: 16, font: 'title' });
    expect(texts[1]).toEqual({ text: 'Meta', x: 16, y: 40, font: 'meta' });
  });

  it('wraps a title longer than the width by words, 24 px a line, and starts the meta below the last line', () => {
    const { texts, body } = pngLayout(
      { ...input, width: 200, title: 'aaaa bbbb cccc dddd eeee ffff', meta: 'Meta', legend: [], footnote: null },
      measure,
    );
    expect(texts.filter((run) => run.font === 'title')).toEqual([
      { text: 'aaaa bbbb cccc dddd eeee', x: 16, y: 16, font: 'title' },
      { text: 'ffff', x: 16, y: 40, font: 'title' },
    ]);
    expect(texts.find((run) => run.font === 'meta')?.y).toBe(64);
    // 16 padding, 2 title lines, 1 meta line, 12 gap
    expect(body.y).toBe(16 + 48 + 20 + 12);
  });

  it('wraps a meta longer than the width by words, 20 px a line', () => {
    const { texts } = pngLayout(
      { ...input, width: 200, meta: 'aaaa bbbb cccc dddd eeee ffff', legend: [], footnote: null },
      measure,
    );
    const meta = texts.filter((run) => run.font === 'meta');
    expect(meta).toEqual([
      { text: 'aaaa bbbb cccc dddd eeee', x: 16, y: 40, font: 'meta' },
      { text: 'ffff', x: 16, y: 60, font: 'meta' },
    ]);
  });

  it('flows the legend entries left to right, a swatch before each name', () => {
    const { texts, swatches } = pngLayout(input, measure);
    expect(swatches).toEqual([
      { x: 16, y: 80, color: 'alpha-color', dash: 'solid' },
      { x: 77, y: 80, color: 'beta-color', dash: 'dashed' },
    ]);
    const names = texts.filter((run) => run.font === 'legend');
    expect(names).toEqual([
      { text: 'Alpha', x: 30, y: 72, font: 'legend' },
      { text: 'Beta', x: 95, y: 72, font: 'legend' },
    ]);
  });

  it('wraps the legend to a new line when an entry does not fit', () => {
    const { swatches } = pngLayout({ ...input, width: 120 }, measure);
    expect(swatches.map((swatch) => [swatch.x, swatch.y])).toEqual([
      [16, 80],
      [16, 104],
    ]);
  });

  it('puts the body below the legend at the full inner width, and the footnote below the body', () => {
    const layout = pngLayout(input, measure);
    expect(layout.body).toEqual({ x: 16, y: 100, width: 368, height: 100 });
    expect(layout.texts.at(-1)).toEqual({ text: 'Note', x: 16, y: 212, font: 'meta' });
  });

  it('wraps a footnote by words', () => {
    const { texts } = pngLayout({ ...input, width: 200, footnote: 'one two three four five six seven' }, measure);
    const lines = texts.filter((run) => run.font === 'meta' && run.y > 100);
    expect(lines.map((run) => run.text)).toEqual(['one two three four five', 'six seven']);
    expect(lines[1]?.y).toBe((lines[0]?.y ?? 0) + 20);
  });

  it('ends at the bottom of the last part plus the padding', () => {
    expect(pngLayout(input, measure).height).toBe(248);
    expect(pngLayout(input, measure).width).toBe(400);
  });

  it('gives no space to a missing meta, legend or footnote', () => {
    const layout = pngLayout({ ...input, meta: null, legend: [], footnote: null }, measure);
    expect(layout.texts).toEqual([{ text: 'Title', x: 16, y: 16, font: 'title' }]);
    expect(layout.swatches).toEqual([]);
    expect(layout.body.y).toBe(52);
    expect(layout.height).toBe(52 + 100 + 16);
  });
});
