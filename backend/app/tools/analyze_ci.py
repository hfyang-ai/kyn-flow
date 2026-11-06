"""ci_debug_agent.analyze_workflow_run 工具：排查失败 CI。"""

from typing import Any

from pydantic import BaseModel, ConfigDict

from app.db.models import WorkflowRun
from app.services.agents.ci_debug_agent import CIDebugAgent
from app.tools.context import ToolContext, agent_context
from app.tools.helpers import _join_items
from app.tools.repo_health import repo_health_tool


class AnalyzeCiParams(BaseModel):
    """ci_debug_agent.analyze_workflow_run 内部自行读取失败 CI，不接受输入参数。"""

    model_config = ConfigDict(extra="allow")


async def analyze_ci_tool(
    ctx: ToolContext, input_data: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    if ctx.repo is None:
        return await repo_health_tool(ctx, input_data, context)
    run = (
        ctx.db.query(WorkflowRun)
        .filter(WorkflowRun.repo_id == ctx.repo.id, WorkflowRun.conclusion == "failure")
        .order_by(WorkflowRun.created_at.desc())
        .first()
    )
    if not run:
        result = await repo_health_tool(ctx, input_data, context)
        result["answer"] += (
            "\n\n说明：本地没有失败 CI 记录，不能据此确认远端 CI 全部通过。"
        )
        return result
    result = await CIDebugAgent().run(
        {
            "name": run.name,
            "status": run.status,
            "conclusion": run.conclusion,
            "jobs": run.jobs or [],
            "logs_text": run.logs_text,
        },
        agent_context(context) | {"repo_id": str(ctx.repo.id)},
    )
    return {
        "route": "ci_debug",
        "tool_calls": [
            {
                "tool_name": "ci_debug_agent.analyze_workflow_run",
                "arguments": {"run_id": str(run.id)},
                "status": "success",
            }
        ],
        "answer": f"最新失败 CI：{run.name}。失败类型：{result['failure_type']}。\n\n{result['failure_summary']}\n\n排查步骤：{_join_items(result['debug_steps'], '没有明确可用的排查步骤。')}",
        "citations": [
            {"type": "workflow_run", "id": str(run.id), "title": run.name}
        ],
    }
