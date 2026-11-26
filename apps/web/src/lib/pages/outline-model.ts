import type { PageIssue } from './issue-source';
import type { PageOutlineBody } from '@/lib/internal-links/types';

/** How many headings the Headings block shows before "Show all". */
export const HEADINGS_FOLDED = 12;
/** The lengths of `backend/src/idraft/crawl/outline.py`, which the meters and their words use. */
export const TITLE_MIN = 30;
export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 160;
export const OUTLINE_BLOCKS = ['listing', 'headings', 'languages', 'sharing', 'structured', 'content'] as const;
export type OutlineBlockId = (typeof OUTLINE_BLOCKS)[number];
export const OUTLINE_OPEN_AT_START: readonly OutlineBlockId[] = ['listing', 'headings'];
export type OutlineTone = 'ok' | 'warning' | 'neutral';

export interface OutlineFinding {
  /** The message key under `pages.drawer.outline.finding`. */
  id: string;
  values: Record<string, string | number>;
  /** The Issues check this finding belongs to (spec 9.6.3), or null when no check covers it. */
  checkId: string | null;
}

export interface OutlineStripCell {
  id: 'h1' | 'headings' | 'words' | 'images';
  value: number | null;
  note: { id: string; values: Record<string, number> };
  warn: boolean;
}

export interface OutlineModel {
  strip: OutlineStripCell[];
  listing: { tone: OutlineTone; findings: OutlineFinding[] };
  headings: {
    tone: OutlineTone;
    findings: OutlineFinding[];
    first: PageOutlineBody['headings'];
    rest: PageOutlineBody['headings'];
    h1Text: string | null;
    capped: { shown: number; total: number } | null;
  };
}

const finding = (id: string, checkId: string | null, values: Record<string, string | number> = {}): OutlineFinding => ({
  id,
  values,
  checkId,
});

const toneOf = (findings: readonly OutlineFinding[]): OutlineTone => (findings.length === 0 ? 'ok' : 'warning');

function stripOf(outline: PageOutlineBody): OutlineStripCell[] {
  const [h1 = 0, h2 = 0, h3 = 0] = outline.level_counts;
  const { content } = outline;
  return [
    {
      id: 'h1',
      value: h1 === 0 ? null : h1,
      note: { id: h1 === 1 ? 'h1One' : h1 === 0 ? 'h1Missing' : 'h1Many', values: {} },
      warn: h1 !== 1,
    },
    { id: 'headings', value: outline.headings_total, note: { id: 'headingsNote', values: { h2, h3 } }, warn: false },
    {
      id: 'words',
      value: content.words,
      note: content.thin ? { id: 'thin', values: {} } : { id: 'readTime', values: { minutes: content.read_minutes } },
      warn: content.thin,
    },
    {
      id: 'images',
      value: content.images,
      note:
        content.images_without_alt > 0
          ? { id: 'imagesNoAlt', values: { count: content.images_without_alt } }
          : { id: 'imagesFine', values: {} },
      warn: content.images_without_alt > 0,
    },
  ];
}

function listingFindings(outline: PageOutlineBody, issues: readonly PageIssue[] | null): OutlineFinding[] {
  const found: OutlineFinding[] = [];
  const { title, description } = outline;
  if (title.state === 'missing') found.push(finding('titleMissing', 'title-missing'));
  else if (title.state === 'short') found.push(finding('titleShort', 'title-short'));
  else if (title.state === 'long') found.push(finding('titleLong', 'title-long'));
  if (description.state === 'missing') found.push(finding('descriptionMissing', 'description-missing'));
  else if (description.state === 'short') found.push(finding('descriptionShort', null));
  else if (description.state === 'long') found.push(finding('descriptionLong', null));
  // The duplicate is the Issues page's fact: without the seam nothing is invented (spec 9.6.1)
  if (issues?.some((issue) => issue.checkId === 'description-duplicate') === true) {
    found.push(finding('descriptionDuplicate', 'description-duplicate'));
  }
  if (outline.robots.noindex) found.push(finding('noindex', 'noindex'));
  if (outline.canonical.state === 'elsewhere') found.push(finding('canonicalElsewhere', 'canonical-elsewhere'));
  return found;
}

function headingFindings(outline: PageOutlineBody): OutlineFinding[] {
  const found: OutlineFinding[] = [];
  const h1 = outline.level_counts[0] ?? 0;
  if (h1 === 0) found.push(finding('h1Missing', 'h1-missing'));
  else if (h1 > 1) found.push(finding('h1Multiple', 'h1-multiple', { count: h1 }));
  const at = outline.skipped_at;
  const skipped = at === null ? undefined : outline.headings[at];
  const before = at === null ? undefined : outline.headings[at - 1];
  if (skipped !== undefined && before !== undefined) {
    found.push(finding('skippedLevel', null, { text: skipped.text, level: skipped.level, before: before.level }));
  }
  return found;
}

/** `issues` are the page's issues when the Issues seam is ready, else null (spec 9.6.1: no invented duplicate). */
export function outlineModel(outline: PageOutlineBody, issues: readonly PageIssue[] | null): OutlineModel {
  const listing = listingFindings(outline, issues);
  const headings = headingFindings(outline);
  return {
    strip: stripOf(outline),
    listing: { tone: toneOf(listing), findings: listing },
    headings: {
      tone: toneOf(headings),
      findings: headings,
      first: outline.headings.slice(0, HEADINGS_FOLDED),
      rest: outline.headings.slice(HEADINGS_FOLDED),
      h1Text: outline.headings.find((item) => item.level === 1)?.text ?? null,
      capped:
        outline.headings_total > outline.headings.length
          ? { shown: outline.headings.length, total: outline.headings_total }
          : null,
    },
  };
}
