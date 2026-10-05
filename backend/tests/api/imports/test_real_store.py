"""The application opens the bucket that import sources are kept in from its settings."""

from __future__ import annotations

import json

from pydantic import SecretStr

from sightline.api.resources import Resources
from sightline.storage.raw import RawStore, decompress
from tests.api.auth.support import make_workspace
from tests.api.conftest import AppFactory
from tests.api.entities.support import member
from tests.api.imports.support import create_paste
from tests.api.keywords.support import keyword_project
from tests.conftest import ObjectServer, PostgresServer
from tests.storage.support import fresh_store, object_keys


async def test_a_source_is_kept_in_the_configured_bucket(
    client_for: AppFactory,
    resources: Resources,
    migrated: PostgresServer,
    object_server: ObjectServer,
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)

    async with fresh_store(object_server) as store:
        async with client_for(
            r2_raw_endpoint=object_server.endpoint,
            r2_raw_bucket=store.bucket,
            r2_raw_access_key_id=SecretStr(object_server.access_key_id),
            r2_raw_secret_access_key=SecretStr(object_server.secret_access_key),
        ) as api:
            response = await create_paste(api, workspace, project, owner, "crm\nerp\n")

        assert response.status_code == 202, response.text
        import_id = response.json()["data"]["import_id"]
        key = f"imports/v1/{workspace.id}/{import_id}/source"
        assert await object_keys(object_server, store.bucket) == [key]
        assert isinstance(store, RawStore)
        assert json.loads(decompress(await store.get(key))) == {
            "kind": "paste",
            "text": "crm\nerp\n",
        }
