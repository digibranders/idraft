# ADR-DS-016: Colorblind-validated categorical palette; no pie charts

Status: Accepted
Date: 2026-09-29

## Context
Competitor and engine series must be distinguishable for users with color-vision deficiencies and must not look like good or bad signals.

## Decision
Six series colors chosen by CIEDE2000 separation under normal vision and simulated deuteranopia, protanopia and tritanopia (v2 values: minimum 15.8, 9.6, 8.2, 15.9 in light; the test requires 15 for normal vision and 8 under each simulation), all at least 3:1 against the surface, avoiding semantic green and red hues. Own brand is always series 1. Maximum 6 series, then top 5 plus Other or small multiples. No pie or donut charts in V1.

## Alternatives considered
Okabe-Ito (colorblind-safe, but includes green and vermillion that collide with semantic colors, and dark-mode variants are not defined), Tableau 10.

## Tradeoffs
Palette is custom and must be maintained with its test.

## Revisit trigger
A seventh stable competitor color is needed routinely.
