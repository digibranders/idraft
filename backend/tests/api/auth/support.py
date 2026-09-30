"""Helpers for auth tests: users and sessions made directly, a mailbox, probe routes."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import asyncpg
from fastapi import APIRouter

from sightline.api.auth.dependencies import CurrentSession, FreshSession, PendingOrActiveSession
from sightline.api.auth.passwords import hash_password
from sightline.api.auth.sessions import SessionContext
from sightline.api.resources import Resources
from sightline.providers.email import EmailMessage
from tests.conftest import PostgresServer

PASSWORD = "correct horse battery staple"
# Hashed once: argon2id is slow on purpose, and most tests only need a user who can sign in.
PASSWORD_HASH = hash_password(PASSWORD)
COOKIE = "__Host-session"


@dataclass
class RecordingEmailSender:
    messages: list[EmailMessage] = field(default_factory=list)

    async def send(self, message: EmailMessage) -> None:
        self.messages.append(message)


@dataclass(frozen=True)
class User:
    id: uuid.UUID
    email: str
    name: str
    password: str = PASSWORD


async def make_user(
    pg: PostgresServer,
    *,
    verified: bool = True,
    disabled: bool = False,
    name: str = "Jane Doe",
    email: str | None = None,
    password_hash: str = PASSWORD_HASH,
) -> User:
    address = email or f"user-{uuid.uuid4().hex[:12]}@client.example"
    db = await asyncpg.connect(pg.url())
    try:
        user_id: uuid.UUID = await db.fetchval(
            "INSERT INTO auth.users (email, name, password_hash, email_verified_at, disabled_at) "
            "VALUES ($1, $2, $3, $4, $5) RETURNING id",
            address,
            name,
            password_hash,
            datetime.now(UTC) if verified else None,
            datetime.now(UTC) if disabled else None,
        )
    finally:
        await db.close()
    return User(id=user_id, email=address, name=name)


async def execute(pg: PostgresServer, statement: str, *arguments: Any) -> str:
    db = await asyncpg.connect(pg.url())
    try:
        result: str = await db.execute(statement, *arguments)
    finally:
        await db.close()
    return result


async def fetchrow(pg: PostgresServer, statement: str, *arguments: Any) -> asyncpg.Record:
    db = await asyncpg.connect(pg.url())
    try:
        row = await db.fetchrow(statement, *arguments)
    finally:
        await db.close()
    assert row is not None
    return row


async def fetch(pg: PostgresServer, statement: str, *arguments: Any) -> list[asyncpg.Record]:
    db = await asyncpg.connect(pg.url())
    try:
        return list(await db.fetch(statement, *arguments))
    finally:
        await db.close()


async def open_session(
    resources: Resources,
    user: User,
    *,
    state: str = "active",
    fresh: bool = False,
) -> tuple[str, SessionContext]:
    """A session made the way sign-in makes one, without going through sign-in."""
    async with resources.sessions() as db, db.begin():
        return await resources.session_store.create(
            db,
            user_id=user.id,
            state="pending_totp" if state == "pending_totp" else "active",
            fresh=fresh,
            ip="203.0.113.7",
            user_agent="pytest",
            now=datetime.now(UTC),
        )


def cookie(token: str) -> dict[str, str]:
    return {"Cookie": f"{COOKIE}={token}"}


probes = APIRouter(prefix="/api/v1/_probe")


def _describe(session: SessionContext) -> dict[str, str]:
    return {
        "user_id": str(session.user_id),
        "session_id": str(session.session_id),
        "state": session.state,
    }


@probes.get("/current")
async def probe_current(session: CurrentSession) -> dict[str, str]:
    return _describe(session)


@probes.get("/pending")
async def probe_pending(session: PendingOrActiveSession) -> dict[str, str]:
    return _describe(session)


@probes.get("/fresh")
async def probe_fresh(session: FreshSession) -> dict[str, str]:
    return _describe(session)


@probes.get("/boom")
async def probe_boom(session: CurrentSession) -> None:
    raise RuntimeError("kaput")


@probes.get("/open")
@probes.post("/open")
@probes.put("/open")
@probes.patch("/open")
@probes.delete("/open")
async def probe_open() -> dict[str, bool]:
    return {"ok": True}
