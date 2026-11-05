"""`ops.secrets`: put, read and delete one secret. Run inside the workspace's transaction."""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import secrets
from idraft.vault.envelope import EnvelopeCipher, SealedSecret, SecretUnreadableError

REFRESH_TOKEN = "oauth_refresh_token"


async def put(
    db: AsyncSession,
    cipher: EnvelopeCipher,
    *,
    workspace_id: UUID,
    kind: str,
    plaintext: str,
) -> UUID:
    """Encrypt `plaintext` and store it as a new secret. A secret is replaced by putting a new
    one and deleting the old; the API role cannot update a row."""
    secret_id = uuid4()
    sealed = cipher.seal(plaintext, secret_id=secret_id, workspace_id=workspace_id, kind=kind)
    await db.execute(
        insert(secrets).values(
            id=secret_id,
            workspace_id=workspace_id,
            kind=kind,
            ciphertext=sealed.ciphertext,
            dek_wrapped=sealed.dek_wrapped,
            kek_version=sealed.kek_version,
            fingerprint=sealed.fingerprint,
        )
    )
    return secret_id


async def read(
    db: AsyncSession, cipher: EnvelopeCipher, *, workspace_id: UUID, secret_id: UUID, kind: str
) -> str:
    """The plaintext. Raises `SecretUnreadableError` when there is no such secret in the
    workspace or it cannot be decrypted; the caller keeps the plaintext in memory only."""
    row = (
        await db.execute(
            select(secrets.c.ciphertext, secrets.c.dek_wrapped, secrets.c.kek_version).where(
                secrets.c.id == secret_id,
                secrets.c.workspace_id == workspace_id,
                secrets.c.kind == kind,
            )
        )
    ).one_or_none()
    if row is None:
        raise SecretUnreadableError
    sealed = SealedSecret(row.ciphertext, row.dek_wrapped, row.kek_version, fingerprint="")
    return cipher.open(sealed, secret_id=secret_id, workspace_id=workspace_id, kind=kind)


async def delete_secret(db: AsyncSession, *, workspace_id: UUID, secret_id: UUID) -> None:
    await db.execute(
        delete(secrets).where(secrets.c.id == secret_id, secrets.c.workspace_id == workspace_id)
    )
