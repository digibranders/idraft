"""The invitation email. Plain text, with the token in the URL fragment (see auth.mail)."""

from __future__ import annotations

from sightline.api.auth.mail import plain_name
from sightline.providers.email import EmailMessage


def invitation_email(
    *,
    origin: str,
    to: str,
    workspace_name: str,
    inviter_name: str,
    inviter_email: str,
    role: str,
    token: str,
    days: int,
) -> EmailMessage:
    """The message goes to someone who did not ask for it, and two of its lines were typed by
    someone else. Those are reduced to plain words, put in quotes and given a label, after a
    first sentence that is ours: the inviter cannot make the message say something of its own.
    """
    workspace = plain_name(workspace_name) or "(no name)"
    inviter = plain_name(inviter_name) or "(no name)"
    return EmailMessage(
        to=to,
        subject="You are invited to a Sightline workspace",
        text=(
            "Hello,\n\n"
            "You have been invited to a workspace on Sightline.\n\n"
            f'Workspace: "{workspace}"\n'
            f'Invited by: "{inviter}" ({inviter_email})\n'
            f"Invited address: {to}\n"
            f"Role: {role}\n\n"
            "Accept the invitation:\n\n"
            f"{origin}/invite#token={token}\n\n"
            f"The link works for {days} days, and only for an account with the invited address. "
            "If you did not expect this, ignore this message.\n"
        ),
    )
