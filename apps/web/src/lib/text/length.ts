/**
 * The length the API counts for a text limit: characters (code points), as Python's `len` does, not UTF-16
 * units, so an emoji is one character, not two.
 */
export const textLength = (text: string): number => [...text].length;
