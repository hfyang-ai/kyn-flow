"""pr_review_agent.analyze_pr 工具：评审仓库最新 PR。"""

from typing import Any

from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import selectinload

from app.db.models import PullRequest
from app.services.agents.pr_review_agent import PRReviewAgent
from app.tools.context import ToolContext, agent_context
from app.tools.helpers import _join_items
from app.tools.repo_health import repo_health_tool


class AnalyzePrParams(BaseModel):
    """pr_review_agent.analyze_pr 内部自行读取最新 PR，不接受输入参数。"""

    model_config = ConfigDict(extra="allow")


async def analyze_pr_tool(
    ctx: ToolContext, input_data: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    if ctx.repo is None:
        return await repo_health_tool(ctx, input_data, context)
    pr = (
        ctx.db.query(PullRequest)
        .options(
            selectinload(PullRequest.files),
            selectinload(PullRequest.review_comments),
        )
        .filter(PullRequest.repo_id == ctx.repo.id)
        .order_by(PullRequest.created_at.desc())
        .first()
    )
    if not pr:
        return {
            "route": "pr_review",
            "tool_calls": [],
            "answer": f"仓库 {ctx.repo.full_name} 还没有同步到 PR。",
            "citations": [],
        }
    result = await PRReviewAgent().run(
        {
            "number": pr.number,
            "title": pr.title,
            "body": pr.body,
            "files": [
                {
                    "filename": file.filename,
                    "status": file.status,
                    "patch": file.patch,
                }
                for file in pr.files
            ],
            "comments": [
                {
                    "body": comment.body,
                    "path": comment.path,
                    "line": comment.line,
                    "author": comment.author,
                }
                for comment in pr.review_comments
            ],
        },
        agent_context(context) | {"repo_id": str(ctx.repo.id)},
    )
    return {
        "route": "pr_review",
        "tool_calls": [
            {
                "tool_name": "pr_review_agent.analyze_pr",
                "arguments": {"pr_id": str(pr.id)},
                "status": "success",
            }
        ],
        "answer": f"PR #{pr.number} 摘要：{result['summary']}\n\n主要风险：{_join_items(result['risk_points'], '没有明显风险。')}\n测试建议：{_join_items(result['test_suggestions'], '运行相关测试和核心流程检查。')}",
        "citations": [
            {"type": "pull_request", "id": str(pr.id), "title": pr.title}
        ],
    }
