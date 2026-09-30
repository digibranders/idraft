# ADR-011: Keywords and prompts are separate entities with typed many-to-many links

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
A keyword is a search query measured by rank; a prompt is a conversational question measured by rates. Cross-channel analysis needs them connected without pretending they are the same.

## Decision
`core.keyword_prompt_links` with link types (exact_match, manual, generated, semantic, cluster, ai_suggestion, fanout), status and confidence; keyword-level AI data also comes directly from AI Overview and AI Mode keyword runs.

## Alternatives considered
Prompts as keywords with a flag; automatic one-to-one mapping.

## Consequences
Explicit, auditable links; some manual curation needed.

## Revisit trigger
None expected.
