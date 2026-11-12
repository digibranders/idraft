import type { CitationOut, EngineCode, MentionOut, ObservationDetail } from '@/lib/api/types';

/**
 * The shape of one AI answer as the API gives it (text, mentions with UTF-16 spans, sources, fact row), made from
 * a plan: who the answer names, in what order, which pages it cites and how the text reads. The plan is each
 * project's own business (./prompt-fixtures.ts plans Fynix's, ./profile-answers.ts plans a project that has a
 * definition file); what the API derives from it is the same everywhere, so it is made here, once.
 */

export type Facts = NonNullable<ObservationDetail['facts']>;

export interface Answer {
  status: ObservationDetail['status'];
  answer_text: string | null;
  error_code: string | null;
  model_reported: string | null;
  /** The provider's page to check the answer by, as the API gives it: http or https only. */
  check_url: string | null;
  mentions: MentionOut[];
  citations: CitationOut[];
  facts: Facts;
}

/** `value` when it is an http or https address: a provider's string is not trusted as a link (the API's `_web_address`). */
export function webAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export const PROVIDER_CHECK: Readonly<Record<EngineCode, string>> = {
  chatgpt_web: 'https://chatgpt.com/',
  gemini_web: 'https://gemini.google.com/app',
  google_ai_mode: 'https://www.google.com/search?udm=50',
};

/**
 * The kinds the backend stores (migration 0018 allows more, but the parser gives these): ChatGPT and Gemini give a
 * source list or inline links, Google AI Mode reference cards. An advertisement is never stored as a source
 * (providers/dataforseo/ai_parse.py drops them).
 */
export const CITATION_KINDS: Readonly<Record<EngineCode, string>> = {
  chatgpt_web: 'source_list',
  gemini_web: 'source_list',
  google_ai_mode: 'reference_card',
};

/** An entity an answer can name. */
export interface Party {
  entity_id: string;
  name: string;
  role: 'own' | 'competitor' | 'watch';
}

/** A page an answer can cite. */
export interface Site {
  url: string;
  host: string;
  title: string;
  source_name: string;
  role: CitationOut['domain_role'];
  entity_id: string | null;
}

/** One party the answer names, and the sentence that does it. */
export interface Planned {
  who: Party;
  /** What the text writes: the party's name or an alias, or the product's name for a mention through a product. */
  written: string;
  /** The sentence about it, and where in it `written` starts. */
  sentence: string;
  at: number;
  /** Named through its product, which counts as the brand. */
  viaProduct: boolean;
  /** The matcher was unsure: kept as evidence, counted nowhere. */
  uncertain: boolean;
}

export interface SourceSpec {
  site: Site;
  /** The address as the provider gave it, a referral tag and all. */
  raw: string;
  kind: string;
  tag: string | null;
  flags: string[];
}

export interface AnswerSpec {
  /** What the provider reports for every valid answer of the engine. */
  base: Pick<Answer, 'model_reported' | 'check_url'>;
  /** The words before the first name. */
  lead: string;
  /** Put before each sentence about a party. */
  bullet: string;
  /** The parties in the order the text names them. */
  planned: readonly Planned[];
  /** A second sentence naming one of the parties again. */
  repeat: { planned: Planned; sentence: string; at: number } | null;
  sources: readonly SourceSpec[];
  /** The sentence, with its leading space, that quotes the address of the first inline source. */
  inline: (address: string) => string;
  /** The last words, with their leading space. */
  closing: string;
  /** The provider cut the answer off: it is `partial`, still valid. */
  partial: boolean;
  /** The product that counts as the brand when it is named, with an entity of its own. */
  product: { entity_id: string; name: string } | null;
}

/** Everything an answer says is about the facts of its fact row, which are what the summary counts. */
export const NOT_VALID: Facts = {
  derivation_id: 1,
  is_valid: false,
  // Null for an answer that is not valid: it is in no bucket (the API's `ObservationFacts.outcome`)
  outcome: null,
  own_mentioned: false,
  own_domain_cited: false,
  own_mention_order: null,
  own_prominence: null,
  own_citation_count: 0,
  total_citation_count: 0,
  tracked_entities_mentioned: 0,
  competitor_mentions: [],
  competitor_cited: [],
  had_structured_list: false,
};

/** The three answers that are not valid. A refusal keeps its text, an error its code, an empty answer neither. */
export function invalidAnswer(
  kind: 'error' | 'refused' | 'empty',
  base: AnswerSpec['base'],
  errorCode = '50000',
): Answer {
  if (kind === 'error') {
    return {
      ...base,
      status: 'error',
      answer_text: null,
      // The provider's task status code as text, which is what the backend stores (`missing` when it sent none)
      error_code: errorCode,
      model_reported: null,
      check_url: null,
      mentions: [],
      citations: [],
      facts: NOT_VALID,
    };
  }
  return {
    ...base,
    status: kind,
    answer_text: kind === 'refused' ? 'I cannot help with that request.' : null,
    error_code: null,
    mentions: [],
    citations: [],
    facts: NOT_VALID,
  };
}

/**
 * The valid answer a plan describes. Each span is in UTF-16 code units of `answer_text`, as the API's detail
 * gives them; the mentions are numbered in the order the text names the accepted own and competitor parties.
 */
export function buildAnswer(spec: AnswerSpec): Answer {
  // The text: an emoji before the names moves every span on by two UTF-16 units, so a viewer must not count characters
  let text = spec.lead;
  const spans = new Map<Planned, [number, number][]>();
  for (const item of spec.planned) {
    text += ` ${spec.bullet}`;
    const start = text.length + item.at;
    text += item.sentence;
    spans.set(item, [[start, start + item.written.length]]);
  }
  if (spec.repeat !== null) {
    text += ' ';
    const start = text.length + spec.repeat.at;
    text += spec.repeat.sentence;
    spans.get(spec.repeat.planned)?.push([start, start + spec.repeat.planned.written.length]);
  }
  const quoted = spec.sources.find((source) => source.kind === 'inline');
  if (quoted !== undefined) text += spec.inline(quoted.raw);
  text += spec.closing;

  let order = 0;
  const mentions: MentionOut[] = spec.planned.flatMap((item) => {
    const own = item.who.role === 'own';
    const numbered = !item.uncertain && item.who.role !== 'watch';
    if (numbered) order += 1;
    const evidence = spans.get(item) ?? [];
    const first = evidence[0]?.[0] ?? 0;
    const row: MentionOut = {
      entity_id: item.who.entity_id,
      name: item.who.name,
      role: item.who.role,
      mention_count: evidence.length,
      first_char_offset: first,
      mention_order: numbered ? order : null,
      match_method: item.viaProduct ? 'via_product' : item.who.role === 'watch' ? 'alias_exact' : 'alias_word',
      mention_status: item.uncertain ? 'uncertain' : 'accepted',
      confidence: item.uncertain ? 0.45 : 0.95,
      evidence_spans: evidence,
    };
    if (!own || !item.viaProduct || spec.product === null) return [row];
    // The product's own row is kept with no number: it is not a member of the set
    const product: MentionOut = {
      ...row,
      entity_id: spec.product.entity_id,
      name: spec.product.name,
      role: 'own',
      mention_order: null,
      match_method: 'alias_word',
    };
    return [row, product];
  });
  // The API lists the numbered mentions first, by number, and the others after them
  mentions.sort(
    (a, b) =>
      (a.mention_order ?? Infinity) - (b.mention_order ?? Infinity) || a.first_char_offset - b.first_char_offset,
  );

  const citations: CitationOut[] = spec.sources.map((source, place) => ({
    citation_index: place + 1,
    url: source.site.url,
    raw_url: source.raw,
    host: source.site.host,
    title: source.site.title,
    source_name: source.site.source_name,
    citation_kind: source.kind,
    domain_role: source.site.role,
    role_entity_id: source.site.entity_id,
    occurrences: 1,
    first_char_offset: source.kind === 'inline' ? text.indexOf(source.raw) : null,
    answer_block_index: null,
    referral_tag: source.tag,
    flags: source.flags,
  }));

  const counted = mentions.filter((mention) => mention.mention_order !== null);
  const own = counted.filter((mention) => mention.role === 'own');
  const competitors = counted.filter((mention) => mention.role === 'competitor');
  const ownCitations = citations.filter((citation) => citation.domain_role === 'own');
  const firstOwn = own[0];
  const length = [...text].length;
  const facts: Facts = {
    derivation_id: 1,
    is_valid: true,
    outcome:
      own.length > 0
        ? ownCitations.length > 0
          ? 'mentioned_and_cited'
          : 'mentioned_only'
        : ownCitations.length > 0
          ? 'cited_only'
          : 'neither',
    own_mentioned: own.length > 0,
    own_domain_cited: ownCitations.length > 0,
    own_mention_order: firstOwn?.mention_order ?? null,
    // 1 minus the first offset over the length, both in code points as the backend counts them
    own_prominence:
      firstOwn === undefined
        ? null
        : Math.round((1 - [...text.slice(0, firstOwn.first_char_offset)].length / length) * 10_000) / 10_000,
    own_citation_count: ownCitations.length,
    total_citation_count: citations.length,
    tracked_entities_mentioned: counted.length,
    competitor_mentions: competitors.map((mention) => mention.entity_id),
    competitor_cited: [
      ...new Set(
        citations.flatMap((citation) =>
          citation.domain_role === 'competitor' && citation.role_entity_id !== null ? [citation.role_entity_id] : [],
        ),
      ),
    ],
    had_structured_list: false,
  };
  return {
    ...spec.base,
    status: spec.partial ? 'partial' : 'complete',
    answer_text: text,
    error_code: null,
    mentions,
    citations,
    facts,
  };
}
