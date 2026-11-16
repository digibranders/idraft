import { isNamedCount, type Reading } from './headline-model';

/** The words of `aiOverview.headline`, as `useTranslations('aiOverview.headline')` gives them. */
export type Say = (key: string, values?: Record<string, string | number>) => string;

/** What the page needs to put a figure into words. */
export interface Words {
  say: Say;
  /** "ChatGPT" for a platform code. */
  nameOf: (code: string) => string;
  /** "ChatGPT, Gemini and AI Mode". */
  list: (names: readonly string[]) => string;
  /** A figure of the 0 to 1 scale as text. */
  formatValue: (value: number) => string;
}

/** A reading as the face of a tile: its value, what stands behind it, and the one short line that may sit under it. */
export interface Described {
  value: string;
  /** The counts or the reason, for the tooltip and for people who cannot hover; `null` when there is nothing to add. */
  tip: string | null;
  /** The reason a figure is missing, in one short line; `null` for a figure that is there. */
  note: string | null;
  /** The value is a figure. A missing one is drawn quiet: unknown is never zero. */
  known: boolean;
}

/** What stands behind a figure that is there: the platforms an average is over, or the counts of one platform. */
function basisTip(reading: Extract<Reading, { state: 'ok' }>, { say, nameOf, list }: Words): string {
  const { basis } = reading;
  if (basis.kind === 'average') {
    return say('tips.average', { used: basis.codes.length, names: list(basis.codes.map(nameOf)) });
  }
  if (basis.noun === 'namingAnswers') return say('tips.naming', { n: basis.n });
  return basis.k === null ? '' : say('tips.counts', { k: basis.k, n: basis.n });
}

export function describeReading(reading: Reading, words: Words): Described {
  const { say } = words;
  switch (reading.state) {
    case 'ok':
      return {
        value: words.formatValue(reading.value),
        tip: basisTip(reading, words) || null,
        note: null,
        known: true,
      };
    case 'insufficient': {
      const key = reading.noun === 'namingAnswers' ? 'tips.tooFewNaming' : 'tips.tooFewCount';
      return {
        value: say('notAvailable'),
        tip: isNamedCount(reading.n) ? say(key, { n: reading.n }) : say('tips.tooFew'),
        note: say('tooFew'),
        known: false,
      };
    }
    case 'none':
      return { value: say('notAvailable'), tip: say('tips.none'), note: say('tooFew'), known: false };
    case 'notCollected':
      return { value: say('notAvailable'), tip: say('tips.notCollected'), note: say('notCollected'), known: false };
    case 'noAccess':
      return { value: say('notAvailable'), tip: say('tips.noAccess'), note: say('noAccess'), known: false };
  }
}
