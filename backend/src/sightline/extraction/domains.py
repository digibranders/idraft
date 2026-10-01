"""Domain role resolution, stage 2 (docs/13-ai-extraction-engine.md section 4).

A project's entity domains are rules; a cited or ranking URL takes the role of the most specific
rule it matches: a path prefix on its host, then its exact host, then its registrable domain.
Two entities claiming the same thing at the same specificity is a misconfiguration: the own
entity wins (then a competitor, then a watched entity, then the lower id) and the tie is
reported so the API can warn about it.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final, Literal

from sightline.extraction.urls import CanonicalUrl, Host, normalize_path_prefix

ProjectRole = Literal["own", "competitor", "watch"]
DomainRole = Literal["own", "competitor", "third_party"]
MatchScope = Literal["path_prefix", "host", "registrable"]

_SPECIFICITY: Final[tuple[MatchScope, ...]] = ("path_prefix", "host", "registrable")
_PRECEDENCE: Final[dict[ProjectRole, int]] = {"own": 0, "competitor": 1, "watch": 2}
# A watched entity is named on the result but its domains are not the project's or a rival's.
_DOMAIN_ROLE: Final[dict[ProjectRole, DomainRole]] = {
    "own": "own",
    "competitor": "competitor",
    "watch": "third_party",
}


@dataclass(frozen=True, slots=True)
class DomainRule:
    """One entity domain of an entity attached to the project."""

    entity_id: uuid.UUID
    role: ProjectRole
    match_scope: MatchScope
    host: Host
    path_prefix: str | None = None  # normalized by `normalize_path_prefix`

    def __post_init__(self) -> None:
        if (self.match_scope == "path_prefix") != (self.path_prefix is not None):
            raise ValueError("a path_prefix is given exactly when the match scope is path_prefix")
        # A prefix in another form (`/acme/`) would silently match nothing.
        if self.path_prefix is not None and self.path_prefix != normalize_path_prefix(
            self.path_prefix
        ):
            raise ValueError(f"a path_prefix is normalized first: {self.path_prefix!r}")

    @property
    def key(self) -> str:
        """What the rule claims: a registrable domain, a host, or a host and path prefix."""
        if self.match_scope == "registrable":
            return self.host.registrable_domain
        if self.match_scope == "host":
            return self.host.name
        return f"{self.host.name}{self.path_prefix}"


@dataclass(frozen=True, slots=True)
class DomainResolution:
    domain_role: DomainRole
    entity_id: uuid.UUID | None
    match_scope: MatchScope | None
    conflicting_entity_ids: tuple[uuid.UUID, ...] = ()  # other claimants of the winning rule


@dataclass(frozen=True, slots=True)
class DomainConflict:
    match_scope: MatchScope
    key: str
    winner: uuid.UUID
    losers: tuple[uuid.UUID, ...]


THIRD_PARTY: Final = DomainResolution(domain_role="third_party", entity_id=None, match_scope=None)


class DomainResolver:
    """The domain rules of one project, indexed for resolution."""

    def __init__(self, rules: Iterable[DomainRule]) -> None:
        claims: defaultdict[tuple[MatchScope, str], list[DomainRule]] = defaultdict(list)
        for rule in rules:
            claims[(rule.match_scope, rule.key)].append(rule)

        self._exact: dict[tuple[MatchScope, str], DomainResolution] = {}
        self._prefixes: defaultdict[str, list[tuple[str, DomainResolution]]] = defaultdict(list)
        conflicts: list[DomainConflict] = []
        for (scope, key), claimants in claims.items():
            ranked = sorted(claimants, key=lambda rule: (_PRECEDENCE[rule.role], rule.entity_id))
            winner = ranked[0]
            losers = tuple(
                dict.fromkeys(
                    rule.entity_id for rule in ranked if rule.entity_id != winner.entity_id
                )
            )
            resolution = DomainResolution(
                domain_role=_DOMAIN_ROLE[winner.role],
                entity_id=winner.entity_id,
                match_scope=scope,
                conflicting_entity_ids=losers,
            )
            if losers:
                conflicts.append(DomainConflict(scope, key, winner.entity_id, losers))
            if winner.path_prefix is not None:  # set exactly when the scope is path_prefix
                self._prefixes[winner.host.name].append((winner.path_prefix, resolution))
            else:
                self._exact[(scope, key)] = resolution

        for prefixes in self._prefixes.values():
            prefixes.sort(key=lambda entry: len(entry[0]), reverse=True)
        self._conflicts = tuple(
            sorted(conflicts, key=lambda found: (_SPECIFICITY.index(found.match_scope), found.key))
        )

    def resolve(self, host: Host, path: str) -> DomainResolution:
        """The role of a page given its normalized host and canonical path."""
        for prefix, resolution in self._prefixes.get(host.name, ()):
            if prefix == "/" or path == prefix or path.startswith(f"{prefix}/"):
                return resolution
        return (
            self._exact.get(("host", host.name))
            or self._exact.get(("registrable", host.registrable_domain))
            or THIRD_PARTY
        )

    def resolve_url(self, url: CanonicalUrl) -> DomainResolution:
        return self.resolve(url.host, url.path)

    def conflicts(self) -> tuple[DomainConflict, ...]:
        """Every claim made by more than one entity, most specific first."""
        return self._conflicts
