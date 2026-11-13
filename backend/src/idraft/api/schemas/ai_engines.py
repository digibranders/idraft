"""The `provider_params` of a project's AI engine (WP-31; docs/ai-visibility/contracts/
wp-31-engines-device.md). Only the device exists today."""

from __future__ import annotations

from pydantic import BaseModel, Field

from idraft.api.schemas.common import Body
from idraft.domain.ai_engines import EngineDevice


class EngineProviderParams(BaseModel):
    device: EngineDevice | None = Field(
        default=None,
        description="The device the engine asks from. Null when the engine takes no device "
        "(ChatGPT, Gemini). Google AI Mode reads `desktop` until one is saved.",
    )


class EngineProviderParamsUpdate(Body):
    device: EngineDevice = Field(
        description="`desktop` or `mobile`, Google AI Mode only (`422 validation_failed` with "
        "`device_not_supported` for another engine)."
    )
