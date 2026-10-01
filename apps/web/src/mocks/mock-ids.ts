/**
 * Ids of the mocks' own rows. Every id the mocks make is a valid hyphenated UUID (the app's routes check
 * `isUuid`) that carries its kind and a number, so a cookie can keep the number alone. The fixtures use
 * numbers below `FIRST_MINTED`; rows created in a browser count up from it.
 */

export type IdKind =
  | 'entity'
  | 'alias'
  | 'domain'
  | 'vocabulary'
  | 'term'
  | 'keyword'
  | 'tracked'
  | 'group'
  | 'schedule'
  | 'run'
  | 'import';

/** One hexadecimal digit per kind, so the id stays a UUID. */
const KIND_DIGIT: Readonly<Record<IdKind, string>> = {
  entity: '1',
  alias: '2',
  domain: '3',
  vocabulary: '4',
  term: '5',
  keyword: '6',
  tracked: '7',
  group: '8',
  schedule: '9',
  run: 'a',
  import: 'b',
};

/** The first number a browser's rows get; the fixtures stay below it. */
export const FIRST_MINTED = 100;
const MAX_NUMBER = 999_999_999_999;

/** `0192d1a8-e00K-7a10-8e0K-NNNNNNNNNNNN`: K is the kind, N the number. */
export function mockId(kind: IdKind, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER) throw new Error(`Not a mock id number: ${String(n)}`);
  const digit = KIND_DIGIT[kind];
  return `0192d1a8-e00${digit}-7a10-8e0${digit}-${String(n).padStart(12, '0')}`;
}

/** The number of a mock id of `kind`, or `null` for any other id. */
export function mockIdNumber(id: string, kind: IdKind): number | null {
  const digit = KIND_DIGIT[kind];
  const found = new RegExp(`^0192d1a8-e00${digit}-7a10-8e0${digit}-(\\d{12})$`).exec(id);
  const n = found?.[1] === undefined ? Number.NaN : Number(found[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}
