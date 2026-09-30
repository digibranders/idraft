"""The Phase 0 test runs against the live DataForSEO API (docs/01-research-findings.md section
12, docs/06-dataforseo-seo-integration.md section 11).

They spend real money. Each run needs `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` in its
environment and a spending cap on its command line, refuses to start when its estimate is over
the cap, and stops sending once the costs DataForSEO reports reach it. Run them only when the
product owner says so. Results are written to `docs/spikes/S-xx.md`.
"""
