/** The fixed engine order of every list, column set and legend (SC-02). The one list. */
export const ENGINE_ORDER: readonly string[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode', 'google_ai_overview'];

/** A copy of `items` in engine order. A code that is not in the list goes last, in the order it came. */
export function byEngineOrder<T>(items: readonly T[], code: (item: T) => string): T[] {
  const rank = (item: T): number => {
    const index = ENGINE_ORDER.indexOf(code(item));
    return index === -1 ? ENGINE_ORDER.length : index;
  };
  // Array.prototype.sort is stable
  return [...items].sort((a, b) => rank(a) - rank(b));
}
