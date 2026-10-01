import type { components } from '@/lib/api/schema';

type MatchScope = components['schemas']['EntityDomain']['match_scope'];
type MatchMode = components['schemas']['AliasInput']['match_mode'];
type MatchMethod = components['schemas']['AliasTestSpan']['match_method'];

/** The catalog keys of the API's values, which are snake case while catalog keys are camel case. */
export const SCOPE_KEY: Readonly<Record<MatchScope, 'registrable' | 'host' | 'pathPrefix'>> = {
  registrable: 'registrable',
  host: 'host',
  path_prefix: 'pathPrefix',
};

export const MODE_KEY: Readonly<Record<MatchMode, 'wordBoundary' | 'exactCase' | 'substring' | 'regex'>> = {
  word_boundary: 'wordBoundary',
  exact_case: 'exactCase',
  substring: 'substring',
  regex: 'regex',
};

export const METHOD_KEY: Readonly<
  Record<
    MatchMethod,
    'aliasWord' | 'aliasExact' | 'aliasSubstring' | 'aliasRegex' | 'aliasName' | 'aliasDomain' | 'viaProduct'
  >
> = {
  alias_word: 'aliasWord',
  alias_exact: 'aliasExact',
  alias_substring: 'aliasSubstring',
  alias_regex: 'aliasRegex',
  alias_name: 'aliasName',
  alias_domain: 'aliasDomain',
  via_product: 'viaProduct',
};
