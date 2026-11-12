import { z } from 'zod';

// eslint-disable-next-line boundaries/no-unknown-dependencies -- the data file lives at the repository root, outside the app, so the backend can seed from it too
import raw from '../../../../fixtures/ai-prompts/eventus-security.json';

/**
 * A project's AI prompt tracking data set, defined once in a plain JSON file at the repository root
 * (`fixtures/ai-prompts/`, which its README documents) so the backend can seed a real database from the same
 * file. The mocks read it here: the file is checked against this schema when it loads, so a mistake in it fails
 * at once and by name, not as a strange screen.
 */

const probability = z.number().min(0).max(1);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const printable = z.string().regex(/^[\x20-\x7e]+$/);
const country = z.string().regex(/^[A-Z]{2}$/);
const engineCode = z.enum(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
const pair = z.tuple([z.string(), probability]);

const ENTITY = z.strictObject({
  key: slug,
  name: printable,
  aliases: z.array(printable).min(1),
  domains: z.array(z.string()).min(1),
  ambiguous: z.boolean().optional(),
  disambiguation_hints: z.array(z.string()).optional(),
});

const PAGE = z.strictObject({ path: z.string().startsWith('/'), title: printable, topic: slug.nullable().optional() });

const SOURCE = z.strictObject({
  key: slug,
  host: z.string(),
  name: printable,
  role: z.enum(['own', 'competitor', 'third_party']),
  category: z.enum(['own', 'analyst', 'news', 'review', 'forum', 'government', 'standards', 'reference']),
  pages: z.array(PAGE).min(1),
});

const PROFILE = z.strictObject({
  mention: probability,
  cite: probability,
  order: z.number().int().min(1).max(8),
  competitors: z.array(pair),
  sources: z.array(pair),
});

const PROMPT = z.strictObject({
  key: z.string().regex(/^p\d{2,3}$/),
  text: printable.max(2000),
  country,
  intent: z.enum(['informational', 'navigational', 'commercial', 'transactional', 'local', 'unknown']),
  funnel_stage: z.enum(['tofu', 'mofu', 'bofu', 'retention', 'unknown']),
  prompt_type: z.enum([
    'question',
    'comparison',
    'recommendation',
    'how_to',
    'definition',
    'local',
    'transactional',
    'other',
  ]),
  importance: z.number().int().min(1).max(5),
  branded: z.boolean(),
  topics: z.array(slug).min(1).max(2),
  profile: z.record(z.string(), PROFILE),
});

const TOPIC = z.strictObject({
  slug,
  name: printable,
  children: z
    .array(z.strictObject({ slug, name: printable }))
    .min(2)
    .max(4),
});

const TEMPLATE = z.string().refine((text) => text.split('{name}').length === 2, 'A sentence holds {name} exactly once');

const DEFINITION = z
  .strictObject({
    schema_version: z.literal(1),
    note: z.string(),
    project: z.strictObject({
      name: printable,
      slug,
      host: z.string(),
      language_code: z.string().regex(/^[a-z]{2}$/),
      default_country: country,
      timezone: z.string(),
    }),
    brand: z.strictObject({
      key: slug,
      name: printable,
      aliases: z.array(printable).min(1),
      domains: z.array(z.string()).min(1),
    }),
    competitors: z.array(ENTITY).min(1),
    engines: z
      .array(z.strictObject({ engine_code: engineCode, countries: z.array(country).min(1), model: z.string() }))
      .min(1),
    model_change: z.strictObject({
      engine_code: engineCode,
      model: z.string(),
      effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      mention_delta: z.number().min(-1).max(1),
    }),
    topics: z.array(TOPIC).min(1),
    sources: z.array(SOURCE).min(1),
    competitor_pages: z.array(z.strictObject({ path: z.string().startsWith('/'), title: printable })).min(1),
    phrases: z.strictObject({
      intro: z.record(z.string(), z.string()),
      outro: z.record(z.string(), z.string()),
      own: z.array(TEMPLATE).min(1),
      competitor: z.array(TEMPLATE).min(1),
      repeat_own: TEMPLATE,
      inline: z.string().refine((text) => text.split('{url}').length === 2, 'The sentence holds {url} exactly once'),
      cut_off: z.string(),
    }),
    prompts: z.array(PROMPT).min(1),
  })
  .superRefine((value, ctx) => {
    const fail = (message: string): void => {
      ctx.addIssue({ code: 'custom', message });
    };
    const unique = (what: string, items: readonly string[]): void => {
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item)) fail(`Two ${what} have the same ${what === 'prompts' ? 'text' : 'key'}: ${item}`);
        seen.add(item);
      }
    };
    unique(
      'competitors',
      value.competitors.map((entity) => entity.key),
    );
    unique(
      'sources',
      value.sources.map((source) => source.key),
    );
    unique(
      'prompts',
      value.prompts.map((prompt) => prompt.text),
    );
    unique(
      'prompt keys',
      value.prompts.map((prompt) => prompt.key),
    );
    const topics = value.topics.flatMap((parent) => [parent.slug, ...parent.children.map((child) => child.slug)]);
    unique('topics', topics);
    const competitors = new Set(value.competitors.map((entity) => entity.key));
    const sources = new Set(value.sources.map((source) => source.key));
    if (value.sources.filter((source) => source.role === 'own').length !== 1) fail('Exactly one source is the own one');
    for (const own of value.sources.filter((source) => source.role === 'own')) {
      if (!value.brand.domains.includes(own.host)) fail(`The own source ${own.host} is not a domain of the brand`);
    }
    const codes = value.engines.map((engine) => engine.engine_code);
    if (!codes.includes(value.model_change.engine_code)) fail('The model change names an engine that is not on');
    for (const prompt of value.prompts) {
      for (const topic of prompt.topics)
        if (!topics.includes(topic)) fail(`${prompt.key} has an unknown topic: ${topic}`);
      for (const engine of value.engines) {
        if (!engine.countries.includes(prompt.country))
          fail(`${prompt.key} is in ${prompt.country}, which ${engine.engine_code} does not run in`);
      }
      if ([...Object.keys(prompt.profile)].sort().join() !== [...codes].sort().join()) {
        fail(`${prompt.key} needs a profile for each engine that is on`);
      }
      if (!(prompt.prompt_type in value.phrases.intro)) fail(`No intro for the prompt type ${prompt.prompt_type}`);
      if (!(prompt.funnel_stage in value.phrases.outro)) fail(`No outro for the funnel stage ${prompt.funnel_stage}`);
      for (const profile of Object.values(prompt.profile)) {
        for (const [key] of profile.competitors)
          if (!competitors.has(key)) fail(`${prompt.key} names an unknown competitor: ${key}`);
        for (const [key] of profile.sources) {
          if (!competitors.has(key) && !sources.has(key)) fail(`${prompt.key} names an unknown source: ${key}`);
        }
      }
    }
  });

export type AiPromptDefinition = z.infer<typeof DEFINITION>;
export type DefinitionPrompt = AiPromptDefinition['prompts'][number];
export type DefinitionProfile = z.infer<typeof PROFILE>;
export type DefinitionSource = AiPromptDefinition['sources'][number];
export type DefinitionCompetitor = AiPromptDefinition['competitors'][number];

/** The definition in `value`, or an error that names what is wrong with it. */
export function parseDefinition(value: unknown): AiPromptDefinition {
  return DEFINITION.parse(value);
}

export const EVENTUS_DEFINITION: AiPromptDefinition = parseDefinition(raw);
