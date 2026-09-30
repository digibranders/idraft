# ADR-010: Replicate-based AI measurement with honest intervals

Status: Accepted (pending Phase 0 validation where noted)
Date: 2026-09-29

## Context
AI answers are stochastic. Single-run ranks are noise. Panel-level metrics are precise with many prompts; per-prompt metrics need replicates.

## Decision
Default: all core prompts once per engine per week, a priority subset (importance 1, up to 100) with 3 replicates on ChatGPT and Gemini. Prompt-weighted rates; Wilson intervals (pooled Wilson when any prompt has one observation, which is conservative for a fixed panel); paired comparisons across periods; BH filtering for lists; detectable-change rule for colors.

## Alternatives considered
Many replicates per prompt (expensive, adds little when replicates correlate); no intervals (false precision); single composite score.

## Consequences
Breadth over depth; honest uncertainty; replicate policy revised after S-05.

## Revisit trigger
S-05 shows replicates are near-duplicates, or customers need per-prompt precision that justifies more replicates.
