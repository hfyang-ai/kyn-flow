"""issue_agent.analyze_issue 工具：分析仓库最新 Issue。"""

from typing import Any

from pydantic import BaseModel, ConfigDict

from app.db.models import Issue
from app.services.agents.issue_agent import IssueAgent
from app.tools.context import ToolContext, agent_context
from app.tools.helpers import _join_items
from app.tools.repo_health import repo_health_tool


class AnalyzeIssueParams(BaseModel):
    """issue_agent.analyze_issue 内部自行读取最新 Issue，不接受输入参数。"""

    model_config = ConfigDict(extra="allow")


async def analyze_issue_tool(
    ctx: ToolContext, input_data: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    if ctx.repo is None:
        return await repo_health_tool(ctx, input_data, context)
    issue = (
        ctx.db.query(Issue)
        .filter(Issue.repo_id == ctx.repo.id)
        .order_by(Issue.created_at.desc())
        .first()
    )
    if not issue:
        return {
            "route": "issue_analysis",
            "tool_calls": [],
            "answer": f"仓库 {ctx.repo.full_name} 还没有同步到 Issue。",
            "citations": [],
        }
    result = await IssueAgent().run(
        {
            "id": str(issue.id),
            "title": issue.title,
            "body": issue.body,
            "labels": issue.labels,
            "number": issue.number,
            "state": issue.state,
            "assignees": issue.assignees,
            "author": issue.author,
        },
        agent_context(context),
    )
    return {
        "route": "issue_analysis",
        "tool_calls": [
            {
                "tool_name": "issue_agent.analyze_issue",
                "arguments": {"issue_id": str(issue.id)},
                "status": "success",
            }
        ],
        "answer": (
            f"Issue #{issue.number} 的结论：{result['conclusion']}。\n\n"
            f"- 分类：{result['category']}\n"
            f"- 优先级：{result['priority']}\n"
            f"- 复杂度：{result['complexity']}\n"
            f"- 建议负责人：{result['suggested_owner']}，{result['owner_reason']}\n\n"
            f"理由：{result['conclusion_reason']}\n\n"
            f"下一步：{_join_items(result.get('checklist') or result.get('action_items') or [], '补充复现步骤、影响范围和验收标准。')}"
        ),
        "citations": [{"type": "issue", "id": str(issue.id), "title": issue.title}],
    }
