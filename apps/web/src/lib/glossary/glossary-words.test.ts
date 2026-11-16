import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import { CARD_TYPES, NUMBER_TYPES, SCREENS } from '../layouts/catalog';
import { findViolations, flattenMessages, visibleText, type BannedWord, type GuardException } from './glossary-words';

const glossaryFile = (name: string): string =>
  readFileSync(new URL(`../../../../../docs/glossary/${name}`, import.meta.url), 'utf8');

const words = (JSON.parse(glossaryFile('banned-words.json')) as { words: BannedWord[] }).words;
const exceptions = (JSON.parse(glossaryFile('guard-exceptions.json')) as { exceptions: GuardException[] }).exceptions;

describe('visibleText', () => {
  it('drops variables and keeps the text of plural branches', () => {
    expect(visibleText('Open {name}')).toBe('Open ');
    const text = visibleText('{n, plural, one {# group} other {# groups}} selected');
    expect(text).toContain('# group');
    expect(text).toContain('# groups');
    expect(text).toContain('selected');
  });

  it('does not see a word that is only a variable name', () => {
    expect(visibleText('Mention rate on {engine}')).not.toMatch(/engine/);
    expect(visibleText('{kind, select, topic {Group} other {Tag}}')).not.toMatch(/topic/);
  });
});

describe('findViolations', () => {
  it('reports a banned word and its replacement', () => {
    const found = findViolations('x.y', 'Choose an engine', words, []);
    expect(found.map((f) => f.word)).toContain('engine');
  });

  it('accepts Search engine and Google AI Overview', () => {
    expect(findViolations('x.y', 'Search engine results pages', words, [])).toEqual([]);
    expect(findViolations('x.y', 'Google AI Overview is shown', words, [])).toEqual([]);
    expect(findViolations('x.y', 'The AI Overview is shown', words, []).map((f) => f.word)).toEqual([
      'ai-overview-bare',
    ]);
  });

  it('honours a listed exception by key prefix', () => {
    const rule: GuardException = { word: 'window', key: 'runReasons.', reason: 'test' };
    expect(findViolations('runReasons.missed', 'The window passed', words, [rule])).toEqual([]);
    expect(findViolations('other.key', 'The window passed', words, [rule])).not.toEqual([]);
  });
});

describe('the glossary guard on the layout catalog', () => {
  it('has no banned word in a card title, description, option label, number label or screen title', () => {
    const texts: Record<string, string> = {};
    for (const card of CARD_TYPES) {
      texts[`card.${card.key}.title`] = card.title;
      texts[`card.${card.key}.description`] = card.description;
      for (const [name, option] of Object.entries(card.options)) {
        texts[`card.${card.key}.option.${name}`] = option.label;
        for (const value of option.values) texts[`card.${card.key}.option.${name}.${value.value}`] = value.label;
      }
    }
    for (const number of NUMBER_TYPES) texts[`number.${number.metric}`] = number.label;
    for (const screen of Object.values(SCREENS)) texts[`screen.${screen.key}`] = screen.title;
    const violations = Object.entries(texts).flatMap(([key, text]) => findViolations(key, text, words, exceptions));
    expect(violations.map((v) => `${v.key} [${v.word} -> ${v.use}]: ${v.text}`)).toEqual([]);
  });
});

describe('the glossary guard on messages/en.json', () => {
  it('has no banned word in a visible string', () => {
    const violations = Object.entries(flattenMessages(messages)).flatMap(([key, text]) =>
      findViolations(key, text, words, exceptions),
    );
    const report = violations.map((v) => `${v.key} [${v.word} -> ${v.use}]: ${v.text}`);
    expect(report).toEqual([]);
  });
});
