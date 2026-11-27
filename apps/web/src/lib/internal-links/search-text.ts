/** The longest search text the API takes (1 to 200 characters). */
export const MAX_SEARCH_LENGTH = 200;

/** A search as the address and the API hold it: trimmed, 1 to 200 characters, or `null` for none. */
export const searchText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, MAX_SEARCH_LENGTH);
};
