import { describe, expect, it } from 'vitest';

import { domainRows } from './domain-rows';
import { at, domainPage, domainRow, sourcesMeta } from './source-fixtures';
import { shareChange, unitShare } from '@/lib/citations/share-model';

describe('domainRows', () => {
  it('keeps the order of the route and gives each row its share as the API states it', () => {
    const rows = [
      domainRow({ domain: 'g2.com', units: 190, total: 1000, answers: 110, prompts: 21 }),
      domainRow({ domain: 'capterra.com', units: 150, total: 1000 }),
    ];
    const figures = domainRows(domainPage(rows), null);
    expect(figures.map((row) => row.domain)).toEqual(['g2.com', 'capterra.com']);
    expect(at(figures, 0).share).toEqual(unitShare(at(rows, 0).source_share));
    expect(at(figures, 0)).toMatchObject({ units: 190, answers: 110, prompts: 21, state: 'ok' });
    expect(at(figures, 0).share).toEqual({ value: 0.19, units: 190, total: 1000 });
  });

  it('flags the own domain and no other', () => {
    const figures = domainRows(
      domainPage([
        domainRow({ domain: 'g2.com', units: 190 }),
        domainRow({ domain: 'fynix.com', role: 'own', units: 120 }),
        domainRow({ domain: 'hubspot.com', role: 'competitor', units: 80 }),
      ]),
      null,
    );
    expect(figures.map((row) => [row.domain, row.own])).toEqual([
      ['g2.com', false],
      ['fynix.com', true],
      ['hubspot.com', false],
    ]);
  });

  it('keeps a domain that matched two roles as two rows with two ids', () => {
    const figures = domainRows(
      domainPage([
        domainRow({ domain: 'medium.com', role: 'third_party', units: 60 }),
        domainRow({ domain: 'medium.com', role: 'competitor', units: 40, entityId: 'e-2' }),
      ]),
      null,
    );
    expect(figures).toHaveLength(2);
    expect(new Set(figures.map((row) => row.id)).size).toBe(2);
    expect(figures.map((row) => row.role)).toEqual(['third_party', 'competitor']);
  });

  it('gives a share over no unit as null with the state unknown, never 0', () => {
    const [row] = domainRows(domainPage([domainRow({ domain: 'g2.com', units: 0, total: 0 })]), null);
    expect(row?.share.value).toBeNull();
    expect(row?.state).toBe('unknown');
  });

  it('marks a share over fewer than 4 valid answers as thin and carries the answers', () => {
    const [row] = domainRows(domainPage([domainRow({ domain: 'g2.com', units: 3, total: 9, valid: 3 })]), null);
    expect(row).toMatchObject({ state: 'thin', validAnswers: 3 });
    const [enough] = domainRows(domainPage([domainRow({ domain: 'g2.com', units: 3, total: 9, valid: 4 })]), null);
    expect(enough?.state).toBe('ok');
  });

  it('draws the change of the share as shareChange does, from the previous total', () => {
    const meta = sourcesMeta({ units: 1000, previousAnswers: 80 });
    const row = domainRow({ domain: 'g2.com', units: 190, total: 1000, previous: { units: 164, answers: 90 } });
    const [figure] = domainRows(domainPage([row], meta), { citation_units: 1000 });
    expect(figure?.change).toEqual(shareChange(row, meta, { citation_units: 1000 }));
    expect(figure?.change?.delta).toBeCloseTo(0.026, 6);
    expect(figure?.previousUnits).toBe(164);
  });

  it('has no change and no previous units when the window before has no answers', () => {
    const meta = sourcesMeta({ previousAnswers: 0 });
    const row = domainRow({ domain: 'g2.com', units: 190, previous: { units: 0, answers: 0 } });
    const [figure] = domainRows(domainPage([row], meta), { citation_units: 0 });
    expect(figure?.change).toBeNull();
    expect(figure?.previousUnits).toBeNull();
  });

  it('has no change while the previous total is not read, and none when the read was not compared', () => {
    const compared = domainPage(
      [domainRow({ domain: 'g2.com', units: 190, previous: { units: 164, answers: 90 } })],
      sourcesMeta({ previousAnswers: 80 }),
    );
    expect(at(domainRows(compared, null), 0).change).toBeNull();
    expect(at(domainRows(compared, null), 0).previousUnits).toBe(164);
    const plain = domainPage([domainRow({ domain: 'g2.com', units: 190 })]);
    expect(at(domainRows(plain, { citation_units: 1000 }), 0).change).toBeNull();
    expect(at(domainRows(plain, { citation_units: 1000 }), 0).previousUnits).toBeNull();
  });

  it('gives no change for a thin share', () => {
    const meta = sourcesMeta({ previousAnswers: 80 });
    const row = domainRow({ domain: 'g2.com', units: 3, total: 9, valid: 3, previous: { units: 1, answers: 1 } });
    expect(at(domainRows(domainPage([row], meta), { citation_units: 10 }), 0).change).toBeNull();
  });

  it('keeps the units of each engine in the order of the read', () => {
    const [row] = domainRows(
      domainPage([
        domainRow({
          domain: 'g2.com',
          units: 190,
          engines: [
            ['chatgpt_web', 120],
            ['gemini_web', 70],
          ],
        }),
      ]),
      null,
    );
    expect(row?.engines.map((engine) => [engine.engine_code, engine.citation_units])).toEqual([
      ['chatgpt_web', 120],
      ['gemini_web', 70],
    ]);
  });
});
