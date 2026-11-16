import { FLOOR_OF, isNamedCount, type Reading } from './headline-model';

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
  if (basis.noun === 'orderedAnswers' || basis.noun === 'judgedMentions') {
    return say(`facts.tips.${basis.noun}`, { n: basis.n });
  }
  if (basis.k === null) return say('facts.tips.answers', { n: basis.n });
  return say('tips.counts', { k: basis.k, n: basis.n });
}

/** The words of a count that fell short of its floor, by what is counted. */
function tooFewTip(reading: Extract<Reading, { state: 'insufficient' }>, { say }: Words): string {
  const min = FLOOR_OF[reading.noun];
  if (reading.noun === 'orderedAnswers') return say('facts.tips.tooFewOrdered', { min });
  if (reading.noun === 'judgedMentions') return say('facts.tips.tooFewJudged', { n: reading.n, min });
  const key = reading.noun === 'namingAnswers' ? 'tips.tooFewNaming' : 'tips.tooFewCount';
  return isNamedCount(reading.n) ? say(key, { n: reading.n, min }) : say('tips.tooFew', { min });
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
    case 'insufficient':
      return { value: say('notAvailable'), tip: tooFewTip(reading, words), note: say('tooFew'), known: false };
    case 'notClassified':
      return {
        value: say('notAvailable'),
        tip: say('facts.tips.notClassified'),
        note: say('facts.notClassified'),
        known: false,
      };
    case 'none':
      return { value: say('notAvailable'), tip: say('tips.none'), note: say('tooFew'), known: false };
    case 'notCollected':
      return { value: say('notAvailable'), tip: say('tips.notCollected'), note: say('notCollected'), known: false };
    case 'noAccess':
      return { value: say('notAvailable'), tip: say('tips.noAccess'), note: say('noAccess'), known: false };
  }
}
