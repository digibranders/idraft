/**
 * The glossary guard: finds banned words in the visible text of an ICU message. The word list is
 * `docs/glossary/banned-words.json`, the machine copy of `docs/glossary/terms.md`.
 */

export interface BannedWord {
  readonly id: string;
  readonly pattern: string;
  readonly flags: string;
  readonly use: string;
}

export interface GuardException {
  readonly word: string;
  readonly key: string;
  readonly reason: string;
}

export interface GlossaryViolation {
  readonly key: string;
  readonly word: string;
  readonly use: string;
  readonly text: string;
}

/**
 * The text a reader sees: ICU variables and plural or select syntax are removed, and the text inside every
 * plural or select branch is kept (so "{n, plural, one {# group} other {# groups}}" yields "# group # groups").
 */
export function visibleText(message: string): string {
  let i = 0;

  function parseMessage(insideBranch: boolean): string {
    let out = '';
    while (i < message.length) {
      const c = message.charAt(i);
      if (c === '{') {
        i += 1;
        out += parseArgument();
      } else if (c === '}' && insideBranch) {
        return out;
      } else {
        out += c;
        i += 1;
      }
    }
    return out;
  }

  function readUntil(stops: string): string {
    let text = '';
    while (i < message.length && !stops.includes(message.charAt(i))) {
      text += message.charAt(i);
      i += 1;
    }
    return text;
  }

  function parseArgument(): string {
    readUntil(',}');
    if (message.charAt(i) === '}') {
      i += 1;
      return '';
    }
    i += 1;
    const type = readUntil(',}').trim();
    if (message.charAt(i) === '}') {
      i += 1;
      return '';
    }
    i += 1;
    if (type !== 'plural' && type !== 'select' && type !== 'selectordinal') {
      readUntil('}');
      i += 1;
      return '';
    }
    let out = '';
    while (i < message.length && message.charAt(i) !== '}') {
      while (i < message.length && /\s/.test(message.charAt(i))) i += 1;
      if (message.charAt(i) === '}') break;
      const label = readUntil('{} \t\n');
      while (i < message.length && /\s/.test(message.charAt(i))) i += 1;
      if (label.startsWith('offset:')) continue;
      if (message.charAt(i) === '{') {
        i += 1;
        out += ` ${parseMessage(true)} `;
        if (message.charAt(i) === '}') i += 1;
      }
    }
    if (message.charAt(i) === '}') i += 1;
    return out;
  }

  return parseMessage(false).replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
}

/** Every banned word found in one message, minus the listed exceptions. */
export function findViolations(
  key: string,
  message: string,
  words: readonly BannedWord[],
  exceptions: readonly GuardException[],
): GlossaryViolation[] {
  const text = visibleText(message);
  const found: GlossaryViolation[] = [];
  for (const word of words) {
    if (!new RegExp(word.pattern, word.flags).test(text)) continue;
    const allowed = exceptions.some((e) => e.word === word.id && (key === e.key || key.startsWith(e.key)));
    if (!allowed) found.push({ key, word: word.id, use: word.use, text: message });
  }
  return found;
}

/** Flattens a nested messages object to `{ "a.b.c": "text" }`. */
export function flattenMessages(tree: unknown, prefix = ''): Record<string, string> {
  const flat: Record<string, string> = {};
  if (typeof tree === 'string') {
    flat[prefix] = tree;
  } else if (tree !== null && typeof tree === 'object') {
    for (const [name, value] of Object.entries(tree as Record<string, unknown>)) {
      Object.assign(flat, flattenMessages(value, prefix === '' ? name : `${prefix}.${name}`));
    }
  }
  return flat;
}
