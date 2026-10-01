import { cleanKeyword, keywordTextProblem, normalizeKeyword, type KeywordTextProblem } from './keyword-text';

/** At most this many keywords go in one add: the API's bulk-create limit. */
export const MAX_KEYWORDS_PER_ADD = 1000;

/** One keyword of a pasted list, with the line it came from (counted from 1). */
export interface KeywordLine {
  line: number;
  keyword: string;
}

export interface KeywordLines {
  /** The keywords to send, each once in any casing, in the order first given. */
  keywords: readonly KeywordLine[];
  /** Lines that repeat an earlier keyword (in any casing) and are left out. */
  repeats: number;
  /** Lines the API would refuse, with why. */
  problems: readonly { line: number; problem: KeywordTextProblem }[];
}

/**
 * Reads a keyword list typed or pasted one per line, as the API reads each keyword: blank lines are
 * skipped, a repeat of an earlier keyword in any casing is left out, and a line the API would refuse is
 * reported with its line number.
 */
export function readKeywordLines(text: string): KeywordLines {
  const keywords: KeywordLine[] = [];
  const problems: { line: number; problem: KeywordTextProblem }[] = [];
  const seen = new Set<string>();
  let repeats = 0;
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = index + 1;
    if (cleanKeyword(raw) === '') return;
    const problem = keywordTextProblem(raw);
    if (problem !== null) {
      problems.push({ line, problem });
      return;
    }
    const identity = normalizeKeyword(raw);
    if (seen.has(identity)) {
      repeats += 1;
      return;
    }
    seen.add(identity);
    keywords.push({ line, keyword: cleanKeyword(raw) });
  });
  return { keywords, repeats, problems };
}
