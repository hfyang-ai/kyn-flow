"""Regex-backed code parser (the fallback backend).

This is a faithful port of the regex logic that previously lived inline in
``app/services/code_analysis.py``. Behaviour is intentionally unchanged so the
regex path stays a zero-risk fallback while tree-sitter is rolled out.
"""

import re
from pathlib import Path

from app.services.code_parsing.base import (
    Call,
    ParseResult,
    Symbol,
    language_for,
)

PY_SYMBOL_RE = re.compile(r"^\s*(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)
TS_SYMBOL_RE = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)",
    re.MULTILINE,
)
CALL_RE = re.compile(r"\b([A-Za-z_][$A-Za-z0-9_]*)\s*\(")
IMPORT_RE = re.compile(
    r"^\s*(?:from\s+([\w.\/-]+)\s+import|import\s+([\w.\/-]+)|import\s+.*?\s+from\s+['\"]([^'\"]+)['\"])",
    re.MULTILINE,
)

GO_SYMBOL_RE = re.compile(
    r"^\s*(func|type)\s+(?:\([^)]*\)\s+)?([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)

RUST_SYMBOL_RE = re.compile(
    r"^\s*(?:pub(?:\s*\(\s*crate\s*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(fn|struct|enum|trait)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)

SWIFT_SYMBOL_RE = re.compile(
    r"^\s*(?:(?:public|private|internal|fileprivate|open)\s+)?(?:override\s+|mutating\s+|static\s+|class\s+)?(func|class|struct|enum|protocol|extension)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)

JAVA_SYMBOL_RE = re.compile(
    r"^\s*(?:(?:public|private|protected)\s+)?(?:abstract\s+|final\s+|static\s+)*(class|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)

KOTLIN_SYMBOL_RE = re.compile(
    r"^\s*(?:(?:public|private|internal|protected)\s+)?(?:open\s+|abstract\s+|data\s+|sealed\s+)?(?:suspend\s+)?(?:override\s+)?(fun|class|interface|object|enum class)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)

# Windows batch: the only "symbols" are jump labels (``:label``) referenced by
# ``goto``/``call :label``. No tree-sitter grammar exists, so regex covers it.
BATCH_SYMBOL_RE = re.compile(r"^\s*:([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)


def _line_for_offset(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _symbol_matches(path: Path, text: str) -> list[Symbol]:
    language = language_for(path)
    matches: list[Symbol] = []
    if path.suffix.lower() == ".py":
        for match in PY_SYMBOL_RE.finditer(text):
            matches.append(
                Symbol(
                    name=match.group(2),
                    kind=match.group(1),
                    language=language,
                    start_line=_line_for_offset(text, match.start()),
                )
            )
    elif path.suffix.lower() in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}:
        for match in TS_SYMBOL_RE.finditer(text):
            declaration = match.group(0)
            kind = (
                "class"
                if "class " in declaration
                else "interface"
                if "interface " in declaration
                else "type"
                if "type " in declaration
                else "function"
            )
            matches.append(
                Symbol(
                    name=match.group(1),
                    kind=kind,
                    language=language,
                    start_line=_line_for_offset(text, match.start()),
                )
            )
    elif path.suffix.lower() == ".go":
        for match in GO_SYMBOL_RE.finditer(text):
            matches.append(
                Symbol(
                    name=match.group(2),
                    kind=match.group(1),
                    language=language,
                    start_line=_line_for_offset(text, match.start()),
                )
            )
    elif path.suffix.lower() == ".rs":
        for match in RUST_SYMBOL_RE.finditer(text):
            matches.append(
                Symbol(
                    name=match.group(2),
                    kind=match.group(1),
                    language=language,
                    start_line=_line_for_offset(text, match.start()),
                )
            )
    elif path.suffix.lower() == ".swift":
        for match in SWIFT_SYMBOL_RE.finditer(text):
            matches.append(
                Symbol(
                    name=match.group(2),
                    kind=match.group(1),
                    language=language,
                    start_line=_line_for_offset(text, match.start()),
                )
            )
    elif path.suffix.lower() == ".java":
        for match in JAVA_SYMBOL_RE.finditer(text):
            matches.append(
                Symbol(
                    name=match.group(2),
                    kind=match.group(1),
                    language=language,
                    start_line=_line_for_offset(text, match.start()),
                )
            )
    elif path.suffix.lower() in {".kt", ".kts"}:
        for match in KOTLIN_SYMBOL_RE.finditer(text):
            kind = match.group(1).replace(" ", "_")
            matches.append(
                Symbol(
                    name=match.group(2),
                    kind=kind,
                    language=language,
                    start_line=_line_for_offset(text, match.start()),
                )
            )
    elif path.suffix.lower() in {".bat", ".cmd"}:
        for match in BATCH_SYMBOL_RE.finditer(text):
            matches.append(
                Symbol(
                    name=match.group(1),
                    kind="label",
                    language=language,
                    start_line=_line_for_offset(text, match.start()),
                )
            )
    return matches


class RegexParser:
    """Regex backend implementing :class:`CodeParser`."""

    def parse(self, path: Path, text: str) -> ParseResult:
        imports = [
            next((part for part in match.groups() if part), "")
            for match in IMPORT_RE.finditer(text)
        ]
        calls = [
            Call(name=match.group(1), line=_line_for_offset(text, match.start()))
            for match in CALL_RE.finditer(text)
        ]
        return ParseResult(
            symbols=_symbol_matches(path, text),
            imports=[item for item in imports if item],
            calls=calls,
        )
