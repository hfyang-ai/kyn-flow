"""Tree-sitter-backed code parser (all grammars; regex is the fallback).

Uses per-language PyPI grammars (``tree-sitter-python`` / ``tree-sitter-javascript``
/ ``tree-sitter-typescript`` / ``tree-sitter-c`` / ``tree-sitter-cpp`` / ...) which
bundle the compiled grammar inside the wheel — no runtime download, unlike the lazy
``tree-sitter-language-pack``. Query strings are hand-written and declarative:
what counts as a symbol, where its name lives, and its kind are all stated
explicitly per language.

tree-sitter 0.26 API notes (verified empirically):
* grammars expose ``language()`` returning a PyCapsule; wrap with ``Language(ptr)``.
* ``Query(lang, source)`` + ``QueryCursor(query)``; ``.captures(root)`` returns a
  ``dict[capture_name, list[Node]]``, and ``.matches(root)`` returns
  ``(pattern_index, dict[capture_name, list[Node]])`` pairs — used to pair a symbol
  node with its ``@name`` capture without relying on ``child_by_field_name`` (which
  some grammars, e.g. C function declarators and PowerShell, do not expose as a
  field).
* Call nodes: Python ``call``, Ruby ``call``, PHP ``function_call_expression``,
  C/C++/Scala ``call_expression``, C# ``invocation_expression``, Bash ``command``,
  PowerShell ``command``.
"""

from dataclasses import dataclass
from pathlib import Path

import tree_sitter_bash
import tree_sitter_c
import tree_sitter_c_sharp
import tree_sitter_cpp
import tree_sitter_javascript
import tree_sitter_php
import tree_sitter_powershell
import tree_sitter_python
import tree_sitter_ruby
import tree_sitter_scala
import tree_sitter_sql
import tree_sitter_typescript
from tree_sitter import Language, Parser, Query, QueryCursor

from app.services.code_parsing.base import (
    Call,
    ParseResult,
    Symbol,
    language_for,
)


class UnsupportedLanguage(ValueError):
    """Raised when no grammar is registered for a file's language."""


def _lang(module: object, attr: str = "language") -> Language:
    fn = getattr(module, attr)
    return Language(fn() if callable(fn) else fn)


_PY_LANG = _lang(tree_sitter_python)
_JS_LANG = _lang(tree_sitter_javascript)
_TS_LANG = _lang(tree_sitter_typescript, "language_typescript")
_TSX_LANG = _lang(tree_sitter_typescript, "language_tsx")
_C_LANG = _lang(tree_sitter_c)
_CPP_LANG = _lang(tree_sitter_cpp)
_CS_LANG = _lang(tree_sitter_c_sharp)
_PHP_LANG = _lang(tree_sitter_php, "language_php")
_RB_LANG = _lang(tree_sitter_ruby)
_SCALA_LANG = _lang(tree_sitter_scala)
_SQL_LANG = _lang(tree_sitter_sql)
_BASH_LANG = _lang(tree_sitter_bash)
_PS_LANG = _lang(tree_sitter_powershell)


# --- symbol queries ---------------------------------------------------------

_PY_SYMBOLS = (
    "(function_definition name: (_) @name) @symbol\n"
    "(class_definition name: (_) @name) @symbol"
)
_TS_SYMBOLS = (
    "(function_declaration name: (_) @name) @symbol\n"
    "(class_declaration name: (_) @name) @symbol\n"
    "(interface_declaration name: (_) @name) @symbol\n"
    "(type_alias_declaration name: (_) @name) @symbol\n"
    "(enum_declaration name: (_) @name) @symbol"
)
_JS_SYMBOLS = (
    "(function_declaration name: (_) @name) @symbol\n"
    "(class_declaration name: (_) @name) @symbol"
)
# C/C++ function names live inside the function_declarator's declarator (no name
# field on function_definition), so they are captured via an explicit path.
_C_SYMBOLS = (
    "(function_definition declarator: "
    "(function_declarator declarator: (identifier) @name)) @symbol\n"
    "(struct_specifier name: (_) @name) @symbol\n"
    "(union_specifier name: (_) @name) @symbol\n"
    "(enum_specifier name: (_) @name) @symbol\n"
    "(type_definition declarator: (type_identifier) @name) @symbol"
)
_CPP_SYMBOLS = (
    "(function_definition declarator: "
    "(function_declarator declarator: (identifier) @name)) @symbol\n"
    "(function_definition declarator: "
    "(function_declarator declarator: (qualified_identifier name: (identifier) @name))) @symbol\n"
    "(class_specifier name: (_) @name) @symbol\n"
    "(struct_specifier name: (_) @name) @symbol\n"
    "(union_specifier name: (_) @name) @symbol\n"
    "(enum_specifier name: (_) @name) @symbol\n"
    "(namespace_definition name: (_) @name) @symbol"
)
_CS_SYMBOLS = (
    "(class_declaration name: (_) @name) @symbol\n"
    "(interface_declaration name: (_) @name) @symbol\n"
    "(struct_declaration name: (_) @name) @symbol\n"
    "(enum_declaration name: (_) @name) @symbol\n"
    "(record_declaration name: (_) @name) @symbol\n"
    "(method_declaration name: (_) @name) @symbol\n"
    "(property_declaration name: (_) @name) @symbol\n"
    "(namespace_declaration name: (_) @name) @symbol"
)
_PHP_SYMBOLS = (
    "(class_declaration name: (_) @name) @symbol\n"
    "(interface_declaration name: (_) @name) @symbol\n"
    "(trait_declaration name: (_) @name) @symbol\n"
    "(function_definition name: (_) @name) @symbol\n"
    "(method_declaration name: (_) @name) @symbol"
)
_RB_SYMBOLS = (
    "(class name: (_) @name) @symbol\n"
    "(module name: (_) @name) @symbol\n"
    "(method name: (_) @name) @symbol"
)
_SCALA_SYMBOLS = (
    "(object_definition name: (_) @name) @symbol\n"
    "(class_definition name: (_) @name) @symbol\n"
    "(trait_definition name: (_) @name) @symbol\n"
    "(function_definition name: (_) @name) @symbol"
)
_SQL_SYMBOLS = (
    "(create_table (object_reference name: (_) @name)) @symbol\n"
    "(create_view (object_reference name: (_) @name)) @symbol\n"
    "(create_function (object_reference name: (_) @name)) @symbol"
)
_BASH_SYMBOLS = "(function_definition name: (_) @name) @symbol"
_PS_SYMBOLS = (
    "(function_statement (function_name) @name) @symbol\n"
    "(class_statement (simple_name) @name) @symbol"
)


# --- import queries ---------------------------------------------------------

_PY_IMPORTS = (
    "(import_from_statement module_name: (_) @module)\n"
    "(import_statement (dotted_name) @module)\n"
    "(import_statement (aliased_import (dotted_name) @module))"
)
_JS_IMPORTS = "(import_statement source: (string) @module)"
# C/C++ include paths: ``<stdio.h>`` (system_lib_string) vs ``"local.h"``
# (string_literal -> string_content). The former is de-bracketed in _imports.
_C_IMPORTS = (
    "(preproc_include path: (system_lib_string) @module)\n"
    "(preproc_include path: (string_literal (string_content) @module))"
)
_CS_IMPORTS = (
    "(using_directive (qualified_name) @module)\n"
    "(using_directive (identifier) @module)"
)
_PHP_IMPORTS = "(namespace_use_declaration (namespace_use_clause (qualified_name) @module))"
_SCALA_IMPORTS = "(import_declaration) @module"


# --- call queries -----------------------------------------------------------

_PY_CALLS = "(call function: (identifier) @fn)"
_JS_CALLS = "(call_expression function: (identifier) @fn)"
_CS_CALLS = "(invocation_expression function: (identifier) @fn)"
_PHP_CALLS = (
    "(function_call_expression function: (name) @fn)\n"
    "(function_call_expression function: (qualified_name) @fn)"
)
_RB_CALLS = "(call method: (identifier) @fn)"
_SCALA_CALLS = "(call_expression function: (identifier) @fn)"
_BASH_CALLS = "(command name: (command_name) @fn)"
_PS_CALLS = "(command command_name: (command_name) @fn)"


# --- kind maps --------------------------------------------------------------

_PY_KINDS = {"function_definition": "def", "class_definition": "class"}
_TS_KINDS = {
    "function_declaration": "function",
    "class_declaration": "class",
    "interface_declaration": "interface",
    "type_alias_declaration": "type",
    "enum_declaration": "enum",
}
_C_KINDS = {
    "function_definition": "function",
    "struct_specifier": "struct",
    "union_specifier": "union",
    "enum_specifier": "enum",
    "type_definition": "typedef",
}
_CPP_KINDS = {
    "function_definition": "function",
    "class_specifier": "class",
    "struct_specifier": "struct",
    "union_specifier": "union",
    "enum_specifier": "enum",
    "namespace_definition": "namespace",
}
_CS_KINDS = {
    "class_declaration": "class",
    "interface_declaration": "interface",
    "struct_declaration": "struct",
    "enum_declaration": "enum",
    "record_declaration": "record",
    "method_declaration": "method",
    "property_declaration": "property",
    "namespace_declaration": "namespace",
}
_PHP_KINDS = {
    "class_declaration": "class",
    "interface_declaration": "interface",
    "trait_declaration": "trait",
    "function_definition": "function",
    "method_declaration": "method",
}
_RB_KINDS = {"class": "class", "module": "module", "method": "method"}
_SCALA_KINDS = {
    "object_definition": "object",
    "class_definition": "class",
    "trait_definition": "trait",
    "function_definition": "function",
}
_SQL_KINDS = {"create_table": "table", "create_view": "view", "create_function": "function"}
_BASH_KINDS = {"function_definition": "function"}
_PS_KINDS = {"function_statement": "function", "class_statement": "class"}


@dataclass(frozen=True)
class _Grammar:
    label: str
    language: Language
    symbols_query: str
    imports_query: str
    calls_query: str
    kind_map: dict[str, str]
    import_strip_prefix: str = ""


_GRAMMARS: dict[str, _Grammar] = {
    "py": _Grammar("py", _PY_LANG, _PY_SYMBOLS, _PY_IMPORTS, _PY_CALLS, _PY_KINDS),
    "ts": _Grammar("ts", _TS_LANG, _TS_SYMBOLS, _JS_IMPORTS, _JS_CALLS, _TS_KINDS),
    "tsx": _Grammar("tsx", _TSX_LANG, _TS_SYMBOLS, _JS_IMPORTS, _JS_CALLS, _TS_KINDS),
    "js": _Grammar("js", _JS_LANG, _JS_SYMBOLS, _JS_IMPORTS, _JS_CALLS, _TS_KINDS),
    "jsx": _Grammar("jsx", _JS_LANG, _JS_SYMBOLS, _JS_IMPORTS, _JS_CALLS, _TS_KINDS),
    "mjs": _Grammar("mjs", _JS_LANG, _JS_SYMBOLS, _JS_IMPORTS, _JS_CALLS, _TS_KINDS),
    "cjs": _Grammar("cjs", _JS_LANG, _JS_SYMBOLS, _JS_IMPORTS, _JS_CALLS, _TS_KINDS),
    "c": _Grammar("c", _C_LANG, _C_SYMBOLS, _C_IMPORTS, _JS_CALLS, _C_KINDS),
    # .h / .hpp / .cpp share the C++ grammar (a superset of C).
    "cpp": _Grammar("cpp", _CPP_LANG, _CPP_SYMBOLS, _C_IMPORTS, _JS_CALLS, _CPP_KINDS),
    "h": _Grammar("cpp", _CPP_LANG, _CPP_SYMBOLS, _C_IMPORTS, _JS_CALLS, _CPP_KINDS),
    "hpp": _Grammar("cpp", _CPP_LANG, _CPP_SYMBOLS, _C_IMPORTS, _JS_CALLS, _CPP_KINDS),
    "cs": _Grammar("cs", _CS_LANG, _CS_SYMBOLS, _CS_IMPORTS, _CS_CALLS, _CS_KINDS),
    "php": _Grammar("php", _PHP_LANG, _PHP_SYMBOLS, _PHP_IMPORTS, _PHP_CALLS, _PHP_KINDS),
    "rb": _Grammar("rb", _RB_LANG, _RB_SYMBOLS, "", _RB_CALLS, _RB_KINDS),
    "scala": _Grammar(
        "scala", _SCALA_LANG, _SCALA_SYMBOLS, _SCALA_IMPORTS, _SCALA_CALLS, _SCALA_KINDS,
        import_strip_prefix="import ",
    ),
    "sql": _Grammar("sql", _SQL_LANG, _SQL_SYMBOLS, "", "", _SQL_KINDS),
    "sh": _Grammar("sh", _BASH_LANG, _BASH_SYMBOLS, "", _BASH_CALLS, _BASH_KINDS),
    "ps1": _Grammar("ps1", _PS_LANG, _PS_SYMBOLS, "", _PS_CALLS, _PS_KINDS),
}


def _strip_quotes(text: str) -> str:
    if len(text) >= 2 and text[0] in ("'", '"', "`") and text[-1] == text[0]:
        return text[1:-1]
    if len(text) >= 2 and text[0] == "<" and text[-1] == ">":
        return text[1:-1]
    return text


def _compile(grammar: _Grammar, query: str) -> Query:
    return Query(grammar.language, query)


class TreeSitterParser:
    """Tree-sitter backend implementing :class:`CodeParser`."""

    def supports(self, path: Path) -> bool:
        return language_for(path) in _GRAMMARS

    def parse(self, path: Path, text: str) -> ParseResult:
        suffix = language_for(path)
        grammar = _GRAMMARS.get(suffix)
        if grammar is None:
            raise UnsupportedLanguage(f"no tree-sitter grammar for {path.suffix or path.name!r}")

        root = Parser(grammar.language).parse(text.encode()).root_node

        symbols = self._symbols(grammar, root)
        imports = self._imports(grammar, root)
        calls = self._calls(grammar, root)
        return ParseResult(symbols=symbols, imports=imports, calls=calls)

    @staticmethod
    def _symbols(grammar: _Grammar, root) -> list[Symbol]:
        query = _compile(grammar, grammar.symbols_query)
        result: list[Symbol] = []
        for _, captures in QueryCursor(query).matches(root):
            symbol_nodes = captures.get("symbol", [])
            name_nodes = captures.get("name", [])
            if not symbol_nodes or not name_nodes:
                continue
            symbol_node = symbol_nodes[0]
            name_node = name_nodes[0]
            result.append(
                Symbol(
                    name=name_node.text.decode(),
                    kind=grammar.kind_map.get(symbol_node.type, symbol_node.type),
                    language=grammar.label,
                    start_line=symbol_node.start_point[0] + 1,
                    end_line=symbol_node.end_point[0] + 1,
                )
            )
        return result

    @staticmethod
    def _imports(grammar: _Grammar, root) -> list[str]:
        if not grammar.imports_query:
            return []
        captures = QueryCursor(_compile(grammar, grammar.imports_query)).captures(root)
        seen: set[str] = set()
        result: list[str] = []
        for node in captures.get("module", []):
            module = _strip_quotes(node.text.decode())
            if grammar.import_strip_prefix and module.startswith(grammar.import_strip_prefix):
                module = module[len(grammar.import_strip_prefix):].strip()
            if module and module not in seen:
                seen.add(module)
                result.append(module)
        return result

    @staticmethod
    def _calls(grammar: _Grammar, root) -> list[Call]:
        if not grammar.calls_query:
            return []
        captures = QueryCursor(_compile(grammar, grammar.calls_query)).captures(root)
        return [
            Call(name=node.text.decode(), line=node.start_point[0] + 1)
            for node in captures.get("fn", [])
        ]
