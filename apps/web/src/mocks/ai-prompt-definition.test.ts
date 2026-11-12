import { describe, expect, it } from 'vitest';

import raw from '../../../../fixtures/ai-prompts/eventus-security.json';
import { EVENTUS_DEFINITION, parseDefinition } from './ai-prompt-definition';
import { MOCK_PROJECTS } from './fixtures';

const definition = EVENTUS_DEFINITION;

describe('the Eventus Security definition file', () => {
  it('has the counts the data set promises', () => {
    expect(definition.prompts).toHaveLength(72);
    expect(definition.competitors).toHaveLength(8);
    expect(definition.topics).toHaveLength(7);
    for (const parent of definition.topics) {
      expect(parent.children.length).toBeGreaterThanOrEqual(2);
      expect(parent.children.length).toBeLessThanOrEqual(4);
    }
    expect(definition.engines.map((engine) => engine.engine_code)).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('describes the project the mocks already have', () => {
    const seed = MOCK_PROJECTS.find((project) => project.slug === definition.project.slug);
    expect(seed).toMatchObject({
      name: definition.project.name,
      host: definition.project.host,
      timezone: definition.project.timezone,
    });
    expect(definition.project).toMatchObject({ language_code: 'en', default_country: 'IN' });
    expect(definition.brand.domains).toEqual([definition.project.host]);
  });

  it('has prompts with unique texts and keys', () => {
    expect(new Set(definition.prompts.map((prompt) => prompt.text)).size).toBe(72);
    expect(new Set(definition.prompts.map((prompt) => prompt.key)).size).toBe(72);
    for (const prompt of definition.prompts) expect(prompt.text).toMatch(/^[\x20-\x7e]+$/);
  });

  it('tags every prompt with one or two topics that exist', () => {
    const slugs = new Set(definition.topics.flatMap((parent) => [parent.slug, ...parent.children.map((c) => c.slug)]));
    expect(slugs.size).toBe(definition.topics.length + definition.topics.flatMap((parent) => parent.children).length);
    for (const prompt of definition.prompts) {
      expect(prompt.topics.length).toBeGreaterThanOrEqual(1);
      expect(prompt.topics.length).toBeLessThanOrEqual(2);
      for (const topic of prompt.topics) expect(slugs).toContain(topic);
    }
  });

  it('gives every prompt a profile for every engine, naming only known competitors and domains', () => {
    const competitors = new Set(definition.competitors.map((competitor) => competitor.key));
    const sources = new Set(definition.sources.map((source) => source.key));
    for (const prompt of definition.prompts) {
      expect(Object.keys(prompt.profile).sort()).toEqual(definition.engines.map((engine) => engine.engine_code).sort());
      for (const profile of Object.values(prompt.profile)) {
        for (const [key] of profile.competitors) expect(competitors).toContain(key);
        for (const [key] of profile.sources) expect(competitors.has(key) || sources.has(key)).toBe(true);
      }
    }
  });

  it('keeps every prompt in a country every engine runs in', () => {
    for (const prompt of definition.prompts) {
      for (const engine of definition.engines) expect(engine.countries).toContain(prompt.country);
    }
    expect(new Set(definition.prompts.map((prompt) => prompt.country))).toEqual(new Set(['IN', 'AE', 'SA']));
  });

  it('has one own source and every kind of source the brief names', () => {
    expect(definition.sources.filter((source) => source.role === 'own')).toHaveLength(1);
    const categories = new Set(definition.sources.map((source) => source.category));
    for (const category of ['own', 'analyst', 'review', 'forum', 'government', 'standards']) {
      expect(categories).toContain(category);
    }
    const own = definition.sources.find((source) => source.role === 'own');
    expect(own?.host).toBe(definition.project.host);
  });

  it('spreads the visibility: a few wins, many partial, a tail that is absent, two engine splits', () => {
    const level = (code: string, prompt: (typeof definition.prompts)[number]): number =>
      prompt.profile[code]?.mention ?? 0;
    const plain = definition.prompts.filter((prompt) => !prompt.branded);
    const wins = plain.filter((prompt) => Object.keys(prompt.profile).every((code) => level(code, prompt) >= 0.75));
    const absent = plain.filter((prompt) => Object.keys(prompt.profile).every((code) => level(code, prompt) <= 0.15));
    const split = plain.filter((prompt) => Math.abs(level('chatgpt_web', prompt) - level('gemini_web', prompt)) >= 0.6);
    expect(wins.length).toBeGreaterThanOrEqual(3);
    expect(wins.length).toBeLessThanOrEqual(8);
    expect(absent.length).toBeGreaterThanOrEqual(12);
    expect(plain.length - wins.length - absent.length).toBeGreaterThanOrEqual(30);
    expect(split).toHaveLength(2);
  });

  it('marks a prompt branded only when its text names the brand', () => {
    for (const prompt of definition.prompts) {
      const names = definition.brand.aliases.some((alias) => prompt.text.includes(alias));
      expect(prompt.branded).toBe(names);
    }
  });

  it('has one model change that falls inside the history and names an engine that is on', () => {
    const change = definition.model_change;
    expect(definition.engines.map((engine) => engine.engine_code)).toContain(change.engine_code);
    expect(change.effective_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseDefinition', () => {
  it('accepts the file as it is', () => {
    expect(() => parseDefinition(raw)).not.toThrow();
  });

  it('refuses a profile that names a competitor the file does not have', () => {
    const broken = structuredClone(raw);
    const first = broken.prompts[0];
    if (first === undefined) throw new Error('no prompt');
    first.profile.chatgpt_web.competitors = [['nobody', 0.5]];
    expect(() => parseDefinition(broken)).toThrow(/nobody/);
  });

  it('refuses a prompt with a topic that does not exist', () => {
    const broken = structuredClone(raw);
    const first = broken.prompts[0];
    if (first === undefined) throw new Error('no prompt');
    first.topics = ['no-such-topic'];
    expect(() => parseDefinition(broken)).toThrow(/no-such-topic/);
  });

  it('refuses two prompts with the same text', () => {
    const broken = structuredClone(raw);
    const [first, second] = broken.prompts;
    if (first === undefined || second === undefined) throw new Error('no prompts');
    second.text = first.text;
    expect(() => parseDefinition(broken)).toThrow(/same text/);
  });

  it('refuses a probability above one', () => {
    const broken = structuredClone(raw);
    const first = broken.prompts[0];
    if (first === undefined) throw new Error('no prompt');
    first.profile.gemini_web.mention = 1.5;
    expect(() => parseDefinition(broken)).toThrow();
  });
});
