import { expect, test } from '@playwright/test';

import { COLUMN_TYPES, type ColumnType } from '../../src/lib/tables/column-types';
import { waitForContent } from '../support';

/**
 * The table house style as a real browser draws it (owner decisions of 2026-10-29): jsdom has no stylesheet, so
 * the utilities themselves are checked here, on the design-system gallery's sample tables.
 */
test.describe('the table house style', () => {
  test('draws 12 / 16 px text, capital 0.04em headers, 32 px rows, left aligned data and right aligned actions', async ({
    page,
  }) => {
    await page.goto('/design-system/tables');
    await waitForContent(page);
    const grid = page.getByRole('grid', { name: 'Keywords, client mode' });
    await expect(grid).toBeVisible();

    const label = grid.locator('thead th span.type-table-header', { hasText: 'Volume' });
    const header = await label.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        size: style.fontSize,
        line: style.lineHeight,
        transform: style.textTransform,
        spacing: style.letterSpacing,
      };
    });
    expect(header).toEqual({ size: '12px', line: '16px', transform: 'uppercase', spacing: '0.48px' });

    const row = grid.locator('tbody tr[role="row"]').first();
    expect((await row.boundingBox())?.height).toBe(32);
    const cells = await row.locator('td, th').evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return { size: style.fontSize, line: style.lineHeight, align: style.textAlign };
      }),
    );
    // However many columns the viewport shows: the checkbox centered, the row actions last and right aligned,
    // and every data column between them, the numeric ones too, left aligned
    expect(cells.length).toBeGreaterThanOrEqual(4);
    expect(cells.every((cell) => cell.size === '12px' && cell.line === '16px')).toBe(true);
    expect(cells.map((cell) => cell.align)).toEqual([
      'center',
      ...Array<string>(cells.length - 2).fill('left'),
      'right',
    ]);
  });

  /**
   * What a sorted header (the label in capitals, a 14 px arrow, 4 px gap, 12 px padding each side) needs, measured
   * with the app's own utilities. A column type's minimum width has to hold the longest label it carries.
   */
  const LABELS: readonly [ColumnType, string][] = [
    ['keyword', 'Keyword'],
    ['text', 'Group'],
    ['count', 'KD'],
    ['count', 'Priority'],
    ['volume', 'Volume'],
    ['currency', 'CPC (USD)'],
    ['date', 'Finished'],
    ['badge', 'Intent'],
    ['status', 'Status'],
    ['rank', 'Rank'],
    ['rankDelta', 'Change'],
    ['url', 'Ranking URL'],
  ];

  test('a capital header label stays whole at the minimum width of its column type', async ({ page }) => {
    await page.goto('/design-system/tables');
    await waitForContent(page);
    const needs = await page.evaluate(
      (labels) => {
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden';
        document.body.append(host);
        const result: number[] = [];
        for (const label of labels) {
          const box = document.createElement('div');
          box.style.cssText = 'box-sizing:border-box;padding:0 12px;border-right:1px solid;width:max-content';
          box.innerHTML = `<span class="flex items-center gap-1"><span class="type-table-header whitespace-nowrap">${label}</span><svg class="shrink-0 size-icon-sm" viewBox="0 0 24 24"></svg></span>`;
          host.append(box);
          result.push(Math.ceil(box.getBoundingClientRect().width));
        }
        host.remove();
        return result;
      },
      LABELS.map(([, label]) => label),
    );
    LABELS.forEach(([type, label], index) => {
      const need = needs[index] ?? Number.POSITIVE_INFINITY;
      expect(COLUMN_TYPES[type].min, `${label} needs ${String(need)} px in a ${type} column`).toBeGreaterThanOrEqual(
        need,
      );
    });
  });
});
