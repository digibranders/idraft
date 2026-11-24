import { normalizeDomain, type DomainProblem } from '@/lib/domains/normalize';
import { textLength } from '@/lib/text/length';

/** The API's limit on a canonical name. */
export const MAX_NAME_LENGTH = 200;
/** Lines read from one paste: a longer list is cut here and says so. */
export const MAX_PASTED = 50;

/** "Hubspot" from "hubspot.com": the first label of the host, as a starting point the person corrects. */
export function nameFromDomain(domain: string): string {
  const label = domain.split('.')[0] ?? '';
  return label === '' ? '' : `${label.charAt(0).toLocaleUpperCase()}${label.slice(1)}`;
}

/** A competitor read from one line of the pasted list. */
export interface PastedRow {
  /** The line of the paste, from 1. */
  line: number;
  /** The host the API compares. */
  domain: string;
  /** The same host to show. */
  display: string;
  name: string;
  /** The line as it was pasted, for pasting it again after a failure. */
  text: string;
}

export type PasteProblem =
  | { kind: 'format' }
  | { kind: 'domain'; code: DomainProblem }
  | { kind: 'nameTooLong' }
  | { kind: 'duplicate' }
  | { kind: 'alreadyTracked' }
  | { kind: 'tooMany' };

/** A line that is not added, and why. */
export interface PastedIssue {
  line: number;
  text: string;
  problem: PasteProblem;
}

export interface PasteReading {
  rows: PastedRow[];
  issues: PastedIssue[];
}

/** What a line says: a site alone, or a name and a site in either order. */
function readParts(parts: readonly string[]): { domain: string; name: string | null } | PasteProblem {
  const [first = '', second] = parts;
  if (parts.length === 1) return { domain: first, name: null };
  if (parts.length !== 2 || second === undefined) return { kind: 'format' };
  // The part that is a site is the domain; with two sites, the first is the name's place only when it is not one
  if (normalizeDomain(second).ok) return { domain: second, name: first };
  return { domain: first, name: second };
}

/**
 * Reads a pasted list of competitors, one for each line: `hubspot.com`, `HubSpot, hubspot.com` or `hubspot.com | HubSpot`
 * (a comma, a tab or a bar between the parts). Blank lines are skipped. A line that is no competitor, or that repeats a
 * site of the list or one in `taken` (the normalized hosts the project already has), is an issue and is not added.
 */
export function readCompetitorList(text: string, taken: ReadonlySet<string>): PasteReading {
  const rows: PastedRow[] = [];
  const issues: PastedIssue[] = [];
  const seen = new Set<string>();
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = index + 1;
    const content = raw.trim();
    if (content === '') return;
    const refuse = (problem: PasteProblem): void => void issues.push({ line, text: content, problem });
    if (rows.length >= MAX_PASTED) return refuse({ kind: 'tooMany' });
    const read = readParts(
      content
        .split(/[\t,|]/)
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    );
    if ('kind' in read) return refuse(read);
    const normalized = normalizeDomain(read.domain);
    if (!normalized.ok) return refuse({ kind: 'domain', code: normalized.code });
    const name = read.name ?? nameFromDomain(normalized.display);
    if (textLength(name) > MAX_NAME_LENGTH) return refuse({ kind: 'nameTooLong' });
    if (taken.has(normalized.domain)) return refuse({ kind: 'alreadyTracked' });
    if (seen.has(normalized.domain)) return refuse({ kind: 'duplicate' });
    seen.add(normalized.domain);
    rows.push({ line, domain: normalized.domain, display: normalized.display, name, text: content });
  });
  return { rows, issues };
}
