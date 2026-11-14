const BIDI_CONTROLS = /[\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;

/**
 * Untrusted text as it is read on screen: the bidi controls (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066
 * to U+2069) are percent-encoded, so a host, a path or a chip cannot reorder what it shows ("gnp.exe" read as
 * "exe.png"). Shared by every identity cell, so none of them imports another.
 */
export function visibleUrlText(text: string): string {
  return text.replace(BIDI_CONTROLS, (control) => encodeURIComponent(control));
}
