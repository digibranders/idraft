import type { PageOutline, PageOutlineBody, PageRow } from '@/lib/internal-links/types';

/**
 * The outline of one page as the mock reads it from the stored HTML of the latest crawl (contract C6). Nothing is
 * random: the same row always gives the same outline. The limits are those of `backend/src/idraft/crawl/outline.py`.
 */

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 160;
const THIN_WORDS = 200;
const WORDS_PER_MINUTE = 230;
const DESCRIPTION_CHARS = 120;

/*
 * Three live pages of the fixture crawl that no existing test opens (/blog/threat-report-2022, /about and
 * /compare/eventus-vs-in-house-soc), each with a fixed outline so every state of the tab can be opened.
 */
/** Url id of a live page: 14 headings. */
export const OUTLINE_LONG_PAGE = '118';
/** Url id of a live page: one finding of every kind. */
export const OUTLINE_PROBLEM_PAGE = '116';
/** Url id of a live page whose HTML was not kept. */
export const OUTLINE_NO_HTML_PAGE = '115';

type Heading = PageOutlineBody['headings'][number];
type TextState = PageOutlineBody['title']['state'];

function lengthState(chars: number, low: number, high: number): TextState {
  if (chars <= 0) return 'missing';
  if (chars < low) return 'short';
  return chars > high ? 'long' : 'ok';
}

const textOf = (text: string, low: number, high: number): PageOutlineBody['title'] => {
  const trimmed = text.trim();
  return {
    text: trimmed === '' ? null : trimmed,
    chars: trimmed.length,
    state: lengthState(trimmed.length, low, high),
  };
};

const levelCounts = (headings: readonly Heading[]): number[] =>
  [1, 2, 3, 4, 5, 6].map((level) => headings.filter((heading) => heading.level === level).length);

const readMinutes = (words: number): number =>
  Math.max(1, Math.floor((words + WORDS_PER_MINUTE / 2) / WORDS_PER_MINUTE));

/** A description of exactly 120 characters made by repeating the title. */
function descriptionOf(title: string): string {
  let text = '';
  while (text.length < DESCRIPTION_CHARS) text += `${title}. `;
  return `${text.slice(0, DESCRIPTION_CHARS - 1)}.`;
}

const heading = (level: number, text: string): Heading => ({ level, text });

/** The headings of a plain page: the title, then four sections. */
const plainHeadings = (title: string): Heading[] => [
  heading(1, title),
  heading(2, 'Overview'),
  heading(2, 'How it works'),
  heading(2, 'What you get'),
  heading(2, 'Talk to us'),
];

const LONG_HEADINGS: readonly Heading[] = [
  heading(1, 'Eventus vs an in-house SOC'),
  heading(2, 'Cost'),
  heading(3, 'Staffing'),
  heading(3, 'Tooling'),
  heading(2, 'Coverage'),
  heading(3, 'Nights and weekends'),
  heading(3, 'Holidays'),
  heading(2, 'Skills'),
  heading(3, 'Threat hunting'),
  heading(3, 'Incident response'),
  heading(2, 'Speed'),
  heading(3, 'Time to detect'),
  heading(3, 'Time to respond'),
  heading(2, 'Which one to choose'),
];

function bodyOf(row: PageRow): PageOutlineBody {
  const title = row.title ?? '';
  const description = descriptionOf(title);
  const base: PageOutlineBody = {
    url: row.url,
    truncated: false,
    title: textOf(title, TITLE_MIN, TITLE_MAX),
    description: textOf(description, DESCRIPTION_MIN, DESCRIPTION_MAX),
    canonical: { state: 'self', href: row.url },
    robots: { meta: row.is_indexable ? 'index, follow' : 'noindex, follow', noindex: !row.is_indexable },
    html_lang: 'en',
    headings: plainHeadings(title),
    headings_total: 5,
    level_counts: [1, 4, 0, 0, 0, 0],
    skipped_at: null,
    languages: { x_default: false, pairs: [] },
    social: {
      og_title: title,
      og_description: description,
      og_image: `${new URL(row.url).origin}/og/default.png`,
      og_type: 'website',
      twitter_card: 'summary_large_image',
    },
    structured_data: [{ types: ['WebPage'], parses: true }],
    content: { words: 640, read_minutes: readMinutes(640), thin: false, images: 4, images_without_alt: 0 },
  };
  if (row.url_id === OUTLINE_LONG_PAGE) {
    return {
      ...base,
      headings: [...LONG_HEADINGS],
      headings_total: LONG_HEADINGS.length,
      level_counts: levelCounts(LONG_HEADINGS),
    };
  }
  if (row.url_id === OUTLINE_PROBLEM_PAGE) {
    // No H1, no description, one language pair that is not valid, no og:title, one block that does not parse, thin
    const headings = [heading(2, 'Who we are'), heading(2, 'Our team')];
    return {
      ...base,
      description: textOf('', DESCRIPTION_MIN, DESCRIPTION_MAX),
      headings,
      headings_total: headings.length,
      level_counts: levelCounts(headings),
      languages: {
        x_default: false,
        pairs: [{ code: 'en-UK', href: `${row.url}/uk`, is_self: false, valid: false, suggestion: 'en-GB' }],
      },
      social: { ...base.social, og_title: null },
      structured_data: [{ types: [], parses: false }],
      content: { words: 120, read_minutes: readMinutes(120), thin: 120 < THIN_WORDS, images: 3, images_without_alt: 1 },
    };
  }
  return base;
}

export function outlineOf(row: PageRow, runId: string): PageOutline {
  const answer = (state: PageOutline['state'], outline: PageOutlineBody | null): PageOutline => ({
    state,
    run_id: runId,
    status_code: row.status_code,
    outline,
  });
  const status = row.status_code;
  if (status !== null && status >= 300 && status < 400) return answer('redirect', null);
  if (status !== 200) return answer('error', null);
  if (row.resource_type !== 'html') return answer('not_html', null);
  if (row.url_id === OUTLINE_NO_HTML_PAGE) return answer('no_html', null);
  return answer('ok', bodyOf(row));
}
