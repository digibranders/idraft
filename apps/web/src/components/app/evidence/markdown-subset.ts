import { webHref } from '@/lib/format';

/**
 * A small subset of Markdown, read into a tree of plain data for `SafeMarkdown` (23-application-patterns.md section
 * 5.6). An answer is collected text from the outside, so this is not a Markdown library: it knows headings,
 * paragraphs, lists, fenced code, bold, italic, inline code and links, and shows everything else as the text it is.
 * HTML is text, an image is its alt text, a table is its rows, and a link whose address is not http, https or mailto
 * (or has a user name or a password in it) is its label. It never builds markup: the tree holds strings, and the
 * renderer puts them in as React text.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong' | 'em'; children: readonly Inline[] }
  | { kind: 'code'; text: string }
  /** `href` has passed `safeHref`. */
  | { kind: 'link'; href: string; children: readonly Inline[] };

export interface ListItem {
  /** 0 to 2: how far the item is indented, which a flat list shows as an indent. */
  depth: number;
  children: readonly Inline[];
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: readonly Inline[] }
  | { kind: 'paragraph'; children: readonly Inline[] }
  | { kind: 'list'; ordered: boolean; items: readonly ListItem[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

/** Nesting of emphasis and links beyond this is text, so a hostile string cannot recurse without end. */
const MAX_DEPTH = 6;
/** A label, an address and an emphasis span longer than this are not read as one: the scan never runs on. */
const MAX_LABEL = 2000;
const MAX_DESTINATION = 2000;
const MAX_SPAN = 2000;
const MAX_INDENT_DEPTH = 2;

/**
 * `raw` when it may be a link's `href`: an http or https address with no user name or password (`webHref`), or a
 * mailto address that starts at its first character. Anything else, a script or data scheme, a relative address or
 * text that is no address, is `null`. It is never decoded first, so an entity-encoded scheme is no scheme at all.
 */
export function safeHref(raw: string): string | null {
  const web = webHref(raw);
  if (web !== null) return web;
  // No space or control character anywhere, and nothing that could end an attribute or open a tag
  const clean = ![...raw].some((char) => /\s/.test(char) || char.charCodeAt(0) < 0x20 || '<>"'.includes(char));
  return clean && /^mailto:./i.test(raw) ? raw : null;
}

const isSpace = (char: string | undefined): boolean => char === undefined || /\s/.test(char);
const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char);
const unescapeMarkdown = (text: string): string => text.replace(/\\([!-/:-@[-`{-~])/g, '$1');

interface LinkAt {
  label: string;
  destination: string;
  end: number;
}

/** The `[label](destination "title")` that starts at `start`, or `null` when what is there is not one. */
function linkAt(text: string, start: number): LinkAt | null {
  let depth = 0;
  let at = start;
  const limit = Math.min(text.length, start + MAX_LABEL);
  for (; at < limit; at += 1) {
    const char = text[at];
    if (char === '\\') at += 1;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (at >= limit || text[at] !== ']' || text[at + 1] !== '(') return null;
  const label = text.slice(start + 1, at);
  let cursor = at + 2;
  while (text[cursor] === ' ' || text[cursor] === '\t' || text[cursor] === '\n') cursor += 1;
  let destination: string;
  if (text[cursor] === '<') {
    const close = text.indexOf('>', cursor + 1);
    const inner = close === -1 ? '' : text.slice(cursor + 1, close);
    if (close === -1 || /[\n<]/.test(inner) || inner.length > MAX_DESTINATION) return null;
    destination = inner;
    cursor = close + 1;
  } else {
    const first = cursor;
    let open = 0;
    for (; cursor < text.length && cursor - first <= MAX_DESTINATION; cursor += 1) {
      const char = text[cursor] ?? '';
      if (char === '\\') cursor += 1;
      else if (char === '(') open += 1;
      else if (char === ')') {
        if (open === 0) break;
        open -= 1;
      } else if (/\s/.test(char) || char.charCodeAt(0) < 0x20) break;
    }
    destination = unescapeMarkdown(text.slice(first, cursor));
  }
  while (text[cursor] === ' ' || text[cursor] === '\t' || text[cursor] === '\n') cursor += 1;
  // An optional title, which is read and dropped
  const quote = text[cursor];
  if (quote === '"' || quote === "'" || quote === '(') {
    const close = text.indexOf(quote === '(' ? ')' : quote, cursor + 1);
    if (close === -1 || close - cursor > MAX_LABEL) return null;
    cursor = close + 1;
    while (text[cursor] === ' ' || text[cursor] === '\t' || text[cursor] === '\n') cursor += 1;
  }
  return text[cursor] === ')' ? { label, destination, end: cursor + 1 } : null;
}

/** The end of a code span that opens with a run of `run` backticks at `start`, or -1. */
function codeSpanEnd(text: string, start: number, run: number): number {
  const fence = '`'.repeat(run);
  let at = text.indexOf(fence, start + run);
  while (at !== -1) {
    if (at - start > MAX_SPAN) return -1;
    if (text[at + run] !== '`' && text[at - 1] !== '`') return at;
    at = text.indexOf(fence, at + 1);
  }
  return -1;
}

/** The closer of an emphasis that opens at `start` with `marker`, or -1. */
function emphasisEnd(text: string, start: number, marker: string): number {
  const open = start + marker.length;
  let at = text.indexOf(marker, open + 1);
  while (at !== -1 && at - start <= MAX_SPAN) {
    const before = text[at - 1];
    const after = text[at + marker.length];
    const sameAround = marker.length === 1 && (before === marker || after === marker);
    const intraword = marker[0] === '_' && isWordChar(after);
    if (!isSpace(before) && !sameAround && !intraword) return at;
    at = text.indexOf(marker, at + 1);
  }
  return -1;
}

export function parseInline(text: string, depth = 0, links = true): Inline[] {
  const out: Inline[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain !== '') out.push({ kind: 'text', text: plain });
    plain = '';
  };
  let at = 0;
  while (at < text.length) {
    const char = text[at] ?? '';
    if (char === '\\' && /[!-/:-@[-`{-~]/.test(text[at + 1] ?? '')) {
      plain += text[at + 1] ?? '';
      at += 2;
      continue;
    }
    if (char === '`') {
      let run = 1;
      while (text[at + run] === '`') run += 1;
      const end = codeSpanEnd(text, at, run);
      if (end === -1) {
        plain += '`'.repeat(run);
        at += run;
      } else {
        flush();
        const inner = text.slice(at + run, end);
        out.push({ kind: 'code', text: /^ .*[^ ].* $/s.test(inner) ? inner.slice(1, -1) : inner });
        at = end + run;
      }
      continue;
    }
    // An image is dropped: only its alt text stays, as text
    if (char === '!' && text[at + 1] === '[') {
      const found = linkAt(text, at + 1);
      if (found !== null) {
        plain += found.label;
        at = found.end;
        continue;
      }
    }
    if (char === '[' && depth < MAX_DEPTH) {
      const found = linkAt(text, at);
      if (found !== null) {
        flush();
        const href = links ? safeHref(found.destination) : null;
        const children = parseInline(found.label, depth + 1, false);
        if (href === null) out.push(...children);
        else out.push({ kind: 'link', href, children });
        at = found.end;
        continue;
      }
    }
    if ((char === '*' || char === '_') && depth < MAX_DEPTH) {
      const marker = text[at + 1] === char ? char + char : char;
      const opens = !isSpace(text[at + marker.length]) && !(char === '_' && isWordChar(text[at - 1]));
      const end = opens ? emphasisEnd(text, at, marker) : -1;
      if (end === -1) {
        plain += marker;
        at += marker.length;
      } else {
        flush();
        out.push({
          kind: marker.length === 2 ? 'strong' : 'em',
          children: parseInline(text.slice(at + marker.length, end), depth + 1, links),
        });
        at = end + marker.length;
      }
      continue;
    }
    plain += char;
    at += 1;
  }
  flush();
  return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_OPEN = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

/**
 * The level and text of an ATX heading line (`## Title ##`), or `null`. The text loses its trailing white space and a
 * closing run of hashes that follows white space. Both are cut from the end by hand: a regular expression for the tail
 * backtracks over a long run of spaces and takes quadratic time on a hostile line.
 */
function headingOf(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const open = HEADING_OPEN.exec(line);
  if (open === null) return null;
  const level = Math.min(6, (open[1] ?? '#').length) as 1 | 2 | 3 | 4 | 5 | 6;
  const text = (open[2] ?? '').trimEnd();
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end -= 1;
  const closed = end < text.length && end > 0 && /[ \t]/.test(text[end - 1] ?? '');
  return { level, text: closed ? text.slice(0, end).trimEnd() : text };
}

const startsBlock = (line: string): boolean =>
  FENCE.test(line) || headingOf(line) !== null || RULE.test(line) || ITEM.test(line);

/** The source as blocks. Never throws, and reads every line: what is not a block of the subset is a paragraph. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? '';
    if (line.trim() === '') {
      at += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null) {
      const mark = fence[1] ?? '```';
      // The block ends at a line of the same fence character, at least as long, or at the end of the text
      const closing = new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${String(mark.length)},}[ \\t]*$`);
      const body: string[] = [];
      at += 1;
      while (at < lines.length && !closing.test(lines[at] ?? '')) {
        body.push(lines[at] ?? '');
        at += 1;
      }
      at += 1;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: heading.level, children: parseInline(heading.text) });
      at += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      at += 1;
      continue;
    }
    const first = ITEM.exec(line);
    if (first !== null) {
      const items: { depth: number; text: string }[] = [];
      while (at < lines.length) {
        const current = lines[at] ?? '';
        const item = ITEM.exec(current);
        const indent = (item?.[1] ?? '').length;
        // A top level item of the other kind starts a new list
        if (item !== null && indent < 2 && items.length > 0 && /^\d/.test(item[2] ?? '') !== /^\d/.test(first[2] ?? ''))
          break;
        if (item !== null && !RULE.test(current)) {
          items.push({ depth: Math.min(MAX_INDENT_DEPTH, Math.floor(indent / 2)), text: item[3] ?? '' });
          at += 1;
        } else if (current.trim() === '') {
          // A blank line keeps the list going only when the next line is another item
          let next = at;
          while (next < lines.length && (lines[next] ?? '').trim() === '') next += 1;
          if (next < lines.length && ITEM.test(lines[next] ?? '') && !RULE.test(lines[next] ?? '')) at = next;
          else break;
        } else if (/^ {2,}\S/.test(current) && items.length > 0 && !startsBlock(current.trim())) {
          const last = items[items.length - 1];
          if (last !== undefined) last.text += `\n${current.trim()}`;
          at += 1;
        } else break;
      }
      blocks.push({
        kind: 'list',
        ordered: /^\d/.test(first[2] ?? ''),
        items: items.map((item) => ({ depth: item.depth, children: parseInline(item.text) })),
      });
      continue;
    }
    const paragraph: string[] = [];
    while (
      at < lines.length &&
      (lines[at] ?? '').trim() !== '' &&
      (paragraph.length === 0 || !startsBlock(lines[at] ?? ''))
    ) {
      paragraph.push((lines[at] ?? '').trim());
      at += 1;
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}
