"""Unit tests for the code-parsing backends (regex fallback + tree-sitter)."""

from pathlib import Path

import pytest

from app.services.code_parsing import (
    RegexParser,
    TreeSitterParser,
    UnsupportedLanguage,
    build_parser,
)

PY_CODE = (
    "from lib import helper\n"
    "import os\n"
    "\n"
    "def handler():\n"
    "    return helper()\n"
    "\n"
    "class Worker:\n"
    "    def go(self):\n"
    "        return self.value\n"
)

TS_CODE = (
    "import React from 'react';\n"
    "import { a, b } from './mod';\n"
    "\n"
    "export async function run(): Promise<void> {\n"
    "  return helper();\n"
    "}\n"
    "\n"
    "enum Color { Red, Green }\n"
    "interface Shape { area: number }\n"
    "class Worker {\n"
    "  work() { console.log('x'); }\n"
    "}\n"
)


def _names(symbols) -> list[str]:
    return [s.name for s in symbols]


def test_regex_parser_extracts_python_symbols() -> None:
    result = RegexParser().parse(Path("service.py"), PY_CODE)
    assert _names(result.symbols) == ["handler", "Worker", "go"]
    assert [(s.name, s.kind) for s in result.symbols] == [
        ("handler", "def"),
        ("Worker", "class"),
        ("go", "def"),
    ]
    assert result.imports == ["lib", "os"]
    assert "helper" in [c.name for c in result.calls]


def test_tree_sitter_parser_populates_end_line() -> None:
    result = TreeSitterParser().parse(Path("service.py"), PY_CODE)
    by_name = {s.name: s for s in result.symbols}
    assert set(by_name) == {"handler", "Worker", "go"}
    assert by_name["handler"].kind == "def"
    assert by_name["Worker"].kind == "class"
    # tree-sitter carries the body range, which regex cannot express.
    assert by_name["handler"].start_line == 4
    assert by_name["handler"].end_line == 5
    assert by_name["Worker"].end_line is not None


def test_tree_sitter_imports_use_module_not_binding() -> None:
    result = TreeSitterParser().parse(Path("app.ts"), TS_CODE)
    # `import React from 'react'` must resolve to the module 'react', not 'React'.
    assert result.imports == ["react", "./mod"]


def test_tree_sitter_calls_exclude_member_and_declaration_noise() -> None:
    result = TreeSitterParser().parse(Path("app.ts"), TS_CODE)
    # Only the bare `helper()` call remains: no `console.log` member call,
    # no `def run():`-style declaration false-positive.
    assert [c.name for c in result.calls] == ["helper"]


def test_tree_sitter_detects_ts_enum_and_interface() -> None:
    result = TreeSitterParser().parse(Path("app.ts"), TS_CODE)
    kinds = {s.name: s.kind for s in result.symbols}
    assert kinds["Color"] == "enum"
    assert kinds["Shape"] == "interface"
    assert kinds["Worker"] == "class"


def test_tree_sitter_raises_for_unregistered_language() -> None:
    parser = TreeSitterParser()
    try:
        parser.parse(Path("main.go"), "package main\nfunc main() {}\n")
    except UnsupportedLanguage:
        pass
    else:
        raise AssertionError("expected UnsupportedLanguage for unsupported .go")


def test_fallback_parser_uses_regex_for_unsupported_language() -> None:
    parser = build_parser("tree_sitter")
    result = parser.parse(Path("main.go"), "package main\nfunc main() {}\n")
    # .go has no tree-sitter grammar yet, so it must fall back to regex.
    assert [s.name for s in result.symbols] == ["main"]


def test_build_parser_defaults_to_regex() -> None:
    assert isinstance(build_parser("regex"), RegexParser)
    # tree_sitter mode wraps a fallback, but is not the bare regex parser.
    assert not isinstance(build_parser("tree_sitter"), RegexParser)


# --- non-Python/TS languages (added in step 5) ------------------------------

# filename, code, expected [(name, kind, language)], imports, calls
_NEW_LANG_CASES = [
    (
        "main.c",
        ("#include <stdio.h>\n#include \"local.h\"\n"
        "int add(int a, int b) { return helper(); }\n"
        "struct Point { int x; };\n"
        "typedef int myint;\n"
        "enum Color { RED };\n"),
        [
            ("add", "function", "c"),
            ("Point", "struct", "c"),
            ("myint", "typedef", "c"),
            ("Color", "enum", "c"),
        ],
        ["stdio.h", "local.h"],
        ["helper"],
    ),
    (
        "widget.hpp",
        ("#include <vector>\n"
        "class Widget {\npublic:\n  int run();\n};\n"
        "int Widget::run() { return helper(); }\n"
        "namespace app { void boot(); }\n"),
        [
            ("Widget", "class", "cpp"),
            ("run", "function", "cpp"),
            ("app", "namespace", "cpp"),
        ],
        ["vector"],
        ["helper"],
    ),
    (
        "Service.cs",
        ("using System;\nusing System.Collections.Generic;\n"
        "namespace App {\n"
        "  public class Service {\n"
        "    public void Run() { Helper(); }\n"
        "  }\n"
        "  public interface IThing {}\n"
        "  public enum Color { Red }\n"
        "}\n"),
        [
            ("App", "namespace", "cs"),
            ("Service", "class", "cs"),
            ("Run", "method", "cs"),
            ("IThing", "interface", "cs"),
            ("Color", "enum", "cs"),
        ],
        ["System", "System.Collections.Generic"],
        ["Helper"],
    ),
    (
        "Service.php",
        ("<?php\nnamespace App;\nuse Foo\\Bar;\n"
        "class Service {\n"
        "  public function run() { return helper(); }\n"
        "}\n"
        "function top_level() {}\n"
        "trait T {}\n"),
        [
            ("Service", "class", "php"),
            ("run", "method", "php"),
            ("top_level", "function", "php"),
            ("T", "trait", "php"),
        ],
        ["Foo\\Bar"],
        ["helper"],
    ),
    (
        "worker.rb",
        ("require 'json'\n"
        "class Worker\n"
        "  def run\n"
        "    helper()\n"
        "  end\n"
        "end\n"
        "module Util\nend\n"),
        [
            ("Worker", "class", "rb"),
            ("run", "method", "rb"),
            ("Util", "module", "rb"),
        ],
        [],
        # `require` is a bare method call in Ruby (import semantics); the graph
        # layer filters it out via CALL_NOISE.
        ["require", "helper"],
    ),
    (
        "Main.scala",
        ("package com.app\nimport scala.collection._\n"
        "object Main {\n  def run(): Unit = helper()\n}\n"
        "class Service {}\n"
        "trait T {}\n"),
        [
            ("Main", "object", "scala"),
            ("run", "function", "scala"),
            ("Service", "class", "scala"),
            ("T", "trait", "scala"),
        ],
        ["scala.collection._"],
        ["helper"],
    ),
    (
        "schema.sql",
        ("CREATE TABLE users (id INT);\n"
        "CREATE VIEW v AS SELECT 1;\n"
        "CREATE FUNCTION foo() RETURNS INT AS $$ SELECT 1 $$;\n"),
        [
            ("users", "table", "sql"),
            ("v", "view", "sql"),
            ("foo", "function", "sql"),
        ],
        [],
        [],
    ),
    (
        "run.sh",
        "#!/bin/bash\nfoo() { echo hi; }\nfunction bar { baz; }\n",
        [
            ("foo", "function", "sh"),
            ("bar", "function", "sh"),
        ],
        [],
        ["echo", "baz"],
    ),
    (
        "Get-Thing.ps1",
        "function Get-Thing { helper }\nclass Foo {}\n",
        [
            ("Get-Thing", "function", "ps1"),
            ("Foo", "class", "ps1"),
        ],
        [],
        ["helper"],
    ),
]


@pytest.mark.parametrize(
    "filename,code,expected_symbols,expected_imports,expected_calls",
    _NEW_LANG_CASES,
)
def test_tree_sitter_new_languages(
    filename: str,
    code: str,
    expected_symbols: list[tuple[str, str, str]],
    expected_imports: list[str],
    expected_calls: list[str],
) -> None:
    result = TreeSitterParser().parse(Path(filename), code)
    symbols = [(s.name, s.kind, s.language) for s in result.symbols]
    assert symbols == expected_symbols
    assert result.imports == expected_imports
    assert [c.name for c in result.calls] == expected_calls
    # every tree-sitter symbol carries a resolved end_line.
    assert all(s.end_line is not None for s in result.symbols)


def test_tree_sitter_end_line_spans_body() -> None:
    # A multi-line Ruby class must report the body span, not a single line.
    result = TreeSitterParser().parse(
        Path("worker.rb"),
        "class Worker\n  def run\n  end\nend\n",
    )
    by_name = {s.name: s for s in result.symbols}
    assert by_name["Worker"].end_line == 4
    assert by_name["run"].end_line == 3


def test_regex_batch_label_symbols() -> None:
    # .bat/.cmd have no tree-sitter grammar; regex extracts jump labels.
    result = RegexParser().parse(
        Path("go.bat"),
        "@echo off\ngoto :main\n:main\ncall :helper\n",
    )
    assert [(s.name, s.kind) for s in result.symbols] == [("main", "label")]


def test_tree_sitter_batch_falls_back_to_regex() -> None:
    parser = build_parser("tree_sitter")
    result = parser.parse(Path("go.bat"), "goto :main\n:main\n")
    # .bat is not in _GRAMMARS, so the fallback (regex) supplies the label.
    assert [(s.name, s.kind) for s in result.symbols] == [("main", "label")]
