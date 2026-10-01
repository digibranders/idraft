/** The API's limit on a target URL (`TrackedKeywordPatch.target_url`). */
export const MAX_URL_LENGTH = 2048;

/** Whether `text` reads as an http or https address, as the API requires of a target URL (`invalid_url`). */
export function isWebUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
