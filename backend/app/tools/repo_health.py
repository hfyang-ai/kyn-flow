"""repo_health.generate_summary 工具：汇总仓库健康状态。"""

from typing import Any

from pydantic import BaseModel, ConfigDict

from app.services.repository_health import repository_health_snapshot
from app.tools.context import ToolContext
from app.tools.helpers import _repo_health_answer, _repo_payload


class RepoHealthParams(BaseModel):
    """repo_health 内部自行读取仓库数据，不接受输入参数。"""

    model_config = ConfigDict(extra="allow")


async def repo_health_tool(
    ctx: ToolContext, input_data: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    if ctx.repo is None:
        return {
            "route": "unknown",
            "tool_calls": [],
            "answer": "当前还没有可用仓库，请先连接仓库。",
            "citations": [],
        }
    issues, prs, runs = _repo_payload(ctx.repo.id, ctx.db)
    snapshot = repository_health_snapshot(ctx.repo, issues, prs, runs)
    return {
        "route": "repo_health",
        "tool_calls": [
            {
                "tool_name": "repo_health.generate_summary",
                "arguments": {"repo_id": str(ctx.repo.id)},
                "status": snapshot["status"],
            }
        ],
        "data_status": snapshot["data_status"],
        "answer": _repo_health_answer(ctx.repo, issues, prs, runs),
        "citations": [
            {"type": "repository", "id": str(ctx.repo.id), "title": ctx.repo.full_name}
        ],
    }
