import type { CitedAnswer } from './citations-model';
import { DAY_MS, runInstants } from '../prompt-fixtures';
import type { CitationOut } from '@/lib/api/types';

/** A third-party site the fixtures cite in place of the filler. */
interface FixtureSite {
  url: string;
  host: string;
  title: string;
  source_name: string;
}

/** The filler third-party source of the Fynix world (`NEWSLETTER_SITE` in ../prompt-fixtures.ts). */
export const FILLER_HOST = 'news.example.com';

/** Cited only in the newest answers, so it is new in the default window. */
export const NEWCOMER: FixtureSite = {
  url: 'https://agency-radar.example/seo-benchmarks',
  host: 'agency-radar.example',
  title: 'SEO benchmarks for agencies',
  source_name: 'Agency Radar',
};

/** Cited only in old answers, so it is lost in the default window. */
export const FADED: FixtureSite = {
  url: 'https://legacy-seo-wiki.example/link-building',
  host: 'legacy-seo-wiki.example',
  title: 'Link building wiki',
  source_name: 'Legacy SEO Wiki',
};

const isFiller = (citation: CitationOut): boolean =>
  citation.host === FILLER_HOST && citation.domain_role === 'third_party';

const swapped = (citation: CitationOut, site: FixtureSite): CitationOut => ({
  ...citation,
  url: site.url,
  raw_url: site.url,
  host: site.host,
  title: site.title,
  source_name: site.source_name,
  flags: [],
});

/**
 * The world cites every domain on every run day, so without this no source is ever new or lost (docs/16 C5, C6).
 * The filler citation of the newest answers becomes `NEWCOMER` and that of the answers 60 to 80 days back becomes
 * `FADED`: a swap inside the same answer, so no answer, unit or total changes. With the default 28 day window the
 * gap window is days 28 to 55 and the support window days 56 to 83, so the newcomer has no unit in the gap and the
 * faded one has units in the support window and none after. Relative to the newest run, so the same rows show at
 * any date; that run is also what the answers memo is keyed on.
 */
export function withChangeFixtures(answers: readonly CitedAnswer[], now: number): readonly CitedAnswer[] {
  const anchor = runInstants(now)[0] ?? now;
  const siteAt = (at: number): FixtureSite | null =>
    at >= anchor - 4 * DAY_MS ? NEWCOMER : at >= anchor - 80 * DAY_MS && at < anchor - 60 * DAY_MS ? FADED : null;
  return answers.map((answer) => {
    const site = siteAt(answer.at);
    return site === null || !answer.citations.some(isFiller)
      ? answer
      : {
          ...answer,
          citations: answer.citations.map((citation) => (isFiller(citation) ? swapped(citation, site) : citation)),
        };
  });
}
