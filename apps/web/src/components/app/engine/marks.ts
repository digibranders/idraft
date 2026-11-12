// The only importer of @lobehub/icons-static-svg in the app (ADR-DS-020 rule 2): three files, never recoloured.
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg';
import google from '@lobehub/icons-static-svg/icons/google-color.svg';
import openai from '@lobehub/icons-static-svg/icons/openai.svg';

export interface EngineMark {
  src: string;
  /** The monochrome OpenAI mark: black in the light theme, inverted to white in the dark theme. */
  followsText: boolean;
}

/**
 * The URL of an imported SVG. Next types the import as `any` and gives `{ src }`; Vitest gives the URL string.
 * The value is `unknown` from the start, so no `any` reaches the rest of the app.
 */
export function markSrc(asset: unknown): string {
  if (typeof asset === 'string') return asset;
  if (typeof asset === 'object' && asset !== null && 'src' in asset && typeof asset.src === 'string') return asset.src;
  throw new Error('Unexpected SVG import shape');
}

// Both Google surfaces use the Google mark: neither has a mark of its own (07-icons.md section 5, rule 4)
const MARKS: Readonly<Record<string, EngineMark>> = {
  chatgpt_web: { src: markSrc(openai), followsText: true },
  gemini_web: { src: markSrc(gemini), followsText: false },
  google_ai_mode: { src: markSrc(google), followsText: false },
  google_ai_overview: { src: markSrc(google), followsText: false },
};

/** The mark of an engine code, or `null` for a code without one (it shows its name alone). */
export function engineMark(engine: string): EngineMark | null {
  return Object.hasOwn(MARKS, engine) ? (MARKS[engine] ?? null) : null;
}
