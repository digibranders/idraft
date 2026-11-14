import { escapeHtml } from './category-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';

/**
 * The row and the title of every chart tooltip (15-data-visualization.md section 4): an 8 px dot in the series
 * colour, the name in the secondary colour, the value right-aligned with tabular figures. Every string that
 * reaches the markup is escaped, so a series name or a value from the API is never HTML.
 */
export function tipRowHtml(color: string, name: string, valueText: string, tokens: ChartTokens): string {
  return `<div style="display:flex;gap:8px;align-items:center"><span style="width:8px;height:8px;border-radius:50%;background:${escapeHtml(color)}"></span><span style="color:${escapeHtml(tokens.foregroundSecondary)}">${escapeHtml(name)}</span><span style="margin-left:auto;font-variant-numeric:tabular-nums">${escapeHtml(valueText)}</span></div>`;
}

export function tipTitleHtml(title: string): string {
  return `<div style="font-size:14px;line-height:20px;font-weight:600;margin-bottom:4px">${escapeHtml(title)}</div>`;
}
