# ADR-015: Deterministic extraction first; budgeted LLM adjudication

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
Brand and citation extraction must be reproducible, cheap and auditable. Open-source trackers that ask an LLM whether a brand was mentioned produce non-reproducible results.

## Decision
Stages: URL canonicalization, domain roles, document structure, Aho-Corasick alias matching with negative aliases, disambiguation rules, ranked-list parsing, rule-based recommendation and sentiment; an LLM only for uncertain items, batched, JSON-validated, cached, capped per project. Outputs versioned by derivation.

## Alternatives considered
LLM-first extraction; NER-model-first extraction on the droplet.

## Consequences
Reproducible metrics with evidence spans; some rules need tuning on the gold set.

## Revisit trigger
Gold-set targets unreachable with rules plus budgeted adjudication.

## Amendment (2026-10-31)
Host note only: "the droplet" above is now the idraft 8 GB share of the shared Hostinger VPS ([ADR-023](ADR-023-shared-hostinger-vps.md)). The decision is unchanged.
