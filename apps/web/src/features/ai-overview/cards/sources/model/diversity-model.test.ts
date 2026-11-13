import { describe, expect, it } from 'vitest';

import { diversityEngine, diversityRead, diversityWeek } from './change-fixtures';
import { diversityModel, valueOf } from './diversity-model';
import { at } from './source-fixtures';

const WEEKS = ['2026-10-19', '2026-10-26', '2026-11-02'] as const;

function read() {
  return diversityRead(
    [
      diversityEngine('gemini_web', {
        weeks: [
          diversityWeek(WEEKS[0], 100, 30, 12.5),
          diversityWeek(WEEKS[1], 0, 0, null),
          diversityWeek(WEEKS[2], 80, 25, 10),
        ],
      }),
      diversityEngine('chatgpt_web', {
        effective: 20,
        weeks: [
          diversityWeek(WEEKS[0], 200, 41, 18.6),
          diversityWeek(WEEKS[1], 150, 38, 17),
          diversityWeek(WEEKS[2], 0, 0, null),
        ],
      }),
    ],
    { distinct: 412, average: 15.3 },
  );
}

describe('diversityModel', () => {
  it('lists the engines in the order of the catalog, whatever order the read had them in', () => {
    expect(diversityModel(read()).engines.map((engine) => engine.code)).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('has one series per engine and no series for the engines together', () => {
    const model = diversityModel(read());
    expect(model.engines).toHaveLength(2);
    expect(model.weeks).toEqual([...WEEKS]);
    expect(at(model.engines, 0).points.map((point) => point.units)).toEqual([200, 150, 0]);
    expect(at(model.engines, 1).points.map((point) => point.units)).toEqual([100, 0, 80]);
  });

  it('keeps a week with no unit as a gap in both views, never as 0', () => {
    const model = diversityModel(read());
    const gemini = at(model.engines, 1);
    expect(valueOf(at(gemini.points, 1), 'distinct')).toBeNull();
    expect(valueOf(at(gemini.points, 1), 'effective')).toBeNull();
    expect(valueOf(at(at(model.engines, 0).points, 2), 'distinct')).toBeNull();
  });

  it('reads the distinct domains or the effective sources of a week by the view', () => {
    const point = at(at(diversityModel(read()).engines, 0).points, 0);
    expect(valueOf(point, 'distinct')).toBe(41);
    expect(valueOf(point, 'effective')).toBe(18.6);
  });

  it('keeps the effective sources the API sent and does not recompute them from the units', () => {
    const point = at(at(diversityModel(read()).engines, 1).points, 2);
    expect(point.effective).toBe(10);
    expect(point.units).toBe(80);
    expect(point.domains).toBe(25);
  });

  it('takes the average only from the API field, never from the engines', () => {
    expect(diversityModel(read()).average).toBe(15.3);
    const without = diversityRead(read().data, { average: null });
    expect(diversityModel(without).average).toBeNull();
  });

  it('takes the domains cited over every engine from the API meta', () => {
    expect(diversityModel(read()).distinctDomains).toBe(412);
  });

  it('says there is no weekly series when the read was made without one', () => {
    const model = diversityModel(diversityRead([diversityEngine('chatgpt_web'), diversityEngine('gemini_web')]));
    expect(model.hasWeeks).toBe(false);
    expect(model.weeks).toEqual([]);
  });

  it('says no week holds a unit when every point of every engine is empty', () => {
    const model = diversityModel(
      diversityRead([diversityEngine('chatgpt_web', { weeks: [diversityWeek(WEEKS[0], 0, 0, null)] })]),
    );
    expect(model.hasWeeks).toBe(true);
    expect(model.hasUnits).toBe(false);
  });

  it('fills a week one engine lacks with a gap when the series of two engines differ', () => {
    const model = diversityModel(
      diversityRead([
        diversityEngine('chatgpt_web', { weeks: [diversityWeek(WEEKS[0], 5, 3, 2), diversityWeek(WEEKS[1], 6, 4, 3)] }),
        diversityEngine('gemini_web', { weeks: [diversityWeek(WEEKS[1], 7, 5, 4)] }),
      ]),
    );
    expect(model.weeks).toEqual([WEEKS[0], WEEKS[1]]);
    expect(at(model.engines, 1).points.map((point) => point.units)).toEqual([null, 7]);
  });
});
