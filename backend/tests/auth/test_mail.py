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
    message = password_changed_email(
        origin=ORIGIN, to="jane@client.example", name="Jane", signed_out="others"
    )
    assert message.subject == "Your password was changed"
    assert "every other session was signed out" in message.text
    after_reset = password_changed_email(
        origin=ORIGIN, to="jane@client.example", name="Jane", signed_out="all"
    )
    assert "every session was signed out" in after_reset.text
    assert re.findall(r"https://\S+", message.text) == [f"{ORIGIN}/reset-password"]
    assert "token" not in message.text


@pytest.mark.parametrize(
    ("name", "greeting"),
    [
        ("Jane Doe", "Hello Jane Doe,"),
        ("  Jane   Doe  ", "Hello Jane Doe,"),
        ("Se\u00e1n O'Brien-Smith", "Hello Se\u00e1n O'Brien-Smith,"),
        ("Jose\u0301", "Hello Jos\u00e9,"),
        ("\u092a\u094d\u0930\u093f\u092f\u093e", "Hello \u092a\u094d\u0930\u093f\u092f\u093e,"),
        ("\u674e\u5a1c", "Hello \u674e\u5a1c,"),
        ("Jane\r\nBcc: spy@evil.example", "Hello Jane Bcc spy evil example,"),
        ("Jane\x00\x1b[31m", "Hello Jane 31m,"),
        ("Jane\u2028second line", "Hello Jane second line,"),
        ("Jane\u202eelpmaxe", "Hello Jane elpmaxe,"),
        ("Jane\u200bDoe", "Hello Jane Doe,"),
        ("", "Hello,"),
        ("   ", "Hello,"),
        ("...///:::", "Hello,"),
        ("x" * 200, "Hello " + "x" * 80 + ","),
        ("x" * 79 + " yz", "Hello " + "x" * 79 + ","),
        ("https://evil.example/login", "Hello https evil example login,"),
        ("hthttp://tp://evil.example", "Hello hthttp tp evil example,"),
        ("www.evil.example", "Hello www evil example,"),
        ("mailto:phish@evil.example", "Hello mailto phish evil example,"),
        ("Jane, ignore the link below and use evil.example/x", None),
    ],
)
def test_a_name_cannot_add_lines_or_links(name: str, greeting: str | None) -> None:
    message = verification_email(origin=ORIGIN, to="jane@client.example", name=name, token=TOKEN)
    first_line = message.text.splitlines()[0]
    if greeting is not None:
        assert first_line == greeting
    # Nothing a mail client turns into a link: no dot, slash, colon or at sign survives.
    assert not set(first_line) & set("./:@\\")
    assert first_line.endswith(",")
    assert re.findall(r"https?://\S+", message.text) == [f"{ORIGIN}/verify-email#token={TOKEN}"]
    assert message.text.split("\n\n")[0] == first_line


def test_no_message_contains_a_dash_that_marks_generated_text() -> None:
    messages = [
        verification_email(origin=ORIGIN, to="a@b.example", name="Jane", token=TOKEN),
        password_reset_email(origin=ORIGIN, to="a@b.example", name="Jane", token=TOKEN),
        password_changed_email(origin=ORIGIN, to="a@b.example", name="Jane", signed_out="all"),
    ]
    for message in messages:
        written = message.subject + message.text
        assert chr(0x2014) not in written
        assert chr(0x2013) not in written
