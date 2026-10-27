"""The metric contract (docs/19-api-specification.md section 2.6), as far as the routes built so
far use it, and money as a decimal string."""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, PlainSerializer, WithJsonSchema

# Money is a decimal string, never a float (docs/19 section 2.12).
Usd = Annotated[
    Decimal,
    PlainSerializer(lambda value: format(value, "f"), return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "pattern": r"^-?\d+(\.\d+)?$", "examples": ["0.012000"]}),
]

MetricUnit = Literal["ratio", "count", "rank", "score", "usd", "clicks"]


class MetricWindow(BaseModel):
    from_: str = Field(alias="from", serialization_alias="from")
    to: str
    timezone: str

    model_config = {"populate_by_name": True}


class MetricValue(BaseModel):
    """A metric with what it was computed from. Fields of doc 19 section 2.6 that no route
    built so far fills (`ci`, `aggregation`, `engines`, ...) are left out until one does."""

    metric: str
    value: float | None
    numerator: float | None
    denominator: float | None
    unit: MetricUnit
    n_observations: int
    n_keywords: int | None = None
    window: MetricWindow
    filters: dict[str, object]
    is_estimate: bool
    method: str
    method_version: int
    source: str | None = None
