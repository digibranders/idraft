# AI visibility programme: index

Everything needed to build the whole AI visibility feature with many sessions at once, and to see its progress in one place.

| File | What it is | Who uses it |
|---|---|---|
| [owner-requirements.md](owner-requirements.md) | The owner's requirements R-01 to R-11, appended as they come | Everyone; the coordinator appends |
| [MASTER-PLAN.md](MASTER-PLAN.md) | The plan: summary and schedule, owner decisions, the fan-out architecture, file ownership, the lock, models and review, waves, contradictions, risks, coverage | The owner reads section 1 and 2; every session reads 3 to 6 |
| [TRACKER.md](TRACKER.md) | The one progress view: every package with status, rows done and blockers | The owner |
| [tracker.json](tracker.json) | The same, machine readable, with rows per package, decisions, the excluded register and leases | The coordinator (sole writer) |
| [work-packages/](work-packages/) | One self-contained brief per package (WP-00 to WP-73): goal, rows, owned files, dependencies, contract, model plan, steps, acceptance, review, push, report | The session that runs the package |
| [inventory/backend.md](inventory/backend.md) | 298 backend capabilities BE-*, build order, contract groups C1 to C15 | Backend packages |
| [inventory/web.md](inventory/web.md) | 537 web elements WB-*, sitemap, shared components SC-*, contract needs CF-* | Web packages |
| [inventory/overview-and-charts.md](inventory/overview-and-charts.md) | The Overview, 46 charts CH-*, card catalog, presets, topics by engine, API needs N1 to N15 | Overview and chart packages |
| [inventory/prompt-dialogs.md](inventory/prompt-dialogs.md) | Add, Import, Generate, Edit, Versions, Panels flows PD-*, API needs N01 to N14 | Dialog packages |
| contracts/ (created by WP-03) | One note per API contract group with a change log | Backend and web packages |

## How to use it

**Owner.** Read MASTER-PLAN sections 1 and 2, answer the decisions by ID, then follow TRACKER.md. Say "ship it" when a ship candidate of section 1 is ready.

**Coordinator session.** Start WP-00 first. Dispatch the next ready package to a free session (section 3.1), keep at most five working sessions, read the status files, update tracker.json and TRACKER.md, record leases, run the quality sweep at each wave end and releases only on the owner's word.

**A package session.** Open its file in work-packages/, run step 0, follow the steps, report at each status change. Do not touch files other packages own; ask for a lease.

Row ids are stable: a row's id in a package file is the same id as in its inventory, except the API needs, which are namespaced OV-N (Overview) and PD-N or PD-B (dialogs).
