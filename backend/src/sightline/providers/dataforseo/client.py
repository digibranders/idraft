"""Calls to DataForSEO: a turn under the rate limit first, then the request, and an exact
account of how a failed call failed (docs/06-dataforseo-seo-integration.md sections 3.2 and 9).

What a failure means depends on whether the call was sending tasks. A call that never reached
the provider sent nothing and may simply be made again. A call that may have reached it (a
timeout, a dropped connection, an answer that cannot be read) has an unknown outcome when it
was posting tasks: they may have been created and charged, so the kind is `timeout` and the
tasks are not sent again blind. When it was only reading, trying again costs nothing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Final, Literal

import httpx
import structlog
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from sightline.domain.retries import ProviderErrorKind
from sightline.providers.contract import (
    CallGate,
    GateUnavailableError,
    Limit,
    ProviderCallError,
    ProviderError,
)
from sightline.providers.dataforseo.errors import (
    MESSAGE_MAX,
    parse_retry_after,
    read_http,
    read_status,
)

K = ProviderErrorKind

API_ORIGIN: Final = "https://api.dataforseo.com"
# The account allows 2,000 calls a minute; half is taken, which leaves room for fetches and
# the operator's own calls (doc 06 section 3.2).
ALL_CALLS: Final = Limit(per_minute=1_000, burst=100)
# Endpoints with a limit of their own, by the family a call names when it takes its turn.
FAMILY_LIMITS: Final = {
    "tasks_ready": Limit(per_minute=20, burst=5),
    "id_list": Limit(per_minute=10, burst=2),
    "user_data": Limit(per_minute=6, burst=1),
    "errors": Limit(per_minute=10, burst=2),
}
# How long a call waits for its turn before it is given up without being made.
TURN_WAIT: Final = timedelta(seconds=30)
TIMEOUT: Final = httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)
# The largest answer kept. A top-100 SERP with every feature is a few megabytes (spike S-02
# measures it); a larger answer is not what was asked for.
BODY_MAX: Final = 64 * 1024 * 1024
_log = structlog.get_logger(__name__)


class Envelope(BaseModel):
    """The part of every DataForSEO answer that says whether the call worked. Each task is
    read on its own, so one task the adapter cannot read does not hide the others."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    status_code: int
    status_message: str = ""
    tasks: list[object] | None = None


class TaskAnswer(BaseModel):
    """One task of an answer."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    id: str | None = Field(default=None, min_length=1)
    status_code: int
    status_message: str = ""
    # As parsed: a cost that is not one must not make the task unreadable, when the task
    # itself was created. The adapter decides what it is worth.
    cost: object = None
    data: dict[str, object] | None = None
    result: list[object] | None = None


@dataclass(frozen=True, slots=True)
class Answered:
    """An answer whose call worked as a whole. `content` is the body exactly as received."""

    content: bytes
    content_type: str
    envelope: Envelope
    # In the order of the answer; None for an entry that is not a readable task.
    tasks: tuple[TaskAnswer | None, ...]


def _read_task(entry: object) -> TaskAnswer | None:
    try:
        return TaskAnswer.model_validate(entry)
    except ValidationError:
        return None


class _TooLargeError(Exception):
    pass


def _unreadable(*, sending: bool) -> K:
    return K.TIMEOUT if sending else K.PROVIDER_ERROR


def _message_of(content: bytes) -> str:
    """The provider's own words about a refused call, when its body has them."""
    try:
        body = json.loads(content)
    except ValueError:
        return ""
    message = body.get("status_message") if isinstance(body, dict) else None
    return message[:MESSAGE_MAX] if isinstance(message, str) else ""


class DataForSeoClient:
    """One DataForSEO account, through one shared `httpx.AsyncClient`."""

    def __init__(
        self,
        http: httpx.AsyncClient,
        gate: CallGate,
        *,
        login: str,
        password: str,
        origin: str = API_ORIGIN,
    ) -> None:
        if not login.strip():
            raise ValueError("a DataForSEO client needs a login")
        if not password:
            raise ValueError("a DataForSEO client needs a password")
        self._http = http
        self._gate = gate
        # Kept only as the header it becomes, so the password is in no attribute of its own.
        self._auth = httpx.BasicAuth(login.strip(), password)
        self._origin = origin.rstrip("/")

    def __repr__(self) -> str:
        return f"DataForSeoClient(origin={self._origin!r})"

    async def call(
        self,
        method: Literal["GET", "POST"],
        path: str,
        *,
        family: str | None = None,
        sending: bool = False,
        body: list[dict[str, object]] | None = None,
    ) -> Answered:
        """Make one call. Raises `ProviderCallError` when the call failed as a whole; what the
        answer says of each task is the caller's to read. `sending`: the call posts tasks."""
        await self._take_turn(family)
        status, headers, content = await self._send(method, path, body=body, sending=sending)
        error = read_http(
            status,
            _message_of(content),
            sending=sending,
            retry_after=parse_retry_after(headers.get("retry-after")),
        )
        if error is not None:
            await self._refused(error)
        envelope = self._read_envelope(content, sending=sending)
        outcome = read_status(envelope.status_code, envelope.status_message, sending=sending)
        if isinstance(outcome, ProviderError):
            await self._refused(outcome)
        content_type = headers.get("content-type", "application/json").split(";")[0].strip()
        return Answered(
            content=content,
            content_type=content_type or "application/json",
            envelope=envelope,
            tasks=tuple(_read_task(entry) for entry in envelope.tasks or ()),
        )

    async def slow_if_limited(self, error: ProviderError) -> None:
        """What the provider's refusal means for the calls to come: a rate limit slows them.
        Slowing down is not worth losing the answer over, so a limiter that cannot be
        reached is let be."""
        if error.kind is not K.RATE_LIMITED:
            return
        try:
            await self._gate.slow_down()
        except GateUnavailableError as failure:
            _log.warning("limiter not slowed", error_kind=str(failure))

    async def _refused(self, error: ProviderError) -> None:
        await self.slow_if_limited(error)
        raise ProviderCallError(error)

    async def _take_turn(self, family: str | None) -> None:
        # Either way the call is not made, so the provider never sees it: `throttled`, and
        # never a rate limit of the provider's.
        try:
            turn = await self._gate.enter(family, within=TURN_WAIT)
        except GateUnavailableError as error:
            message = f"the call limiter could not be reached: {error}"
        else:
            if turn:
                return
            message = "no turn under the call limit came in time"
        raise ProviderCallError(ProviderError(kind=K.THROTTLED, message=message)) from None

    async def _send(
        self,
        method: Literal["GET", "POST"],
        path: str,
        *,
        body: list[dict[str, object]] | None,
        sending: bool,
    ) -> tuple[int, httpx.Headers, bytes]:
        try:
            async with self._http.stream(
                method,
                f"{self._origin}{path}",
                json=body if method == "POST" else None,
                auth=self._auth,
                timeout=TIMEOUT,
                # Whatever the client's default: a redirect would send the credentials on.
                follow_redirects=False,
            ) as response:
                content = await self._read_capped(response)
                return response.status_code, response.headers, content
        # `from None` on each: the original may quote the request.
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as error:
            kind, name = K.UPSTREAM_UNAVAILABLE, type(error).__name__
        except httpx.TimeoutException as error:
            kind, name = K.TIMEOUT, type(error).__name__
        except httpx.HTTPError as error:
            kind, name = _unreadable(sending=sending), type(error).__name__
        except _TooLargeError:
            kind = _unreadable(sending=sending)
            name = f"the answer was larger than {BODY_MAX} bytes"
        raise ProviderCallError(ProviderError(kind=kind, message=name)) from None

    @staticmethod
    async def _read_capped(response: httpx.Response) -> bytes:
        chunks: list[bytes] = []
        size = 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > BODY_MAX:
                raise _TooLargeError
            chunks.append(chunk)
        return b"".join(chunks)

    @staticmethod
    def _read_envelope(content: bytes, *, sending: bool) -> Envelope:
        try:
            # Costs are money: read as decimals, never as binary fractions.
            return Envelope.model_validate(json.loads(content, parse_float=Decimal))
        except (ValueError, ValidationError):
            raise ProviderCallError(
                ProviderError(
                    kind=_unreadable(sending=sending),
                    message="the answer was not DataForSEO's JSON",
                )
            ) from None
