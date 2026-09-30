import json

import httpx
import pytest

from sightline.providers.email import (
    ConsoleEmailSender,
    EmailMessage,
    EmailSendError,
    ResendEmailSender,
    build_email_sender,
)

MESSAGE = EmailMessage(
    to="jane@client.example", subject="Confirm your email", text="Open the link.\n"
)
API_KEY = "re_SECRET_KEY_123"


def _sender(transport: httpx.MockTransport) -> tuple[ResendEmailSender, httpx.AsyncClient]:
    client = httpx.AsyncClient(transport=transport)
    return (
        ResendEmailSender(client, api_key=API_KEY, sender="Sightline <login@mail.example.com>"),
        client,
    )


async def test_resend_receives_one_authenticated_json_post() -> None:
    seen: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "4ef9a417"})

    sender, client = _sender(httpx.MockTransport(respond))
    async with client:
        await sender.send(MESSAGE)

    assert len(seen) == 1
    request = seen[0]
    assert (request.method, str(request.url)) == ("POST", "https://api.resend.com/emails")
    assert request.headers["Authorization"] == f"Bearer {API_KEY}"
    assert request.headers["Content-Type"] == "application/json"
    assert json.loads(request.content) == {
        "from": "Sightline <login@mail.example.com>",
        "to": ["jane@client.example"],
        "subject": "Confirm your email",
        "text": "Open the link.\n",
    }


@pytest.mark.parametrize("status", [400, 401, 403, 422, 429, 500, 503])
async def test_a_refusal_raises_with_the_status_and_nothing_secret(status: int) -> None:
    def respond(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status, json={"message": f"bad key {API_KEY} for jane@client.example"}
        )

    sender, client = _sender(httpx.MockTransport(respond))
    async with client:
        with pytest.raises(EmailSendError) as error:
            await sender.send(MESSAGE)

    assert str(error.value) == f"the email provider answered {status}"
    assert error.value.__cause__ is None
    assert API_KEY not in repr(error.value)


@pytest.mark.parametrize("failure", [httpx.ConnectTimeout, httpx.ReadTimeout, httpx.ConnectError])
async def test_a_network_failure_raises_without_the_key(
    failure: type[httpx.TransportError],
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        raise failure(f"failed with Bearer {API_KEY}", request=request)

    sender, client = _sender(httpx.MockTransport(respond))
    async with client:
        with pytest.raises(EmailSendError) as error:
            await sender.send(MESSAGE)

    assert str(error.value) == f"the email provider could not be reached: {failure.__name__}"
    assert error.value.__cause__ is None
    assert error.value.__suppress_context__ is True


async def test_the_console_sender_writes_the_whole_message_to_stderr(
    capsys: pytest.CaptureFixture[str],
) -> None:
    await ConsoleEmailSender().send(MESSAGE)
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "To: jane@client.example" in captured.err
    assert "Subject: Confirm your email" in captured.err
    assert "Open the link." in captured.err


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("to", "jane@client.example\r\nBcc: spy@evil.example"),
        ("to", "jane@client.example\nBcc: spy@evil.example"),
        ("to", "not an address"),
        ("to", ""),
        ("subject", "Hello\r\nBcc: spy@evil.example"),
        ("subject", "Hello\x00"),
        ("subject", ""),
    ],
)
def test_a_message_cannot_carry_a_second_header(field: str, value: str) -> None:
    values = {"to": "jane@client.example", "subject": "Hello", "text": "Body"}
    values[field] = value
    with pytest.raises(ValueError, match=field):
        EmailMessage(**values)


async def test_the_sender_is_chosen_by_the_provider_name() -> None:
    async with httpx.AsyncClient() as client:
        console = build_email_sender(client, provider="console", api_key=None, sender="a@b.example")
        resend = build_email_sender(
            client, provider="resend", api_key=API_KEY, sender="Sightline <login@mail.example.com>"
        )
        with pytest.raises(ValueError, match="needs an API key"):
            build_email_sender(client, provider="resend", api_key=None, sender="a@b.example")
    assert isinstance(console, ConsoleEmailSender)
    assert isinstance(resend, ResendEmailSender)
