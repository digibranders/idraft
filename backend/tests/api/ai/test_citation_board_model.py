"""The Citations page model (WP-76): pure counting over hand-built answers, the numbers worked
out by hand. Mirrors apps/web/design-preview/cit-data.check.mjs."""

from __future__ import annotations

from idraft.api.schemas.ai_citation_board import BrandCell, RunSlot


def test_a_brand_cell_states_its_counts() -> None:
    cell = BrandCell(cited=1, mentioned=2, answers=3, state="cited")

    assert cell.model_dump() == {"cited": 1, "mentioned": 2, "answers": 3, "state": "cited"}
    assert RunSlot.model_fields["slot"].metadata  # ge=1 is declared
