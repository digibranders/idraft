# Sample AI answers

`onboarding.json` holds 20 short answers written for the Phase 2 acceptance test (docs/29, "Phase 2:
Brands, entities, domains, taxonomy": the alias test tool highlights correct spans on 20 sample
answers). They are synthetic: no
collected answer is stored in the repository yet. Each one exercises a rule of doc 13 stages 4 and 5
against the brand and competitors that `tests/api/test_onboarding.py` sets up: a word alias, a
case-sensitive alias, a negative, an ambiguous name with a hint, without one, and as the plural
that opens a sentence (where its capital earns nothing), a domain-shaped alias, a word boundary,
and markdown matched as its source text.

`spans` lists every span the alias test reports, in text order: the entity's canonical name, the
text the span covers and its status.
