import re

import pytest

from sightline.api.auth.mail import (
    password_changed_email,
    password_reset_email,
    verification_email,
)

ORIGIN = "https://app.example.com"
TOKEN = "4f3c2b1a-TOKEN_value-43chars-aaaaaaaaaaaaaaaaaaa"


def test_the_verification_link_carries_the_token_in_the_fragment() -> None:
    message = verification_email(origin=ORIGIN, to="jane@client.example", name="Jane", token=TOKEN)
    assert message.to == "jane@client.example"
    assert message.subject == "Confirm your email address"
    links = re.findall(r"https://\S+", message.text)
    assert links == [f"{ORIGIN}/verify-email#token={TOKEN}"]
    assert "24 hours" in message.text
    assert message.text.startswith("Hello Jane,\n")


def test_the_reset_link_carries_the_token_in_the_fragment() -> None:
    message = password_reset_email(
        origin=ORIGIN, to="jane@client.example", name="Jane", token=TOKEN
    )
    assert message.subject == "Reset your password"
    assert re.findall(r"https://\S+", message.text) == [f"{ORIGIN}/reset-password#token={TOKEN}"]
    assert "1 hour" in message.text
    assert "did not ask" in message.text


def test_the_password_changed_notice_has_no_token_and_one_link() -> None:
    message = password_changed_email(origin=ORIGIN, to="jane@client.example", name="Jane")
    assert message.subject == "Your password was changed"
    assert re.findall(r"https://\S+", message.text) == [f"{ORIGIN}/reset-password"]
    assert "token" not in message.text


@pytest.mark.parametrize(
    ("name", "greeting"),
    [
        ("Jane\r\nBcc: spy@evil.example", "Hello Jane Bcc: spy@evil.example,"),
        ("  Jane   Doe  ", "Hello Jane Doe,"),
        ("Jane\x00\x1b[31m", "Hello Jane [31m,"),
        ("", "Hello,"),
        ("   ", "Hello,"),
        ("x" * 200, "Hello " + "x" * 80 + ","),
        ("https://evil.example/login", "Hello evil.example/login,"),
    ],
)
def test_a_name_cannot_add_lines_or_links(name: str, greeting: str) -> None:
    message = verification_email(origin=ORIGIN, to="jane@client.example", name=name, token=TOKEN)
    assert message.text.splitlines()[0] == greeting
    assert re.findall(r"https?://\S+", message.text) == [f"{ORIGIN}/verify-email#token={TOKEN}"]


def test_no_message_contains_a_dash_that_marks_generated_text() -> None:
    messages = [
        verification_email(origin=ORIGIN, to="a@b.example", name="Jane", token=TOKEN),
        password_reset_email(origin=ORIGIN, to="a@b.example", name="Jane", token=TOKEN),
        password_changed_email(origin=ORIGIN, to="a@b.example", name="Jane"),
    ]
    for message in messages:
        written = message.subject + message.text
        assert chr(0x2014) not in written
        assert chr(0x2013) not in written
