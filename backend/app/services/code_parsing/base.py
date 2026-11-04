"""Shared types for code parsing (regex / tree-sitter backends)."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


@dataclass
class Symbol:
    """A single top-level-ish code symbol (function / class / interface / ...)."""

    name: str
    kind: str
    language: str
    start_line: int
    end_line: int | None = None


@dataclass
class Call:
    """A call-site reference to a symbol (name + source line)."""

    name: str
    line: int


@dataclass
class ParseResult:
    """Everything a single file contributes to the code graph."""

    symbols: list[Symbol] = field(default_factory=list)
    imports: list[str] = field(default_factory=list)
    calls: list[Call] = field(default_factory=list)


class CodeParser(Protocol):
    """Contract both backends implement. `RegexParser` and `TreeSitterParser`
    return the same `ParseResult` shape so the graph builder is backend-agnostic."""

    def parse(self, path: Path, text: str) -> ParseResult: ...


def language_for(path: Path) -> str:
    """Suffix-based language label (e.g. ``py``, ``ts``, ``go``)."""
    suffix = path.suffix.lower().lstrip(".")
    return suffix or path.name
