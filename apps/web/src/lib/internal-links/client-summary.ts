import { formatDecimal, formatInteger, formatPercent } from '@/lib/format';

import { alertTierText, type TierRangeWords } from './changes-format';

/** Everything the client summary says, from the message catalog, so no copy lives in this module. */
export interface ClientSummaryWords extends TierRangeWords {
  title: (host: string) => string;
  crawlLine: (when: string, pages: string) => string;
  tiersHeading: string;
  tiersHead: readonly [string, string, string, string];
  flowHeading: string;
  flowNote: string;
  flowFrom: string;
  flowTo: (code: string) => string;
  worklistsHeading: string;
  worklistsHead: readonly [string, string];
  worklistsNone: string;
  lostHeading: (tiers: string) => string;
  lostHead: readonly [string, string, string];
  lostNone: (tiers: string) => string;
  /** "Plus 3 more." for the links over the cap. */
  lostMore: (count: string) => string;
  footer: string;
  notAvailable: string;
}

/** Plain data the page already holds. Link counts are editorial links; no equity figure is part of it. */
export interface ClientSummaryInput {
  host: string;
  crawledOn: string;
  pages: number;
  tiers: { label: string; code: string; pages: number; depth: number | null }[];
  /** `matrix[from][to]` in the order of `tiers`. */
  matrix: number[][];
  worklists: { label: string; count: number }[];
  lost: { from: string; to: string; anchor: string }[];
  /** The deepest tier position counted as important (2 is "T1 and T2"). */
  importantMaxPosition: number;
  /** Language of the page, as the catalog locale; English when absent. */
  locale?: string;
}

/** The lost links the page lists; the rest is one line. */
export const MAX_LOST_LINKS = 100;

const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value: string): string => value.replace(/[&<>"']/g, (char) => escapes[char] ?? char);

/* eslint-disable no-restricted-syntax -- the downloaded file is read outside the app, where no token exists: spec 7.10 asks for literal colours */
const RULE = '#d4d4d8';
const RULE_SUBTLE = '#e4e4e7';
const SURFACE = '#f4f4f5';
const TEXT = '#18181b';
const MUTED_TEXT = '#52525b';
/* eslint-enable no-restricted-syntax */

const WRAP = 'overflow-wrap:anywhere';
const TH = `border-bottom:1px solid ${RULE};padding:6px 10px;text-align:left;font-weight:600;background:${SURFACE};${WRAP}`;
const TD = `border-bottom:1px solid ${RULE_SUBTLE};padding:6px 10px;${WRAP}`;
const MUTED = `color:${MUTED_TEXT}`;

// Rows stay whole and the header repeats on every printed page.
const PRINT_CSS = '@media print{tr{page-break-inside:avoid}thead{display:table-header-group}}';

const table = (head: readonly string[], rows: readonly (readonly string[])[]): string =>
  `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:14px;margin:8px 0 24px"><thead><tr>${head
    .map((cell) => `<th style="${TH}">${esc(cell)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td style="${TD}">${esc(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;

const heading = (text: string): string => `<h2 style="font-size:18px;margin:24px 0 4px">${esc(text)}</h2>`;
const note = (text: string): string => `<p style="margin:0;${MUTED}">${esc(text)}</p>`;

/** A self-contained report for a client (spec 7.10): inline styles, no script, no external file. */
export function clientSummaryHtml(input: ClientSummaryInput, words: ClientSummaryWords): string {
  const title = words.title(input.host);
  const important = alertTierText(input.importantMaxPosition, words);
  const tierPages = input.tiers.reduce((sum, tier) => sum + tier.pages, 0);
  const tierRows = input.tiers.map((tier) => [
    tier.label,
    formatInteger(tier.pages),
    formatPercent(tierPages === 0 ? 0 : tier.pages / tierPages),
    tier.depth === null ? words.notAvailable : formatDecimal(tier.depth, 1),
  ]);
  const matrixRows = input.tiers.map((tier, from) => [
    tier.code,
    ...input.tiers.map((_, to) => formatInteger(input.matrix[from]?.[to] ?? 0)),
  ]);
  const open = input.worklists.filter((list) => list.count > 0).map((list) => [list.label, formatInteger(list.count)]);
  const lost = input.lost.slice(0, MAX_LOST_LINKS).map((link) => [link.from, link.to, link.anchor]);
  const more = input.lost.length - lost.length;

  return `<!doctype html><html lang="${esc(input.locale ?? 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head>
<body style="font-family:system-ui,sans-serif;color:${TEXT};max-width:880px;margin:32px auto;padding:0 16px;line-height:1.5">
<h1 style="font-size:24px;margin:0 0 4px;${WRAP}">${esc(title)}</h1>
${note(words.crawlLine(input.crawledOn, formatInteger(input.pages)))}
${heading(words.tiersHeading)}${table(words.tiersHead, tierRows)}
${heading(words.flowHeading)}${note(words.flowNote)}${table(
    [words.flowFrom, ...input.tiers.map((tier) => words.flowTo(tier.code))],
    matrixRows,
  )}
${heading(words.worklistsHeading)}${open.length > 0 ? table(words.worklistsHead, open) : `<p style="${MUTED}">${esc(words.worklistsNone)}</p>`}
${heading(words.lostHeading(important))}${lost.length > 0 ? table(words.lostHead, lost) : `<p style="${MUTED}">${esc(words.lostNone(important))}</p>`}${more > 0 ? `<p style="${MUTED}">${esc(words.lostMore(formatInteger(more)))}</p>` : ''}
<p style="margin:32px 0 0;padding-top:12px;border-top:1px solid ${RULE};${MUTED};font-size:13px">${esc(words.footer)}</p>
</body></html>`;
}
