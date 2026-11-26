import { describe, expect, it } from 'vitest';

import {
  MAX_MENTIONS,
  MAX_SUGGESTIONS,
  addMention,
  applySuggestion,
  commandsFor,
  keptMentions,
  pickInto,
  splitNoteText,
  suggestionsFor,
  triggerAt,
  type NoteMention,
  type SuggestionSources,
} from './note-mentions';

const at = (text: string): ReturnType<typeof triggerAt> => triggerAt(text, text.length);

const SOURCES: SuggestionSources = {
  teammates: [
    { id: 'u1', name: 'Arjun Mehta' },
    { id: 'u2', name: 'Priya Natarajan' },
  ],
  pages: [
    { id: '108', path: '/pricing', title: 'Plans and pricing' },
    { id: '101', path: '/', title: null },
    { id: '120', path: '/blog/arjun-story', title: 'Our story' },
  ],
  issues: [{ checkId: 'title_missing', name: 'Missing title' }],
  keywords: ['managed detection', 'vapt cost', 'c++ (best)'],
};
const NONE: SuggestionSources = { teammates: [], pages: [], issues: [], keywords: [] };

const mention = (type: NoteMention['type'], label: string, target = '1'): NoteMention => ({ type, label, target });

describe('the limits', () => {
  it('are 8 rows and 20 mentions', () => {
    expect(MAX_SUGGESTIONS).toBe(8);
    expect(MAX_MENTIONS).toBe(20);
  });
});

describe('triggerAt', () => {
  it('opens on an at sign that starts the text, after a space and after a line break', () => {
    expect(at('@')).toEqual({ start: 0, kind: 'at', query: '' });
    expect(at('See @pri')).toEqual({ start: 4, kind: 'at', query: 'pri' });
    expect(at('Line\n@ar')).toEqual({ start: 5, kind: 'at', query: 'ar' });
    expect(at('Tab\t@x')).toEqual({ start: 4, kind: 'at', query: 'x' });
  });

  it('is not opened inside a word: an e-mail address, a path, and/or', () => {
    expect(at('write a@b.com')).toBeNull();
    expect(at('a@')).toBeNull();
    expect(at('and/or')).toBeNull();
    expect(at('see /blog/x')).toBeNull();
    expect(at('(@x')).toBeNull();
  });

  it('is closed once the caret leaves the word', () => {
    expect(at('@pri ')).toBeNull();
    expect(at('@pri\n')).toBeNull();
    expect(at('plain text')).toBeNull();
    expect(at('')).toBeNull();
  });

  it('reads only what lies before the caret when the caret is in the middle of a word', () => {
    expect(triggerAt('@pricing', 4)).toEqual({ start: 0, kind: 'at', query: 'pri' });
    expect(triggerAt('ab @pricing now', 7)).toEqual({ start: 3, kind: 'at', query: 'pri' });
    expect(triggerAt('@pricing', 0)).toBeNull();
    expect(triggerAt('@pricing', 1)).toEqual({ start: 0, kind: 'at', query: '' });
  });

  it('is not thrown by a caret outside the text', () => {
    expect(triggerAt('@a', 99)).toEqual({ start: 0, kind: 'at', query: 'a' });
    expect(triggerAt('@a', -5)).toBeNull();
    expect(triggerAt('@a', Number.NaN)).toBeNull();
  });

  it('keeps an emoji and a quote in the query', () => {
    expect(at('hi @\u{1F600}x')).toEqual({ start: 3, kind: 'at', query: '\u{1F600}x' });
    expect(at('@"c++')).toEqual({ start: 0, kind: 'at', query: '"c++' });
  });

  it('opens the commands on a slash that starts a word, narrowed as the word grows', () => {
    expect(at('/')).toEqual({ start: 0, kind: 'command', query: '' });
    expect(at('Note\n/pa')).toEqual({ start: 5, kind: 'command', query: 'pa' });
    expect(at('/DA')).toEqual({ start: 0, kind: 'command', query: 'DA' });
  });

  it('is not opened by a word that is none of the commands, nor by a slash inside a word', () => {
    expect(at('/xyz')).toBeNull();
    expect(at('/pagex')).toBeNull();
    expect(at('and/pa')).toBeNull();
  });

  it('opens one kind after /page, /issue and /keyword and a space', () => {
    expect(at('/page ')).toEqual({ start: 0, kind: 'page', query: '' });
    expect(at('See /page pri')).toEqual({ start: 4, kind: 'page', query: 'pri' });
    expect(at('/issue tit')).toEqual({ start: 0, kind: 'issue', query: 'tit' });
    expect(at('/Keyword vapt')).toEqual({ start: 0, kind: 'keyword', query: 'vapt' });
  });

  it('closes the kinds at a line break, a second space or a second word, and for /date', () => {
    expect(at('/page\n')).toBeNull();
    expect(at('/page\nx')).toBeNull();
    expect(at('/page  x')).toBeNull();
    expect(at('/page pri ')).toBeNull();
    expect(at('/page pri more')).toBeNull();
    expect(at('/date x')).toBeNull();
    expect(at('page pri')).toBeNull();
  });

  it('lets an at sign win over the command before it', () => {
    expect(at('/page @pri')).toEqual({ start: 6, kind: 'at', query: 'pri' });
  });
});

describe('commandsFor', () => {
  it('lists the four commands for nothing, in order', () => {
    expect(commandsFor('')).toEqual(['page', 'issue', 'keyword', 'date']);
  });

  it('narrows by the start of the name, ignoring case', () => {
    expect(commandsFor('pa')).toEqual(['page']);
    expect(commandsFor('PA')).toEqual(['page']);
    expect(commandsFor('i')).toEqual(['issue']);
    expect(commandsFor('d')).toEqual(['date']);
    expect(commandsFor('x')).toEqual([]);
    expect(commandsFor('ge')).toEqual([]);
  });
});

describe('suggestionsFor', () => {
  const labels = (rows: ReturnType<typeof suggestionsFor>): string[] =>
    rows.map((row) => (row.kind === 'mention' ? row.mention.label : `/${row.name}`));

  it('gives teammates, then pages, then issues, then keywords for nothing typed', () => {
    const rows = suggestionsFor({ start: 0, kind: 'at', query: '' }, SOURCES);
    expect(labels(rows)).toEqual([
      '@Arjun Mehta',
      '@Priya Natarajan',
      '@/pricing',
      '@/',
      '@/blog/arjun-story',
      '@Missing title',
      '@"managed detection"',
      '@"vapt cost"',
    ]);
  });

  it('caps at 8 rows in all', () => {
    const many: SuggestionSources = {
      ...NONE,
      teammates: Array.from({ length: 12 }, (_, index) => ({
        id: `u${String(index)}`,
        name: `Person ${String(index)}`,
      })),
    };
    expect(suggestionsFor({ start: 0, kind: 'at', query: '' }, many)).toHaveLength(MAX_SUGGESTIONS);
  });

  it('narrows each kind by a case-insensitive contains on its name, path, title, issue name or keyword', () => {
    const rows = suggestionsFor({ start: 0, kind: 'at', query: 'ARJ' }, SOURCES);
    expect(labels(rows)).toEqual(['@Arjun Mehta', '@/blog/arjun-story']);
    expect(labels(suggestionsFor({ start: 0, kind: 'at', query: 'plans' }, SOURCES))).toEqual(['@/pricing']);
    expect(labels(suggestionsFor({ start: 0, kind: 'at', query: 'missing' }, SOURCES))).toEqual(['@Missing title']);
    expect(labels(suggestionsFor({ start: 0, kind: 'at', query: 'detect' }, SOURCES))).toEqual([
      '@"managed detection"',
    ]);
  });

  it('ignores a quote the person typed to start a keyword', () => {
    expect(labels(suggestionsFor({ start: 0, kind: 'at', query: '"vapt' }, SOURCES))).toEqual(['@"vapt cost"']);
  });

  it('shows the path and the title of a page, and nothing extra for the others', () => {
    const [first, second] = suggestionsFor({ start: 0, kind: 'page', query: '' }, SOURCES);
    expect(first).toEqual({
      kind: 'mention',
      mention: { type: 'page', label: '@/pricing', target: '108' },
      hint: '/pricing',
      detail: 'Plans and pricing',
    });
    expect(second).toMatchObject({ hint: '/', detail: null });
    const [teammate] = suggestionsFor({ start: 0, kind: 'at', query: 'priya' }, SOURCES);
    expect(teammate).toEqual({
      kind: 'mention',
      mention: { type: 'user', label: '@Priya Natarajan', target: 'u2' },
      hint: 'Priya Natarajan',
      detail: null,
    });
  });

  it('builds the label of each type and targets what the server judges', () => {
    const all = suggestionsFor({ start: 0, kind: 'at', query: '' }, { ...SOURCES, keywords: ['c++ (best)'] });
    const mentions = all.flatMap((row) => (row.kind === 'mention' ? [row.mention] : []));
    expect(mentions).toContainEqual({ type: 'issue', label: '@Missing title', target: 'title_missing' });
    expect(mentions).toContainEqual({ type: 'keyword', label: '@"c++ (best)"', target: 'c++ (best)' });
    expect(mentions).toContainEqual({ type: 'page', label: '@/blog/arjun-story', target: '120' });
  });

  it('returns one kind for /page, /issue and /keyword', () => {
    expect(labels(suggestionsFor({ start: 0, kind: 'page', query: '' }, SOURCES))).toEqual([
      '@/pricing',
      '@/',
      '@/blog/arjun-story',
    ]);
    expect(labels(suggestionsFor({ start: 0, kind: 'issue', query: '' }, SOURCES))).toEqual(['@Missing title']);
    expect(labels(suggestionsFor({ start: 0, kind: 'keyword', query: 'cost' }, SOURCES))).toEqual(['@"vapt cost"']);
    expect(labels(suggestionsFor({ start: 0, kind: 'page', query: 'arjun' }, SOURCES))).toEqual(['@/blog/arjun-story']);
  });

  it('returns the commands for a command trigger, none for a word that is no command', () => {
    expect(labels(suggestionsFor({ start: 0, kind: 'command', query: '' }, SOURCES))).toEqual([
      '/page',
      '/issue',
      '/keyword',
      '/date',
    ]);
    expect(labels(suggestionsFor({ start: 0, kind: 'command', query: 'pa' }, NONE))).toEqual(['/page']);
    expect(suggestionsFor({ start: 0, kind: 'command', query: 'zz' }, SOURCES)).toEqual([]);
  });

  it('returns nothing from empty sources, and never a label that is only an at sign', () => {
    expect(suggestionsFor({ start: 0, kind: 'at', query: '' }, NONE)).toEqual([]);
    const blank: SuggestionSources = {
      ...NONE,
      teammates: [{ id: 'u', name: '  ' }],
      issues: [{ checkId: 'x', name: '' }],
      keywords: [''],
    };
    expect(suggestionsFor({ start: 0, kind: 'at', query: '' }, blank)).toEqual([]);
  });

  it('keeps a label to one line and at most 200 characters', () => {
    const long = 'w'.repeat(300);
    const sources: SuggestionSources = {
      ...NONE,
      teammates: [{ id: 'u', name: 'Two\nlines  here' }],
      keywords: [long],
      issues: [{ checkId: 'x', name: long }],
    };
    const rows = suggestionsFor({ start: 0, kind: 'at', query: '' }, sources).flatMap((row) =>
      row.kind === 'mention' ? [row.mention.label] : [],
    );
    expect(rows[0]).toBe('@Two lines here');
    for (const label of rows) expect([...label].length).toBeLessThanOrEqual(200);
    expect(rows[1]).toMatch(/^@w+$/u);
    expect(rows[2]).toMatch(/^@"w+"$/u);
  });
});

describe('applySuggestion', () => {
  it('replaces the trigger and the typed word with the text and one space, and returns the caret', () => {
    const trigger = at('See @pri');
    if (trigger === null) throw new Error('no trigger');
    expect(applySuggestion('See @pri', trigger, '@/pricing')).toEqual({ text: 'See @/pricing ', caret: 14 });
  });

  it('keeps the tail when the caret is in the middle of the text', () => {
    const text = 'See @pri and more';
    const trigger = triggerAt(text, 8);
    if (trigger === null) throw new Error('no trigger');
    expect(applySuggestion(text, trigger, '@/pricing')).toEqual({ text: 'See @/pricing  and more', caret: 14 });
  });

  it('replaces the whole of "/page pri" and the bare slash of a command', () => {
    const page = at('Go /page pri');
    if (page === null) throw new Error('no trigger');
    expect(applySuggestion('Go /page pri', page, '@/pricing')).toEqual({ text: 'Go @/pricing ', caret: 13 });
    const command = at('/pa');
    if (command === null) throw new Error('no trigger');
    expect(applySuggestion('/pa', command, '/page')).toEqual({ text: '/page ', caret: 6 });
  });

  it('counts an emoji in the text before the trigger as the text does', () => {
    const text = '\u{1F600} @a';
    const trigger = at(text);
    if (trigger === null) throw new Error('no trigger');
    const result = applySuggestion(text, trigger, '@Ann');
    expect(result.text).toBe('\u{1F600} @Ann ');
    expect(result.caret).toBe(result.text.length);
  });

  it('opens the next list after a command is picked', () => {
    const command = at('/pa');
    if (command === null) throw new Error('no trigger');
    const next = applySuggestion('/pa', command, '/page');
    expect(triggerAt(next.text, next.caret)).toEqual({ start: 0, kind: 'page', query: '' });
  });
});

describe('addMention', () => {
  it('adds the entry, once per label', () => {
    const page = mention('page', '@/pricing', '108');
    expect(addMention([], page)).toEqual([page]);
    expect(addMention([page], { ...page, target: '999' })).toEqual([page]);
  });

  it('stops at 20', () => {
    const full = Array.from({ length: MAX_MENTIONS }, (_, index) => mention('keyword', `@"k${String(index)}"`));
    expect(addMention(full, mention('keyword', '@"extra"'))).toEqual(full);
  });
});

describe('pickInto', () => {
  const page = suggestionsFor({ start: 0, kind: 'page', query: 'pricing' }, SOURCES)[0];

  it('inserts the label and adds the entry, for the at sign and for /page alike', () => {
    if (page === undefined) throw new Error('no row');
    const viaAt = at('Look @pri');
    const viaCommand = at('Look /page pri');
    if (viaAt === null || viaCommand === null) throw new Error('no trigger');
    const first = pickInto('Look @pri', [], viaAt, page, '27 Nov 2026');
    const second = pickInto('Look /page pri', [], viaCommand, page, '27 Nov 2026');
    expect(first).toEqual({
      text: 'Look @/pricing ',
      caret: 15,
      mentions: [{ type: 'page', label: '@/pricing', target: '108' }],
    });
    expect(second.text).toBe(first.text);
    expect(second.mentions).toEqual(first.mentions);
  });

  it('adds one entry for the same pick twice', () => {
    if (page === undefined) throw new Error('no row');
    const trigger = at('@p');
    if (trigger === null) throw new Error('no trigger');
    const once = pickInto('@p', [], trigger, page, '');
    const again = pickInto(
      `${once.text}@p`,
      once.mentions,
      { start: once.text.length, kind: 'at', query: 'p' },
      page,
      '',
    );
    expect(again.mentions).toHaveLength(1);
  });

  it('inserts the date given and no entry for /date', () => {
    const trigger = at('On /da');
    const [date] = suggestionsFor({ start: 3, kind: 'command', query: 'da' }, NONE);
    if (trigger === null || date === undefined) throw new Error('no row');
    expect(pickInto('On /da', [], trigger, date, '27 Nov 2026')).toEqual({
      text: 'On 27 Nov 2026 ',
      caret: 15,
      mentions: [],
    });
  });

  it('inserts the command word for /page and adds no entry', () => {
    const trigger = at('/pa');
    const [command] = suggestionsFor({ start: 0, kind: 'command', query: 'pa' }, NONE);
    if (trigger === null || command === undefined) throw new Error('no row');
    expect(pickInto('/pa', [], trigger, command, '')).toEqual({ text: '/page ', caret: 6, mentions: [] });
  });
});

describe('keptMentions', () => {
  const page = mention('page', '@/pricing', '108');
  const teammate = mention('user', '@Arjun Mehta', 'u1');

  it('drops an entry whose label is gone and keeps the order of the list', () => {
    expect(keptMentions('Hello @Arjun Mehta and @/pricing', [page, teammate])).toEqual([page, teammate]);
    expect(keptMentions('Hello @Arjun Mehta', [page, teammate])).toEqual([teammate]);
    expect(keptMentions('Hello', [page, teammate])).toEqual([]);
  });

  it('keeps the first of two entries with one label', () => {
    expect(keptMentions('@/pricing', [page, { ...page, target: '999' }])).toEqual([page]);
  });

  it('drops a mention when its label is edited, even by one character', () => {
    expect(keptMentions('@/pricin', [page])).toEqual([]);
    expect(keptMentions('@Arjun  Mehta', [teammate])).toEqual([]);
  });

  it('keeps a mention when the text around it is edited', () => {
    expect(keptMentions('before @Arjun Mehta after', [teammate])).toEqual([teammate]);
    expect(keptMentions('\u{1F600}@Arjun Mehta\u{1F600}', [teammate])).toEqual([teammate]);
  });

  it('finds a label with regular-expression characters literally', () => {
    const odd = mention('keyword', '@"c++ (best)"', 'c++ (best)');
    expect(keptMentions('try @"c++ (best)" now', [odd])).toEqual([odd]);
    expect(keptMentions('try @"cc (best)" now', [odd])).toEqual([]);
  });

  it('keeps a label that is the start of another when both are in the text', () => {
    const short = mention('page', '@/pricing', '108');
    const long = mention('page', '@/pricing-plans', '109');
    expect(keptMentions('@/pricing-plans', [short, long])).toEqual([short, long]);
  });

  it('keeps at most 20 and is not thrown by an empty label', () => {
    const many = Array.from({ length: 25 }, (_, index) => mention('keyword', `@"k${String(index)}"`));
    const text = many.map((entry) => entry.label).join(' ');
    expect(keptMentions(text, many)).toHaveLength(MAX_MENTIONS);
    expect(keptMentions('x', [mention('page', '')])).toEqual([]);
  });
});

describe('splitNoteText', () => {
  const page = mention('page', '@/pricing', '108');
  const teammate = mention('user', '@Arjun Mehta', 'u1');
  const joined = (parts: ReturnType<typeof splitNoteText>): string =>
    parts.map((part) => (part.kind === 'text' ? part.text : part.mention.label)).join('');

  it('is one text part with no mention, and none for an empty body', () => {
    expect(splitNoteText('Plain text', [])).toEqual([{ kind: 'text', text: 'Plain text' }]);
    expect(splitNoteText('', [page])).toEqual([]);
  });

  it('splits around one mention', () => {
    expect(splitNoteText('See @/pricing now', [page])).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'mention', mention: page },
      { kind: 'text', text: ' now' },
    ]);
  });

  it('draws every occurrence of a label, and a mention at the very start and end', () => {
    const parts = splitNoteText('@/pricing and @/pricing', [page]);
    expect(parts.filter((part) => part.kind === 'mention')).toHaveLength(2);
    expect(parts[0]).toEqual({ kind: 'mention', mention: page });
    expect(parts.at(-1)).toEqual({ kind: 'mention', mention: page });
    expect(parts).toHaveLength(3);
  });

  it('leaves the text of a label the list does not hold as plain text, and a label not in the text out', () => {
    expect(splitNoteText('See @/other', [page])).toEqual([{ kind: 'text', text: 'See @/other' }]);
  });

  it('matches the longer label first when one is the start of another', () => {
    const short = mention('page', '@/pricing', '108');
    const long = mention('page', '@/pricing-plans', '109');
    const parts = splitNoteText('@/pricing-plans and @/pricing', [short, long]);
    expect(parts).toEqual([
      { kind: 'mention', mention: long },
      { kind: 'text', text: ' and ' },
      { kind: 'mention', mention: short },
    ]);
  });

  it('never lets two chips overlap', () => {
    const left = mention('user', '@ab cd', '1');
    const right = mention('user', 'cd ef', '2');
    const parts = splitNoteText('@ab cd ef', [left, right]);
    expect(joined(parts)).toBe('@ab cd ef');
    expect(parts.filter((part) => part.kind === 'mention')).toHaveLength(1);
  });

  it('keeps a label with spaces in one chip', () => {
    expect(splitNoteText('Ask @Arjun Mehta.', [teammate])).toEqual([
      { kind: 'text', text: 'Ask ' },
      { kind: 'mention', mention: teammate },
      { kind: 'text', text: '.' },
    ]);
  });

  it('uses the first entry of a label held twice', () => {
    const parts = splitNoteText('@/pricing', [page, { ...page, target: '999' }]);
    expect(parts).toEqual([{ kind: 'mention', mention: page }]);
  });

  it('matches a label made of regular-expression characters literally', () => {
    const odd = mention('keyword', '@"c++ (best)"', 'c++ (best)');
    expect(splitNoteText('try @"c++ (best)" now', [odd])).toEqual([
      { kind: 'text', text: 'try ' },
      { kind: 'mention', mention: odd },
      { kind: 'text', text: ' now' },
    ]);
    expect(splitNoteText('try @"cc (best)" now', [odd])).toHaveLength(1);
  });

  it('comes back character for character when markup is in the body', () => {
    const body = '<b>bold</b> & <img src=x onerror=alert(1)> @/pricing &amp; <script>';
    const parts = splitNoteText(body, [page]);
    expect(joined(parts)).toBe(body);
    for (const part of parts) {
      expect(part.kind === 'text' ? typeof part.text : typeof part.mention.label).toBe('string');
      expect(Object.keys(part).sort()).toEqual(part.kind === 'text' ? ['kind', 'text'] : ['kind', 'mention']);
    }
  });

  it('handles an emoji beside and inside a label', () => {
    const fun = mention('keyword', '@"\u{1F600} smile"', 'x');
    const body = '\u{1F600}@"\u{1F600} smile"\u{1F600}';
    const parts = splitNoteText(body, [fun]);
    expect(parts).toEqual([
      { kind: 'text', text: '\u{1F600}' },
      { kind: 'mention', mention: fun },
      { kind: 'text', text: '\u{1F600}' },
    ]);
  });

  it('is not thrown by an empty label', () => {
    expect(splitNoteText('abc', [mention('page', '')])).toEqual([{ kind: 'text', text: 'abc' }]);
  });
});
