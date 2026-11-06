"""safety_agent.classify_action_risk 工具：对写操作生成安全草稿。"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import ActionDraft
from app.services.agents.safety_agent import SafetyAgent
from app.services.permissions import ensure_demo_user, write_audit_log
from app.tools.context import ToolContext, agent_context
from app.tools.helpers import (
    _draft_for_action,
    _item_time,
    _repo_payload,
    _risky_action,
)
from app.tools.repo_health import repo_health_tool


class CheckSafetyParams(BaseModel):
    model_config = ConfigDict(extra="allow")

    message: str = Field(
        min_length=1, description="触发写操作或外部发送的原始用户消息"
    )


async def check_safety_tool(
    ctx: ToolContext, input_data: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    if ctx.repo is None:
        return await repo_health_tool(ctx, input_data, context)
    params = CheckSafetyParams.model_validate(input_data)
    issues, prs, runs = _repo_payload(ctx.repo.id, ctx.db)
    action = _risky_action(params.message) or "write_back"
    draft, citations = _draft_for_action(
        action, params.message, ctx.repo, issues, prs, runs
    )
    safety = await SafetyAgent().run(
        {"action": action, "draft": draft}, agent_context(context)
    )
    latest_issue = max(issues, key=_item_time) if issues else None
    latest_pr = max(prs, key=_item_time) if prs else None
    target_type = "repository"
    target_id = None
    metadata: dict[str, Any] = {"source": "chat", "message": params.message}
    if action == "comment" and latest_pr:
        target_type = "pull_request"
        target_id = latest_pr.id
        metadata["pr_number"] = latest_pr.number
    elif action in {"comment", "create_issue", "close_issue"} and latest_issue:
        target_type = "issue"
        target_id = latest_issue.id
        metadata["issue_number"] = latest_issue.number
    draft_type = {
        "comment": "pr_comment"
        if target_type == "pull_request"
        else "issue_comment",
        "create_issue": "create_issue",
        "send_report": "send_report",
        "write_back": "comment",
    }.get(action, action)
    user = ensure_demo_user(ctx.db)
    action_draft = ActionDraft(
        repo_id=ctx.repo.id,
        draft_type=draft_type,
        target_type=target_type,
        target_id=target_id,
        title=f"{draft_type} 草稿",
        content=str(safety.get("draft") or draft),
        risk_level=str(safety.get("risk_level") or "medium"),
        created_by=user.id,
        meta=metadata,
    )
    ctx.db.add(action_draft)
    ctx.db.flush()
    write_audit_log(
        ctx.db,
        user=user,
        repo_id=ctx.repo.id,
        action="action_draft.create_from_chat",
        target_type=target_type,
        target_id=str(target_id) if target_id else None,
        request_json={"action": action, "draft_type": draft_type},
        result_json={"draft_id": str(action_draft.id)},
    )
    return {
        "route": "safety_draft",
        "tool_calls": [
            {
                "tool_name": "safety_agent.classify_action_risk",
                "arguments": {"action": action, "draft_id": str(action_draft.id)},
                "status": "success",
            }
        ],
        "answer": f"这个请求可能写入 GitHub 或发送到外部渠道，已生成待确认安全草稿。\n\n草稿 ID：{action_draft.id}\n\n{safety.get('draft') or draft!s}",
        "citations": citations,
    }
