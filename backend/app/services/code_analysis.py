"""Repository checkout synchronization and code-graph analysis."""

import asyncio
import logging
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decrypt_token
from app.db.models import CodeRelation, CodeSymbol, Document, Repository
from app.db.session import SessionLocal
from app.services.code_parsing import build_parser

logger = logging.getLogger(__name__)

SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".next",
    ".nuxt",
    ".venv",
    "venv",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
}

TEXT_EXTENSIONS = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".java",
    ".go",
    ".rs",
    ".cs",
    ".cpp",
    ".c",
    ".h",
    ".hpp",
    ".php",
    ".rb",
    ".swift",
    ".kt",
    ".kts",
    ".scala",
    ".sql",
    ".sh",
    ".ps1",
    ".bat",
    ".cmd",
    ".html",
    ".css",
    ".scss",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".md",
    ".mdx",
    ".txt",
    ".dockerfile",
}

TEXT_FILENAMES = {
    "Dockerfile",
    "Makefile",
    "README",
    "LICENSE",
    "package.json",
    "requirements.txt",
    "pyproject.toml",
}

# Call-target names that should never surface as cross-symbol `calls` edges
# (keywords / builtins the regex backend can't distinguish from real symbols).
CALL_NOISE = {
    "if",
    "for",
    "while",
    "return",
    "print",
    "len",
    "str",
    "int",
    # import-semantics method calls (Ruby / CommonJS) — not symbol references.
    "require",
    "require_relative",
}

# Shell / PowerShell builtins and ubiquitous system commands that never resolve
# to project symbols. Applied only to shell-family files (not globally, since
# e.g. `printf` is a real symbol in C and `test` in many languages).
SHELL_CALL_NOISE = {
    # bash builtins
    "echo", "cd", "pwd", "export", "unset", "set", "local", "declare",
    "read", "readarray", "mapfile", "source", "eval", "exec", "shift",
    "trap", "wait", "kill", "printf", "test", "let", "type", "alias",
    "unalias", "ulimit", "umask", "pushd", "popd", "dirs", "exit",
    "command", "builtin", "getopts", "hash", "help", "break", "continue",
    "true", "false",
    # ubiquitous external commands
    "ls", "cat", "grep", "sed", "awk", "cp", "mv", "rm", "mkdir", "rmdir",
    "touch", "chmod", "chown", "find", "tar", "gzip", "gunzip", "curl",
    "wget", "git", "ssh", "scp", "make", "docker", "node", "npm", "pip",
    "python", "python3", "go", "cargo", "kubectl", "systemctl",
}

# File suffixes whose call targets are filtered against SHELL_CALL_NOISE.
SHELL_FILE_SUFFIXES = {".sh", ".ps1", ".bat", ".cmd"}


def _checkout_root() -> Path:
    root = Path(settings.repo_checkout_dir)
    if not root.is_absolute():
        root = Path.cwd() / root
    root.mkdir(parents=True, exist_ok=True)
    return root


def _repo_checkout_path(repo: Repository) -> Path:
    safe_name = repo.full_name.replace("/", "__").replace("\\", "__")
    return _checkout_root() / f"{repo.id}-{safe_name}"


def _stored_checkout_path(repo: Repository) -> Path | None:
    raw_path = getattr(repo, "local_path", None)
    if not raw_path:
        return None
    path = Path(os.path.expandvars(os.path.expanduser(str(raw_path))))
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def _clone_url(repo: Repository) -> str:
    if repo.clone_url:
        return repo.clone_url
    return f"https://github.com/{repo.owner}/{repo.name}.git"


def _clone_url_with_token(url: str, token: str | None) -> str:
    if not token:
        return url
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or "@" in parsed.netloc:
        return url
    safe_token = quote(token, safe="")
    return urlunparse(
        parsed._replace(netloc=f"x-access-token:{safe_token}@{parsed.netloc}")
    )


def _run_git(args: list[str], cwd: Path | None = None) -> None:
    subprocess.run(
        ["git", *args],
        cwd=str(cwd) if cwd else None,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        timeout=180,
    )


def _is_git_work_tree(path: Path) -> bool:
    if not path.exists() or not path.is_dir() or not shutil.which("git"):
        return False
    result = subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"],
        cwd=str(path),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        timeout=30,
        check=False,
    )
    return result.returncode == 0 and result.stdout.strip().lower() == "true"


def _sync_checkout(repo: Repository, token: str | None) -> Path:
    stored_path = _stored_checkout_path(repo)
    checkout_mode = getattr(repo, "checkout_mode", None) or "managed"

    if stored_path and checkout_mode == "local":
        if not _is_git_work_tree(stored_path):
            raise RuntimeError(f"已配置的本地仓库路径不是 git 工作树：{stored_path}")
        return stored_path

    target = stored_path or _repo_checkout_path(repo)
    clone_url = _clone_url_with_token(_clone_url(repo), token)
    branch = repo.default_branch or "main"

    if not shutil.which("git"):
        raise RuntimeError("未找到 git 可执行文件，无法克隆仓库代码")

    if (target / ".git").exists() or _is_git_work_tree(target):
        try:
            _run_git(["fetch", "--depth", "1", "origin", branch], cwd=target)
            _run_git(["checkout", branch], cwd=target)
            _run_git(["pull", "--ff-only", "origin", branch], cwd=target)
        except subprocess.CalledProcessError as exc:
            logger.warning(
                "更新现有 checkout %s 失败，将使用缓存文件：%s",
                target,
                (exc.stderr or exc).strip(),
            )
        return target

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if stored_path and any(target.iterdir()):
            raise RuntimeError(
                f"Configured download target already exists and is not an empty git work tree: {target}"
            )
        shutil.rmtree(target)
    clone_args = ["clone", "--depth", "1"]
    if branch:
        clone_args.extend(["--branch", branch])
    clone_args.extend([clone_url, str(target)])
    _run_git(clone_args)
    return target


def _is_text_candidate(path: Path) -> bool:
    if path.name in TEXT_FILENAMES:
        return True
    suffix = path.suffix.lower()
    return suffix in TEXT_EXTENSIONS or path.name.lower().endswith("dockerfile")


def _read_text(path: Path, max_bytes: int = 300_000) -> str | None:
    try:
        with path.open("rb") as handle:
            data = handle.read(max_bytes + 1)
    except OSError:
        return None
    if not data or len(data) > max_bytes or b"\x00" in data[:4096]:
        return None
    for encoding in ["utf-8-sig", "utf-8", "gb18030", "latin-1"]:
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return None


def _git_text(args: list[str], cwd: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=30,
        )
        return result.stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None


def _sync_code_graph(
    db: Session,
    repo: Repository,
    checkout_path: Path,
    *,
    branch: str | None,
    commit_sha: str | None,
    pr_id: uuid.UUID | None = None,
    pr_number: int | None = None,
    max_files: int = 500,
) -> int:
    parser = build_parser(settings.code_parser)
    db.query(CodeRelation).filter(
        CodeRelation.repo_id == repo.id,
        CodeRelation.branch == branch,
        CodeRelation.pr_id == pr_id,
        CodeRelation.pr_number == pr_number,
    ).delete(synchronize_session=False)
    db.query(CodeSymbol).filter(
        CodeSymbol.repo_id == repo.id,
        CodeSymbol.branch == branch,
        CodeSymbol.pr_id == pr_id,
        CodeSymbol.pr_number == pr_number,
    ).delete(synchronize_session=False)
    symbol_rows: list[CodeSymbol] = []
    files_seen = 0
    for path in checkout_path.rglob("*"):
        if files_seen >= max_files:
            break
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(checkout_path).parts):
            continue
        if not _is_text_candidate(path):
            continue
        text = _read_text(path, max_bytes=180_000)
        if not text:
            continue
        symbols = parser.parse(path, text).symbols
        if not symbols:
            continue
        relative_path = path.relative_to(checkout_path).as_posix()
        files_seen += 1
        for sym in symbols:
            row = CodeSymbol(
                repo_id=repo.id,
                path=relative_path,
                name=sym.name,
                kind=sym.kind,
                language=sym.language,
                start_line=sym.start_line,
                end_line=sym.end_line,
                branch=branch,
                commit_sha=commit_sha,
                pr_id=pr_id,
                pr_number=pr_number,
                meta={},
            )
            db.add(row)
            symbol_rows.append(row)
    db.flush()
    by_name = {row.name: row for row in symbol_rows}
    for path in checkout_path.rglob("*"):
        if (
            not path.is_file()
            or any(part in SKIP_DIRS for part in path.relative_to(checkout_path).parts)
            or not _is_text_candidate(path)
        ):
            continue
        text = _read_text(path, max_bytes=180_000)
        if not text:
            continue
        relative_path = path.relative_to(checkout_path).as_posix()
        result = parser.parse(path, text)
        for target in result.imports:
            db.add(
                CodeRelation(
                    repo_id=repo.id,
                    source_name=relative_path,
                    target_name=target,
                    relation_type="imports",
                    path=relative_path,
                    branch=branch,
                    pr_id=pr_id,
                    pr_number=pr_number,
                    meta={},
                )
            )
        local_symbols = [row for row in symbol_rows if row.path == relative_path]
        source = local_symbols[0] if local_symbols else None
        noise = CALL_NOISE | SHELL_CALL_NOISE if path.suffix.lower() in SHELL_FILE_SUFFIXES else CALL_NOISE
        seen_calls: set[str] = set()
        for call in result.calls:
            target_name = call.name
            if target_name in seen_calls or target_name in noise:
                continue
            seen_calls.add(target_name)
            target = by_name.get(target_name)
            db.add(
                CodeRelation(
                    repo_id=repo.id,
                    source_symbol_id=source.id if source else None,
                    target_symbol_id=target.id if target else None,
                    source_name=source.name if source else relative_path,
                    target_name=target_name,
                    relation_type="calls",
                    path=relative_path,
                    branch=branch,
                    pr_id=pr_id,
                    pr_number=pr_number,
                    meta={"line": call.line},
                )
            )
    return len(symbol_rows)


def purge_legacy_code_documents(db: Session, repo_id: uuid.UUID | None = None) -> int:
    query = db.query(Document).filter(Document.source_type == "code_file")
    if repo_id is not None:
        query = query.filter(Document.repo_id == repo_id)
    return query.delete(synchronize_session=False)


async def sync_repository_code_analysis(db: Session, repo: Repository) -> int:
    token = (
        decrypt_token(repo.github_token_encrypted, settings.token_encryption_key)
        if repo.github_token_encrypted
        else None
    )
    checkout_path = await asyncio.to_thread(_sync_checkout, repo, token)
    branch = (
        repo.default_branch
        or _git_text(["branch", "--show-current"], checkout_path)
        or "main"
    )
    commit_sha = _git_text(["rev-parse", "HEAD"], checkout_path)
    symbol_count = await asyncio.to_thread(
        _sync_code_graph,
        db,
        repo,
        checkout_path,
        branch=branch,
        commit_sha=commit_sha,
    )
    purge_legacy_code_documents(db, repo.id)
    repo.clone_url = repo.clone_url or _clone_url(repo)
    db.commit()
    return symbol_count


async def sync_repository_code_analysis_by_id(repo_id: uuid.UUID) -> int | None:
    db = SessionLocal()
    try:
        repo = db.get(Repository, repo_id)
        if repo is None:
            return None
        try:
            return await sync_repository_code_analysis(db, repo)
        except Exception as exc:
            logger.warning(
                "Failed to sync repository code analysis for %s: %s", repo_id, exc
            )
            return None
    finally:
        db.close()
