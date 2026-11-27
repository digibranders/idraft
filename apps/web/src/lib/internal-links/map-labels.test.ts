import { describe, expect, it } from 'vitest';

import { chooseNames, dotScale, nameLimit, NAMES_AT_FIT, nameStep, nameWidth, type NameCandidate } from './map-labels';

const page = (id: string, x: number, y: number, text = 'a-page-name'): NameCandidate => ({ id, x, y, size: 10, text });

describe('nameStep', () => {
  it('is the largest step not above the zoom', () => {
    expect(nameStep(0.3)).toBe(0.5);
    expect(nameStep(1)).toBe(1);
    expect(nameStep(1.49)).toBe(1);
    expect(nameStep(1.5)).toBe(1.5);
    expect(nameStep(2.9)).toBe(2);
    expect(nameStep(40)).toBe(12);
  });
});

describe('dotScale and nameLimit', () => {
  it('grows a dot by 45 percent of the zoom, and the number of names faster than the zoom', () => {
    expect(dotScale(1)).toBe(1);
    expect(dotScale(3)).toBeCloseTo(1.9);
    expect(nameLimit(1)).toBe(NAMES_AT_FIT);
    expect(nameLimit(2)).toBeGreaterThan(nameLimit(1) * 2);
  });
});

describe('chooseNames', () => {
  it('names the first page, and keeps out a page whose name would run into a name it kept', () => {
    const names = chooseNames([page('a', 100, 100), page('b', 110, 104), page('c', 400, 100)], {
      step: 1,
      fontSize: 11,
    });

    expect([...names]).toEqual(['a', 'c']);
  });

  it('keeps a page whose name is under or beside the box of another one by the gap', () => {
    const width = nameWidth('a-page-name', 11);
    const names = chooseNames([page('a', 100, 100), page('b', 100, 130), page('c', 100 + width + 40, 100)], {
      step: 1,
      fontSize: 11,
    });

    expect([...names]).toEqual(['a', 'b', 'c']);
  });

  it('stops at the limit, in rank order', () => {
    const row = Array.from({ length: 20 }, (_, index) => page(String(index), 40, 30 + index * 40));

    expect([...chooseNames(row, { step: 1, fontSize: 11, limit: 5 })]).toEqual(['0', '1', '2', '3', '4']);
  });

  it('keeps clear of the lines of text of the block', () => {
    const obstacles = [{ x: 200, y: 100, width: 150, height: 16 }];

    expect([...chooseNames([page('a', 190, 104), page('b', 190, 200)], { step: 1, fontSize: 11, obstacles })]).toEqual([
      'b',
    ]);
  });

  it('names more pages as the zoom opens the map up', () => {
    const row = Array.from({ length: 30 }, (_, index) => page(String(index), 20 + index * 22, 100));
    const fit = chooseNames(row, { step: 1, fontSize: 11 });
    const zoomed = chooseNames(row, { step: 4, fontSize: 11 });

    expect(zoomed.size).toBeGreaterThan(fit.size);
    // The page that ranks first is named at every step
    expect(fit.has('0') && zoomed.has('0')).toBe(true);
  });

  it('is the same on every run', () => {
    const grid = Array.from({ length: 200 }, (_, index) => page(String(index), (index * 37) % 900, (index * 91) % 500));

    expect([...chooseNames(grid, { step: 1, fontSize: 11 })]).toEqual([
      ...chooseNames(grid, { step: 1, fontSize: 11 }),
    ]);
  });
});
