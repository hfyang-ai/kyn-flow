"""report_agent.generate_weekly_report 工具：生成研发周报。"""

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.services.agents.report_agent import ReportAgent
from app.services.rag.vector_store import add_document
from app.tools.context import ToolContext
from app.tools.helpers import (
    _date_window_from_context,
    _repo_payload,
    _within,
)
from app.tools.repo_health import repo_health_tool


class GenerateReportParams(BaseModel):
    """report_agent.generate_weekly_report 内部自行读取仓库数据，不接受输入参数。"""

    model_config = ConfigDict(extra="allow")


async def generate_report_tool(
    ctx: ToolContext, input_data: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    if ctx.repo is None:
        return await repo_health_tool(ctx, input_data, context)
    issues, prs, runs = _repo_payload(ctx.repo.id, ctx.db)
    start_at, end_at = _date_window_from_context(context)
    scoped_issues = [
        item
        for item in issues
        if any(
            _within(value, start_at, end_at)
            for value in [item.created_at, item.updated_at, item.closed_at]
        )
    ]
    scoped_prs = [
        item
        for item in prs
        if any(
            _within(value, start_at, end_at)
            for value in [item.created_at, item.updated_at, item.merged_at]
        )
    ]
    scoped_runs = [
        item
        for item in runs
        if any(
            _within(value, start_at, end_at)
            for value in [item.created_at, item.updated_at]
        )
    ]
    result = await ReportAgent().run(
        {
            "issues": [
                {
                    "number": item.number,
                    "title": item.title,
                    "state": item.state,
                    "closed_at": item.closed_at,
                }
                for item in scoped_issues
            ],
            "pull_requests": [
                {
                    "number": item.number,
                    "title": item.title,
                    "state": item.state,
                    "merged_at": item.merged_at,
                }
                for item in scoped_prs
            ],
            "workflow_runs": [
                {"name": item.name, "conclusion": item.conclusion}
                for item in scoped_runs
            ],
            "metrics": {
                "issues": len(scoped_issues),
                "pull_requests": len(scoped_prs),
                "merged_prs": len([item for item in scoped_prs if item.merged_at]),
                "open_prs": len(
                    [item for item in scoped_prs if item.state == "open"]
                ),
                "failed_ci": len(
                    [item for item in scoped_runs if item.conclusion == "failure"]
                ),
            },
        },
        {
            "repo_id": str(ctx.repo.id),
            "repo_name": ctx.repo.full_name,
            "start_date": start_at.date().isoformat(),
            "end_date": end_at.date().isoformat(),
        },
    )
    add_document(
        ctx.db,
        ctx.repo.id,
        "weekly_report",
        None,
        f"研发周报 {start_at.date().isoformat()} - {end_at.date().isoformat()}",
        result["report_markdown"],
        {
            "display_title": f"研发周报 {start_at.date().isoformat()} - {end_at.date().isoformat()}",
            "start_date": start_at.date().isoformat(),
            "end_date": end_at.date().isoformat(),
            "repo_name": ctx.repo.full_name,
            "generated_at": datetime.now(UTC).isoformat(),
            "source": "chat",
        },
        commit=False,
    )
    return {
        "route": "weekly_report",
        "tool_calls": [
            {
                "tool_name": "report_agent.generate_weekly_report",
                "arguments": {"repo_id": str(ctx.repo.id)},
                "status": "success",
            }
        ],
        "answer": result["report_markdown"],
        "citations": [
            {"type": "repository", "id": str(ctx.repo.id), "title": ctx.repo.full_name}
        ],
    }
