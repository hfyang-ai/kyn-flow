"""对话工具共享的领域辅助函数。

这些函数被多个工具（repo_health、semantic_search、generate_report、
check_safety）以及工程工作流运行时复用，从 chat 路由中抽出以消除重复。
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session, selectinload

from app.db.models import Issue, PullRequest, Repository, WorkflowRun
from app.services.rag.retrieval import search_similar_documents
from app.services.repository_health import repository_health_snapshot


def _item_time(item: Any) -> datetime:
    return item.updated_at or item.created_at or datetime.min


def _join_items(items: list[str], empty_text: str) -> str:
    return "; ".join(items) if items else empty_text


def _source_type_from_message(message: str) -> str | None:
    lowered = message.lower()
    if "issue" in lowered:
        return "issue"
    if "pr" in lowered or "pull request" in lowered or "diff" in lowered:
        return "pull_request"
    if "ci" in lowered or "workflow" in lowered:
        return "workflow_run"
    if any(
        token in lowered for token in ["knowledge", "知识库", "上传资料", "上传文档"]
    ):
        return "knowledge_file"
    return None


def _risky_action(message: str) -> str | None:
    lowered = message.lower()
    if any(token in lowered for token in ["comment", "reply", "post"]):
        return "comment"
    if any(token in lowered for token in ["create issue", "new issue"]):
        return "create_issue"
    if any(token in lowered for token in ["send", "send_report"]):
        return "send_report"
    if any(token in lowered for token in ["close issue", "label", "write"]):
        return "write_back"
    return None


def _date_window_from_context(context: dict[str, Any]) -> tuple[datetime, datetime]:
    end_at = datetime.now(UTC)
    time_range = str(context.get("time_range") or "7d").lower()
    days = (
        int(time_range[:-1])
        if time_range.endswith("d") and time_range[:-1].isdigit()
        else 7
    )
    start_at = end_at - timedelta(days=max(1, days) - 1)
    if context.get("start_date"):
        start_at = datetime.fromisoformat(str(context["start_date"])).replace(
            tzinfo=UTC
        )
    if context.get("end_date"):
        end_at = datetime.fromisoformat(str(context["end_date"])).replace(
            hour=23, minute=59, second=59, tzinfo=UTC
        )
    return start_at, end_at


def _within(value: datetime | None, start_at: datetime, end_at: datetime) -> bool:
    if not value:
        return False
    current = value if value.tzinfo else value.replace(tzinfo=UTC)
    return start_at <= current <= end_at


def _repo_payload(
    repo_id: uuid.UUID, db: Session
) -> tuple[list[Issue], list[PullRequest], list[WorkflowRun]]:
    issues = db.query(Issue).filter(Issue.repo_id == repo_id).all()
    prs = (
        db.query(PullRequest)
        .options(
            selectinload(PullRequest.files), selectinload(PullRequest.review_comments)
        )
        .filter(PullRequest.repo_id == repo_id)
        .all()
    )
    runs = db.query(WorkflowRun).filter(WorkflowRun.repo_id == repo_id).all()
    return issues, prs, runs


def _repo_health_answer(
    repo: Repository,
    issues: list[Issue],
    prs: list[PullRequest],
    runs: list[WorkflowRun],
) -> str:
    snapshot = repository_health_snapshot(repo, issues, prs, runs)
    notice = f"当前仓库：{repo.full_name}\n\n数据说明：{snapshot['message']}"
    if not snapshot["evidence_count"]:
        return notice
    open_issues = [item for item in issues if item.state == "open"]
    open_prs = [item for item in prs if item.state == "open"]
    merged_prs = [item for item in prs if item.merged_at]
    failed_runs = [item for item in runs if item.conclusion == "failure"]
    latest_issues = sorted(open_issues, key=_item_time, reverse=True)[:3]
    latest_prs = sorted(prs, key=_item_time, reverse=True)[:3]
    issue_titles = _join_items(
        [f"#{item.number} {item.title}" for item in latest_issues], "没有打开的 Issue"
    )
    pr_titles = _join_items(
        [f"#{item.number} {item.title}" for item in latest_prs], "没有 PR 记录"
    )
    ci_text = (
        f"已同步 {len(failed_runs)} 次失败 CI 运行"
        if failed_runs
        else "还没有同步到失败 CI 运行"
    )
    return (
        f"{notice}\n\n"
        f"- Issues：{len(open_issues)} 个打开。近期关注：{issue_titles}。\n"
        f"- PRs：{len(open_prs)} 个打开，{len(merged_prs)} 个已合并。近期 PR：{pr_titles}。\n"
        f"- CI：{ci_text}。\n\n"
        "建议下一步：先看最新打开的 Issue，或检查最新 PR 风险；如果同步后出现失败 CI，可以让我继续排障。"
    )


def _semantic_search(
    repo: Repository, message: str, context: dict[str, Any], db: Session
) -> tuple[str, list[dict[str, str]], list[dict[str, Any]]]:
    filters = {
        "label": context.get("label"),
        "path": context.get("path"),
        "module": context.get("module"),
        "state": context.get("state"),
        "start_date": context.get("start_date"),
        "end_date": context.get("end_date"),
    }
    results = search_similar_documents(
        db,
        repo.id,
        message,
        source_type=context.get("source_type") or _source_type_from_message(message),
        limit=int(context.get("limit", 5)),
        metadata_filters={key: value for key, value in filters.items() if value},
    )
    if not results:
        return (
            "没有找到足够相似的历史记录。可以尝试放宽标签、路径或时间过滤条件。",
            [],
            [],
        )
    lines = ["找到以下相关历史记录："]
    citations: list[dict[str, str]] = []
    for index, item in enumerate(results, start=1):
        meta = item.get("metadata") or {}
        number = meta.get("number")
        prefix = f"#{number} " if number else ""
        lines.append(
            f"- [{index}] {item['source_type']} {prefix}{item['title']}：相似度 {item['score']}"
        )
        snippet = str(item.get("snippet") or "").strip()
        if snippet:
            lines.append(f"  证据：{snippet}")
        citations.append(
            {
                "type": item["source_type"],
                "id": item["source_id"],
                "title": item["title"],
            }
        )
    return "\n".join(lines), citations, results


def _draft_for_action(
    action: str,
    message: str,
    repo: Repository,
    issues: list[Issue],
    prs: list[PullRequest],
    runs: list[WorkflowRun],
) -> tuple[str, list[dict[str, str]]]:
    citations: list[dict[str, str]] = [
        {"type": "repository", "id": str(repo.id), "title": repo.full_name}
    ]
    latest_issue = max(issues, key=_item_time) if issues else None
    latest_pr = max(prs, key=_item_time) if prs else None
    failed_runs = [run for run in runs if run.conclusion == "failure"]
    if action == "create_issue":
        return (
            f"## Issue 草稿\n标题：{message.strip()[:120]}\n\n### 背景\n请补充影响范围、复现步骤和预期行为。\n\n### 验收标准\n- 预期行为清晰\n- 包含验证步骤\n",
            citations,
        )
    if action == "comment" and latest_pr:
        citations.append(
            {"type": "pull_request", "id": str(latest_pr.id), "title": latest_pr.title}
        )
        return (
            f"## PR 评论草稿\n针对 PR #{latest_pr.number}：{latest_pr.title}\n\n合并前请确认测试覆盖、未解决的 Review 评论，以及是否存在高风险文件。\n",
            citations,
        )
    if action == "comment" and latest_issue:
        citations.append(
            {"type": "issue", "id": str(latest_issue.id), "title": latest_issue.title}
        )
        return (
            f"## Issue 评论草稿\n针对 Issue #{latest_issue.number}：{latest_issue.title}\n\n请补充复现步骤、影响范围、预期行为，以及当前是否有临时绕过方案。\n",
            citations,
        )
    if action == "send_report":
        draft = (
            "## 报告发送草稿\n"
            f"仓库：{repo.full_name}\n\n"
            f"- 打开的 Issue：{len([issue for issue in issues if issue.state == 'open'])}\n"
            f"- 打开的 PR：{len([pr for pr in prs if pr.state == 'open'])}\n"
            f"- 失败 CI 运行：{len(failed_runs)}\n\n"
            "发送前请确认收件人、日期范围和敏感日志内容。\n"
        )
        return draft, citations
    return (
        f"## 写操作草稿\n这可能会写入 GitHub 或外部渠道。MVP 模式只生成动作草稿。\n\n用户请求：{message.strip()}\n",
        citations,
    )
