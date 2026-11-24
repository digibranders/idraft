import { RECIPIENTS_MAX } from '@/lib/reports/types';

/** What is wrong with the recipients a person typed; `null` when they are fine. */
export type RecipientsProblem = { kind: 'empty' } | { kind: 'tooMany' } | { kind: 'invalid'; address: string };

export interface ParsedRecipients {
  addresses: string[];
  problem: RecipientsProblem | null;
}

// One @, no spaces and no characters a header could be split at; the API checks the same
const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * The addresses of a text of recipients, one to ten, separated by new lines, spaces, commas or semicolons. They are
 * lower-cased and listed once each, in the order given, as the API keeps them.
 */
export function parseRecipients(text: string): ParsedRecipients {
  const addresses = [...new Set(text.split(/[\s,;]+/).flatMap((part) => (part === '' ? [] : [part.toLowerCase()])))];
  if (addresses.length === 0) return { addresses, problem: { kind: 'empty' } };
  if (addresses.length > RECIPIENTS_MAX) return { addresses, problem: { kind: 'tooMany' } };
  const bad = addresses.find((address) => !ADDRESS.test(address));
  return { addresses, problem: bad === undefined ? null : { kind: 'invalid', address: bad } };
}
