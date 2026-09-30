# ADR-DS-006: Apache ECharts 6 through an in-house wrapper

Status: Accepted
Date: 2026-09-29

## Context
Charts need depth bands, confidence bands, version-boundary markers, heatmaps, large scatters and small multiples with linked crosshairs. ECharts 6.1 adds `setTheme()` for runtime theme changes and a new default theme.

## Decision
ECharts 6 with tree-shaken imports, a 100-line React wrapper (ResizeObserver, dispose, `setTheme` on theme change), a theme built from CSS tokens, React-rendered legends, animation off. `echarts-for-react` is not used. Sparklines use a small canvas renderer.

## Alternatives considered
Recharts (SVG, weak with thousands of points, used by shadcn charts), visx (build-it-yourself cost), Highcharts (license), Observable Plot (less interactive).

## Tradeoffs
Larger bundle (lazy-loaded chunk of about 170 KB gzip). No keyboard navigation of data points in ECharts, covered by table alternatives.

## Revisit trigger
Bundle or performance budgets fail after tree-shaking, or accessibility requirements demand point-level keyboard access.
