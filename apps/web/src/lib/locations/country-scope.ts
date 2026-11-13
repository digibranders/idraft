/**
 * The country of a page: a market the project's prompts are set in, kept in the address as two capitals
 * (`country=DE`) and sent to the reads as `filter[country_iso]`. Citations uses these; Fan-out, Competitors and
 * Overview adopt them. Prompts keeps its own copies until it is folded into these.
 */

/**
 * The country the address names: two capital letters. Anything else (a link's list of several, a lower case code)
 * reads as every country, which is `null`.
 */
export const parseCountry = (value: string | null): string | null =>
  value !== null && /^[A-Z]{2}$/.test(value) ? value : null;

/** The countries the prompts carry, once each in order, with `selected` kept even when no prompt has it. */
export function countryChoices(prompts: readonly { country_iso: string | null }[], selected: string | null): string[] {
  const isos = new Set(prompts.flatMap((prompt) => (prompt.country_iso === null ? [] : [prompt.country_iso])));
  if (selected !== null) isos.add(selected);
  return [...isos].sort();
}
