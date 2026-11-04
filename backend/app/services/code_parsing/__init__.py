"""Code-parsing backends with a shared contract and a regex fallback."""

from pathlib import Path

from app.services.code_parsing.base import (
    Call,
    CodeParser,
    ParseResult,
    Symbol,
    language_for,
)
from app.services.code_parsing.regex import RegexParser
from app.services.code_parsing.tree_sitter import (
    TreeSitterParser,
    UnsupportedLanguage,
)

__all__ = [
    "Call",
    "CodeParser",
    "ParseResult",
    "RegexParser",
    "Symbol",
    "TreeSitterParser",
    "UnsupportedLanguage",
    "build_parser",
    "language_for",
]


class _FallbackParser:
    """Primary backend first, regex fallback for unsupported languages."""

    def __init__(self, primary: CodeParser, fallback: CodeParser) -> None:
        self._primary = primary
        self._fallback = fallback

    def parse(self, path: Path, text: str) -> ParseResult:
        try:
            return self._primary.parse(path, text)
        except UnsupportedLanguage:
            return self._fallback.parse(path, text)


def build_parser(mode: str) -> CodeParser:
    """Build the configured parser.

    ``mode == "tree_sitter"`` returns tree-sitter with a per-file regex
    fallback for languages without a grammar; anything else returns the regex
    parser (the safe default during rollout).
    """
    if mode == "tree_sitter":
        return _FallbackParser(TreeSitterParser(), RegexParser())
    return RegexParser()
