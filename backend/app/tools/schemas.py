"""工具参数 schema 的集中登记。

每个工具在自己的模块里声明 ``Params``（Pydantic 参数模型），作为该工具参数的
单一来源：既用于 ChatAgent 生成 LangChain ``StructuredTool`` 的 ``args_schema``，
也用于工具内部 ``Params.model_validate(input_data)`` 做校验与取值。

这里按公开工具名把 ``Params`` 类登记成映射，供 ChatAgent 查询，避免再手写一份
与实现分离、容易漂移的 schema 表。新增工具时，只需在对应模块定义 ``Params`` 并
在此登记一行。
"""

from pydantic import BaseModel

from app.tools.analyze_ci import AnalyzeCiParams
from app.tools.analyze_issue import AnalyzeIssueParams
from app.tools.analyze_pr import AnalyzePrParams
from app.tools.check_safety import CheckSafetyParams
from app.tools.engineering_workflow import EngineeringWorkflowParams
from app.tools.generate_report import GenerateReportParams
from app.tools.memory_mcp import SearchEvidenceParams, ThreadContextParams
from app.tools.repo_health import RepoHealthParams
from app.tools.semantic_search import SemanticSearchParams
from app.tools.workspace_list_files import ListFilesParams
from app.tools.workspace_read_file import ReadFileParams
from app.tools.workspace_search_code import SearchCodeParams

TOOL_PARAMS: dict[str, type[BaseModel]] = {
    "workspace.list_files": ListFilesParams,
    "workspace.read_file": ReadFileParams,
    "workspace.search_code": SearchCodeParams,
    "repo_health.generate_summary": RepoHealthParams,
    "rag.search_similar_documents": SemanticSearchParams,
    "issue_agent.analyze_issue": AnalyzeIssueParams,
    "pr_review_agent.analyze_pr": AnalyzePrParams,
    "ci_debug_agent.analyze_workflow_run": AnalyzeCiParams,
    "report_agent.generate_weekly_report": GenerateReportParams,
    "safety_agent.classify_action_risk": CheckSafetyParams,
    "workflow.run_engineering_review": EngineeringWorkflowParams,
    "kynflow_search_evidence": SearchEvidenceParams,
    "kynflow_get_thread_context": ThreadContextParams,
    "kynflow_read_session_events": ThreadContextParams,
}
