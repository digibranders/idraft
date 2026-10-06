"""Rank rules (docs/09-seo-metrics-and-rank-methodology.md sections 1 to 4): who ranks where on a
normalized SERP, how a keyword's state moves from one check to the next, and which rank events
a check causes. Pure: no I/O and no database; the ingest writer in `sightline.collectors` reads
and writes the rows around these rules."""
