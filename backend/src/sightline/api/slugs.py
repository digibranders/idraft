"""Slugs are URL segments in the web app, so their shape is fixed and some words are taken.

The reserved words are the static segments of the web app's routes: a workspace slug is the first
segment of a path, a project slug the second. Both lists are in the OpenAPI document, so the web
forms refuse the same words before asking the API.
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Annotated

from pydantic import AfterValidator, StringConstraints
from pydantic_core import PydanticCustomError

SLUG_MIN = 3
SLUG_MAX = 40
# Lower-case letters, digits and hyphens, starting and ending with a letter or digit.
SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$"


class ReservedWorkspaceSlug(StrEnum):
    """The first segment of a path. A word cannot be reserved once a workspace holds it, so the
    list also has the segments a web app commonly grows."""

    ACCOUNT = "account"
    ADMIN = "admin"
    API = "api"
    ASSETS = "assets"
    DESIGN_SYSTEM = "design-system"
    DOCS = "docs"
    FAVICON = "favicon"
    FORGOT_PASSWORD = "forgot-password"
    HEALTH = "health"
    HEALTHZ = "healthz"
    HELP = "help"
    ICON = "icon"
    INVITE = "invite"
    LOGIN = "login"
    LOGOUT = "logout"
    NEW = "new"
    NULL = "null"
    ONBOARDING = "onboarding"
    PUBLIC = "public"
    RESET_PASSWORD = "reset-password"
    ROBOTS = "robots"
    SETTINGS = "settings"
    SIGN_IN = "sign-in"
    SIGN_UP = "sign-up"
    SIGNUP = "signup"
    SITEMAP = "sitemap"
    STATIC = "static"
    TWO_FACTOR = "two-factor"
    UNDEFINED = "undefined"
    VERIFY_EMAIL = "verify-email"
    WWW = "www"


class ReservedProjectSlug(StrEnum):
    BILLING = "billing"
    COSTS = "costs"
    MEMBERS = "members"
    NEW = "new"
    ONBOARDING = "onboarding"
    OPS = "ops"
    PROJECTS = "projects"
    SETTINGS = "settings"


def _not_a_workspace_route(value: str) -> str:
    if value in ReservedWorkspaceSlug:
        raise PydanticCustomError("slug_reserved", "This word is reserved.")
    return value


def _not_a_project_route(value: str) -> str:
    if value in ReservedProjectSlug:
        raise PydanticCustomError("slug_reserved", "This word is reserved.")
    return value


_UUID_SHAPE = re.compile(r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}")


def _not_an_id(value: str) -> str:
    # A path segment is either a slug or an id. One that could be both cannot be told apart.
    if _UUID_SHAPE.fullmatch(value):
        raise PydanticCustomError("slug_is_id", "A slug cannot have the shape of an id.")
    return value


_Slug = Annotated[str, StringConstraints(pattern=SLUG_PATTERN), AfterValidator(_not_an_id)]
WorkspaceSlug = Annotated[_Slug, AfterValidator(_not_a_workspace_route)]
ProjectSlug = Annotated[_Slug, AfterValidator(_not_a_project_route)]
