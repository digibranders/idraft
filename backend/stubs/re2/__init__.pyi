# The part of google-re2 the alias matcher uses; the package ships no type information.
from collections.abc import Iterator

class error(Exception): ...  # noqa: N801, N818 (the library's own name)

class Options:
    case_sensitive: bool
    log_errors: bool
    never_capture: bool
    def __init__(self) -> None: ...

class _Match:
    def start(self, group: int = 0) -> int: ...
    def end(self, group: int = 0) -> int: ...

class _Regexp:
    @property
    def programsize(self) -> int: ...
    def finditer(self, text: str, pos: int = ..., endpos: int = ...) -> Iterator[_Match]: ...

def compile(pattern: str, options: Options | None = None) -> _Regexp: ...
