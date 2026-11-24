"""What the screenshot route and `latest` tests share: a project with one ChatGPT answer of a
given age, and the application's screenshot service rebuilt on fakes (provider, download, store)
that count what they are asked."""

from __future__ import annotations

import io
import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import FastAPI
from PIL import Image, ImageDraw

from idraft.api.ai.screenshots import ScreenshotService
from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from idraft.providers.dataforseo.screenshot import SCREENSHOT_HEIGHT
from tests.api.auth.support import Workspace, fetchrow, make_workspace
from tests.api.entities.support import Caller, member
from tests.api.keywords.support import ensure_locations, project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import (
    OWN_HOST,
    OWN_NAME,
    add_prompt,
    chatgpt_answer,
    enable_engine,
    fetched_ai_task,
)
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

ANSWER = f"{OWN_NAME} runs a managed SOC service in Mumbai with 24x7 monitoring."
IMAGE_LINK = "https://api.dataforseo.com/v3/serp/screenshot/abc.png"


def page_png(height: int = SCREENSHOT_HEIGHT) -> bytes:
    """A capture as tall as the one asked for: a light page with one dark block, which is all
    that trimming keeps."""
    image = Image.new("RGB", (1920, height), (250, 250, 250))
    ImageDraw.Draw(image).rectangle((800, 100, 1400, 900), fill=(20, 20, 20))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


@dataclass
class FakeCapture:
    """The provider, the download and the store of the screenshot service."""

    store: MemoryStore = field(default_factory=MemoryStore)
    provider_calls: int = 0
    image: bytes | None = None
    task_ids: list[str] = field(default_factory=list)

    async def screenshot(self, task_id: str) -> tuple[str, Decimal]:
        self.provider_calls += 1
        self.task_ids.append(task_id)
        return IMAGE_LINK, Decimal("0.004")

    async def download(self, url: str) -> bytes:
        return page_png() if self.image is None else self.image


@dataclass(frozen=True)
class ShotWorld:
    workspace: Workspace
    project: Project
    writer: Caller
    reader: Caller
    observation_id: int
    task_id: str

    def url(self, *parts: object) -> str:
        return project_url(self.workspace, self.project.id, "ai", *parts)

    @property
    def screenshot_url(self) -> str:
        return self.url("observations", self.observation_id, "screenshot")


async def build_world(
    resources: Resources,
    pg: PostgresServer,
    worker_db: Ledger,
    store: MemoryStore,
    *,
    age: timedelta,
    engine_code: str = "chatgpt_web",
) -> ShotWorld:
    """One project with one valid answer on the engine, `age` old."""
    workspace = await make_workspace(pg)
    writer = await member(resources, pg, workspace, "owner")
    reader = await member(resources, pg, workspace, "viewer")
    await ensure_locations(pg)
    project = Project(workspace.id, await make_project(pg, workspace.id))
    await _entity(pg, project, OWN_NAME, OWN_HOST, "own", primary=True)
    await enable_engine(pg, project, engine_code)
    prompt = await add_prompt(pg, project, "What are the best managed SOC providers in India?")
    when = datetime.now(UTC).replace(microsecond=0) - age
    task = await fetched_ai_task(
        worker_db,
        pg,
        project,
        prompt,
        chatgpt_answer(ANSWER, ["https://news.example/soc"], when=when),
        store,
        engine_code=engine_code,
        fetched_at=when,
    )
    await ingest(worker_db, store)
    row = await fetchrow(
        pg,
        "SELECT id, provider_task_id FROM ai.observations WHERE collection_task_id = $1",
        task,
    )
    return ShotWorld(
        workspace, project, writer, reader, row["id"], row["provider_task_id"] or str(uuid.uuid4())
    )


def use_fakes(app: FastAPI, resources: Resources, *, configured: bool = True) -> FakeCapture:
    """Swap the application's screenshot service for one on fakes; returns them. Not
    `configured`: the installation has no DataForSEO account, so there is no provider."""
    fake = FakeCapture()
    app.state.resources = replace(
        resources,
        ai_screenshots=ScreenshotService(
            sessions=resources.sessions,
            store=fake.store,
            provider=fake if configured else None,
            download=fake.download,
        ),
    )
    return fake
