"""对话工具的组装入口。

把所有工具按 tool_name 绑定成 ChatAgent 期望的 `async (input_data, context)`
签名，供 chat 路由层注入会话上下文。
"""

from typing import Any

from sqlalchemy.orm import Session

from app.db.models import Conversation, Repository
from app.services.mcp_client import StdioMcpClient
from app.tools.analyze_ci import analyze_ci_tool
from app.tools.analyze_issue import analyze_issue_tool
from app.tools.analyze_pr import analyze_pr_tool
from app.tools.check_safety import check_safety_tool
from app.tools.context import ToolContext
from app.tools.engineering_workflow import run_engineering_workflow_tool
from app.tools.generate_report import generate_report_tool
from app.tools.memory_mcp import build_memory_mcp_tools
from app.tools.repo_health import repo_health_tool
from app.tools.semantic_search import semantic_search_tool
from app.tools.workspace_list_files import list_workspace_files_tool
from app.tools.workspace_read_file import read_workspace_file_tool
from app.tools.workspace_search_code import search_workspace_code_tool


def build_conversation_tools(
    repo: Repository | None, conversation: Conversation | None, db: Session
) -> dict[str, Any]:
    ctx = ToolContext(
        repo=repo,
        conversation=conversation,
        db=db,
        mcp_client=StdioMcpClient(),
    )

    def bind(fn: Any) -> Any:
        async def bound(input_data: dict[str, Any], context: dict[str, Any]):
            return await fn(ctx, input_data, context)

        return bound

    return {
        "workspace.list_files": bind(list_workspace_files_tool),
        "workspace.read_file": bind(read_workspace_file_tool),
        "workspace.search_code": bind(search_workspace_code_tool),
        "repo_health.generate_summary": bind(repo_health_tool),
        "rag.search_similar_documents": bind(semantic_search_tool),
        "issue_agent.analyze_issue": bind(analyze_issue_tool),
        "pr_review_agent.analyze_pr": bind(analyze_pr_tool),
        "ci_debug_agent.analyze_workflow_run": bind(analyze_ci_tool),
        "report_agent.generate_weekly_report": bind(generate_report_tool),
        "safety_agent.classify_action_risk": bind(check_safety_tool),
        "workflow.run_engineering_review": bind(run_engineering_workflow_tool),
        **build_memory_mcp_tools(ctx),
    }
