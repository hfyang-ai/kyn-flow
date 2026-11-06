"""工程工作流：运行时、持久化、响应组装与 workflow.run_engineering_review 工具。

这部分逻辑相对独立且体量较大，从 chat 路由中整体抽出，避免路由文件继续膨胀。
"""

import re
import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db.models import (
    AgentTaskRun,
    AgentWorkflowRun,
    Conversation,
    Repository,
)
from app.schemas.workflow import WorkflowSpec, WorkflowTask, WorkflowTaskResult
from app.services.agents.ci_debug_agent import CIDebugAgent
from app.services.agents.issue_agent import IssueAgent
from app.services.agents.pr_review_agent import PRReviewAgent
from app.services.agents.safety_agent import SafetyAgent
from app.services.agents.workflow_orchestrator import WorkflowOrchestrator
from app.services.memory_hub import record_recall_event
from app.services.repository_health import repository_health_snapshot
from app.services.skills import SkillRegistry
from app.tools.context import ToolContext, agent_context
from app.tools.helpers import (
    _draft_for_action,
    _item_time,
    _repo_health_answer,
    _repo_payload,
    _risky_action,
    _semantic_search,
)
from app.tools.repo_health import repo_health_tool


class WorkflowTargetResolutionError(ValueError):
    """Raised when an explicitly requested workflow target cannot be resolved safely."""


class EngineeringWorkflowParams(BaseModel):
    model_config = ConfigDict(extra="allow")

    message: str = Field(
        default="", description="工作流目标描述，用于解析 Issue/PR/CI 目标"
    )
    query: str = Field(
        default="", description="工作流目标，message 为空时的回退"
    )


_WORKFLOW_TARGET_PATTERNS: dict[str, tuple[str, ...]] = {
    "issue": (
        r"(?<![A-Za-z0-9_])issue(?![A-Za-z0-9_])\s*(?:#|＃|no\.?|number|id)?\s*(\d+)",
        r"(?:工单|议题)\s*(?:#|＃|编号)?\s*(\d+)",
    ),
    "pull_request": (
        r"(?<![A-Za-z0-9_])(?:pr|pull[\s_-]*request)(?![A-Za-z0-9_])\s*(?:#|＃|no\.?|number|id)?\s*(\d+)",
        r"合并请求\s*(?:#|＃|编号)?\s*(\d+)",
    ),
    "workflow_run": (
        r"(?<![A-Za-z0-9_])(?:ci|workflow[\s_-]*run)(?![A-Za-z0-9_])\s*(?:#|＃|no\.?|number|id)?\s*(\d+)",
        r"(?<![A-Za-z0-9_])run(?![A-Za-z0-9_])\s*(?:#|＃|id)\s*(\d+)",
        r"(?:CI\s*运行|工作流运行|流水线)\s*(?:#|＃|编号|ID)?\s*(\d+)",
    ),
}

_WORKFLOW_TARGET_LABELS = {
    "issue": "Issue",
    "pull_request": "PR",
    "workflow_run": "CI/Workflow Run",
}


def _safe_confidence(value: Any, default: float) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def _skipped_workflow_result(task: WorkflowTask, summary: str) -> WorkflowTaskResult:
    return WorkflowTaskResult(
        task_id=task.id,
        agent_name=task.agent_name,
        task_type=task.task_type,
        status="skipped",
        summary=summary,
        confidence=0.0,
    )


def _requested_workflow_target_number(message: str, target_type: str) -> int | None:
    numbers = {
        int(match.group(1))
        for pattern in _WORKFLOW_TARGET_PATTERNS[target_type]
        for match in re.finditer(pattern, message, flags=re.IGNORECASE)
    }
    if len(numbers) > 1:
        references = "、".join(f"#{number}" for number in sorted(numbers))
        raise WorkflowTargetResolutionError(
            f"一次工作流只能为一个 {_WORKFLOW_TARGET_LABELS[target_type]} 建立明确 claim；检测到多个目标：{references}。"
        )
    return next(iter(numbers), None)


def _target_by_number(
    items: list[Any],
    number: int | None,
    *,
    target_type: str,
    number_attribute: str,
) -> Any | None:
    if number is None:
        return None
    target = next(
        (item for item in items if getattr(item, number_attribute, None) == number),
        None,
    )
    if target is None:
        raise WorkflowTargetResolutionError(
            f"当前仓库没有同步 {_WORKFLOW_TARGET_LABELS[target_type]} #{number}，已停止生成计划；不会回退到最新对象。"
        )
    return target


def _build_engineering_workflow_runtime(
    repo: Repository,
    db: Session,
    message: str,
    context: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    issues, prs, runs = _repo_payload(repo.id, db)
    failed_runs = [run for run in runs if run.conclusion == "failure"]
    requested_issue_number = _requested_workflow_target_number(message, "issue")
    requested_pr_number = _requested_workflow_target_number(message, "pull_request")
    requested_run_number = _requested_workflow_target_number(message, "workflow_run")
    selected_issue = _target_by_number(
        issues,
        requested_issue_number,
        target_type="issue",
        number_attribute="number",
    )
    selected_pr = _target_by_number(
        prs,
        requested_pr_number,
        target_type="pull_request",
        number_attribute="number",
    )
    selected_run = _target_by_number(
        runs,
        requested_run_number,
        target_type="workflow_run",
        number_attribute="github_run_id",
    )
    if selected_issue is None:
        selected_issue = max(issues, key=_item_time) if issues else None
    if selected_pr is None:
        selected_pr = max(prs, key=_item_time) if prs else None
    if selected_run is None:
        selected_run = max(failed_runs, key=_item_time) if failed_runs else None

    def claimed_target(
        task: WorkflowTask, target_type: str, items: list[Any], fallback: Any | None
    ) -> Any | None:
        if task.claim.target_type != target_type:
            raise WorkflowTargetResolutionError(
                f"任务 {task.id} 的 claim 类型为 {task.claim.target_type!r}，预期为 {target_type!r}。"
            )
        if not task.claim.target_id:
            return fallback
        try:
            target_id = uuid.UUID(str(task.claim.target_id))
        except (TypeError, ValueError) as exc:
            raise WorkflowTargetResolutionError(
                f"任务 {task.id} 的 claim.target_id 不是有效 UUID。"
            ) from exc
        target = next((item for item in items if item.id == target_id), None)
        if target is None:
            raise WorkflowTargetResolutionError(
                f"任务 {task.id} 的 claim 目标不存在或不属于仓库 {repo.full_name}；不会回退到最新对象。"
            )
        return target

    safe_context = agent_context(context)
    skill_registry = context.get("_skill_registry")
    agent_skill_cache: dict[str, dict[str, Any]] = {}

    def agent_skill_context(entrypoint: str) -> dict[str, Any]:
        if entrypoint in agent_skill_cache:
            return agent_skill_cache[entrypoint]
        if not isinstance(skill_registry, SkillRegistry):
            agent_skill_cache[entrypoint] = {}
            return {}
        activation = skill_registry.activate_entrypoint(entrypoint)
        if activation is None:
            agent_skill_cache[entrypoint] = {}
            return {}
        payload = activation.model_dump(mode="json")
        runtime = {
            "active_skills": [payload],
            "skill_instructions": activation.prompt_block(),
            "skill_runtime": {
                **activation.trace_metadata(),
                "entrypoint": activation.entrypoint,
                "output_contract": activation.output_contract,
                "safety_level": activation.safety_level,
                "instructions_loaded": True,
            },
        }
        agent_skill_cache[entrypoint] = runtime
        return runtime

    def with_skill_runtime(result: dict[str, Any], entrypoint: str) -> dict[str, Any]:
        runtime = agent_skill_context(entrypoint).get("skill_runtime")
        return (
            {
                **result,
                "_skill_runtime": {**runtime, "validation": "entrypoint_completed"},
            }
            if runtime
            else result
        )

    workflow_context = {
        **safe_context,
        "repo_id": str(repo.id),
        "repo_full_name": repo.full_name,
        "has_repo": True,
        "has_issue": selected_issue is not None,
        "issue_id": str(selected_issue.id) if selected_issue else None,
        "issue_number": selected_issue.number if selected_issue else None,
        "issue_explicit": requested_issue_number is not None,
        "has_pr": selected_pr is not None,
        "pr_id": str(selected_pr.id) if selected_pr else None,
        "pr_number": selected_pr.number if selected_pr else None,
        "pr_explicit": requested_pr_number is not None,
        "has_ci_run": selected_run is not None,
        "has_failed_ci": selected_run is not None
        and selected_run.conclusion == "failure",
        "workflow_run_id": str(selected_run.id) if selected_run else None,
        "workflow_run_number": selected_run.github_run_id if selected_run else None,
        "workflow_run_explicit": requested_run_number is not None,
        "requires_safety": bool(_risky_action(message)),
        "team_members": safe_context.get("team_members") or [],
    }

    async def run_repo_health(
        task: WorkflowTask, spec: WorkflowSpec, workflow_context: dict[str, Any]
    ) -> WorkflowTaskResult:
        answer = _repo_health_answer(repo, issues, prs, runs)
        snapshot = repository_health_snapshot(repo, issues, prs, runs)
        open_issue_count = len([item for item in issues if item.state == "open"])
        open_pr_count = len([item for item in prs if item.state == "open"])
        return WorkflowTaskResult(
            task_id=task.id,
            agent_name=task.agent_name,
            task_type=task.task_type,
            status=snapshot["status"],
            summary=f"{snapshot['message']} 本地记录：{open_issue_count} 个打开的 Issue，{open_pr_count} 个打开的 PR，{len(failed_runs)} 次失败 CI。",
            output={
                **snapshot,
                "answer": answer,
                "open_issues": open_issue_count,
                "open_prs": open_pr_count,
                "failed_ci": len(failed_runs),
            },
            evidence_count=snapshot["evidence_count"],
            confidence=snapshot["confidence"],
            error=snapshot["message"] if snapshot["status"] == "error" else None,
            citations=[
                {"type": "repository", "id": str(repo.id), "title": repo.full_name}
            ],
        )

    async def run_issue_task(
        task: WorkflowTask, spec: WorkflowSpec, workflow_context: dict[str, Any]
    ) -> WorkflowTaskResult:
        issue = claimed_target(task, "issue", issues, selected_issue)
        if issue is None:
            return _skipped_workflow_result(task, "No synced issue is available.")
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
            {**safe_context, **agent_skill_context("issue_agent.analyze_issue")},
        )
        return WorkflowTaskResult(
            task_id=task.id,
            agent_name=task.agent_name,
            task_type=task.task_type,
            status="success",
            summary=f"Issue #{issue.number}: {result.get('conclusion')} / {result.get('priority')} / owner {result.get('suggested_owner')}.",
            output=with_skill_runtime(result, "issue_agent.analyze_issue"),
            evidence_count=len(result.get("evidence") or []),
            confidence=_safe_confidence(result.get("confidence"), 0.62),
            citations=[{"type": "issue", "id": str(issue.id), "title": issue.title}],
        )

    async def run_pr_task(
        task: WorkflowTask, spec: WorkflowSpec, workflow_context: dict[str, Any]
    ) -> WorkflowTaskResult:
        pull_request = claimed_target(task, "pull_request", prs, selected_pr)
        if pull_request is None:
            return _skipped_workflow_result(
                task, "No synced pull request is available."
            )
        ci_task = next(
            (item for item in spec.tasks if item.task_type == "ci_debug"), None
        )
        claimed_ci_run = (
            claimed_target(ci_task, "workflow_run", runs, selected_run)
            if ci_task
            else selected_run
        )
        pr_context = {
            **safe_context,
            **agent_skill_context("pr_review_agent.analyze_pr"),
            "repo_id": str(repo.id),
            "ci_summary": {
                "failed_runs": len(failed_runs),
                "latest_failed_run": claimed_ci_run.name
                if claimed_ci_run and claimed_ci_run.conclusion == "failure"
                else None,
            },
        }
        result = await PRReviewAgent().run(
            {
                "number": pull_request.number,
                "title": pull_request.title,
                "body": pull_request.body,
                "state": pull_request.state,
                "author": pull_request.author,
                "merged_at": pull_request.merged_at,
                "files": [
                    {
                        "filename": file.filename,
                        "status": file.status,
                        "additions": file.additions,
                        "deletions": file.deletions,
                        "patch": file.patch,
                    }
                    for file in pull_request.files
                ],
                "comments": [
                    {
                        "body": comment.body,
                        "path": comment.path,
                        "line": comment.line,
                        "author": comment.author,
                    }
                    for comment in pull_request.review_comments
                ],
            },
            pr_context,
        )
        return WorkflowTaskResult(
            task_id=task.id,
            agent_name=task.agent_name,
            task_type=task.task_type,
            status="success",
            summary=f"PR #{pull_request.number}: {result.get('merge_recommendation')} with {len(result.get('risk_points') or [])} risk points.",
            output=with_skill_runtime(result, "pr_review_agent.analyze_pr"),
            evidence_count=len(pull_request.files) + len(pull_request.review_comments),
            confidence=_safe_confidence(result.get("confidence"), 0.62),
            citations=[
                {
                    "type": "pull_request",
                    "id": str(pull_request.id),
                    "title": pull_request.title,
                }
            ],
        )

    async def run_ci_task(
        task: WorkflowTask, spec: WorkflowSpec, workflow_context: dict[str, Any]
    ) -> WorkflowTaskResult:
        workflow_run = claimed_target(task, "workflow_run", runs, selected_run)
        if workflow_run is None:
            return _skipped_workflow_result(task, "No synced CI run is available.")
        result = await CIDebugAgent().run(
            {
                "name": workflow_run.name,
                "status": workflow_run.status,
                "conclusion": workflow_run.conclusion,
                "jobs": workflow_run.jobs or [],
                "logs_text": workflow_run.logs_text,
            },
            {
                **safe_context,
                **agent_skill_context("ci_debug_agent.analyze_workflow_run"),
                "repo_id": str(repo.id),
            },
        )
        return WorkflowTaskResult(
            task_id=task.id,
            agent_name=task.agent_name,
            task_type=task.task_type,
            status="success",
            summary=f"CI {workflow_run.name}: {result.get('failure_type')}, merge blocking={result.get('is_merge_blocking')}.",
            output=with_skill_runtime(result, "ci_debug_agent.analyze_workflow_run"),
            evidence_count=len(workflow_run.jobs or [])
            + (1 if workflow_run.logs_text else 0),
            confidence=_safe_confidence(result.get("confidence"), 0.58),
            citations=[
                {
                    "type": "workflow_run",
                    "id": str(workflow_run.id),
                    "title": workflow_run.name,
                }
            ],
        )

    async def run_rag_task(
        task: WorkflowTask, spec: WorkflowSpec, workflow_context: dict[str, Any]
    ) -> WorkflowTaskResult:
        query = message or spec.goal
        answer, citations, results = _semantic_search(repo, query, safe_context, db)
        record_recall_event(
            db,
            repo_id=repo.id,
            conversation_id=uuid.UUID(str(context["conversation_id"]))
            if context.get("conversation_id")
            else None,
            tool_name="workflow.rag_search",
            query=query,
            results=results,
            citations=citations,
            scope="project",
            mode="hybrid",
            metadata={"route": "workflow_rag_task", "task_id": task.id},
        )
        return WorkflowTaskResult(
            task_id=task.id,
            agent_name=task.agent_name,
            task_type=task.task_type,
            status="success",
            summary=f"Retrieved {len(citations)} related historical records.",
            output={"answer": answer, "citations": citations},
            evidence_count=len(citations),
            confidence=0.68 if citations else 0.45,
            citations=citations,
        )

    async def run_safety_task(
        task: WorkflowTask, spec: WorkflowSpec, workflow_context: dict[str, Any]
    ) -> WorkflowTaskResult:
        action = _risky_action(message) or "write_back"
        draft, citations = _draft_for_action(
            action, message or spec.goal, repo, issues, prs, runs
        )
        result = await SafetyAgent().run(
            {"action": action, "draft": draft},
            {
                **safe_context,
                **agent_skill_context("safety_agent.classify_action_risk"),
            },
        )
        return WorkflowTaskResult(
            task_id=task.id,
            agent_name=task.agent_name,
            task_type=task.task_type,
            status="success",
            summary=f"Safety risk={result.get('risk_level')}, confirmation required={result.get('requires_confirmation')}.",
            output=with_skill_runtime(result, "safety_agent.classify_action_risk"),
            evidence_count=1,
            confidence=0.9,
            citations=citations,
        )

    return workflow_context, {
        "repo_health": run_repo_health,
        "issue_analysis": run_issue_task,
        "pr_review": run_pr_task,
        "ci_debug": run_ci_task,
        "rag_search": run_rag_task,
        "safety_review": run_safety_task,
    }


def _workflow_report_status(report: dict[str, Any]) -> str:
    metrics = report.get("metrics") or {}
    if int(metrics.get("error_count") or 0):
        return "error"
    findings = (report.get("observation") or {}).get("findings") or []
    if (
        int(metrics.get("model_fallback_count") or 0)
        or int(metrics.get("skipped_count") or 0)
        or any(item.get("severity") in {"warning", "blocker"} for item in findings)
    ):
        return "partial"
    return "success"


def _persist_engineering_workflow(
    db: Session,
    repo: Repository | None,
    conversation: Conversation | None,
    report: dict[str, Any],
) -> uuid.UUID:
    spec = report.get("spec") or {}
    task_by_id = {
        str(task.get("id")): task
        for task in spec.get("tasks", [])
        if isinstance(task, dict) and task.get("id")
    }
    workflow = AgentWorkflowRun(
        repo_id=repo.id if repo else None,
        conversation_id=conversation.id if conversation else None,
        goal=str(spec.get("goal") or ""),
        spec_json=spec,
        observation_json=report.get("observation") or {},
        final_answer=str(report.get("final_answer") or ""),
        metrics=report.get("metrics") or {},
        status=_workflow_report_status(report),
        completed_at=datetime.now(UTC),
    )
    db.add(workflow)
    db.flush()
    for result in report.get("task_results") or []:
        if not isinstance(result, dict):
            continue
        task_id = str(result.get("task_id") or "")
        task = task_by_id.get(task_id, {})
        db.add(
            AgentTaskRun(
                workflow_id=workflow.id,
                task_id=task_id,
                agent_name=str(result.get("agent_name") or ""),
                task_type=str(result.get("task_type") or ""),
                claim_json=task.get("claim")
                if isinstance(task.get("claim"), dict)
                else {},
                input_json={
                    "objective": task.get("objective"),
                    "dependencies": task.get("dependencies", []),
                },
                result_json=result,
                status=str(result.get("status") or "unknown"),
                error=result.get("error"),
            )
        )
    return workflow.id


def _engineering_workflow_response(
    repo: Repository, workflow_run_id: uuid.UUID, report: dict[str, Any]
) -> dict[str, Any]:
    return {
        "route": "engineering_workflow",
        "tool_calls": [
            {
                "tool_name": "workflow.run_engineering_review",
                "arguments": {
                    "repo_id": str(repo.id),
                    "workflow_run_id": str(workflow_run_id),
                },
                "status": _workflow_report_status(report),
            },
            *report.get("tool_calls", []),
        ],
        "answer": report.get("final_answer") or "",
        "citations": report.get("citations") or [],
        "agent_events": report.get("agent_events") or [],
    }


async def run_engineering_workflow_tool(
    ctx: ToolContext, input_data: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    if ctx.repo is None:
        return await repo_health_tool(ctx, input_data, context)

    params = EngineeringWorkflowParams.model_validate(input_data)
    message = (params.message or params.query).strip()
    workflow_context, task_runners = _build_engineering_workflow_runtime(
        ctx.repo, ctx.db, message, context
    )
    report = await WorkflowOrchestrator(task_runners).run(
        {"message": message or "Run an engineering workflow."}, workflow_context
    )
    workflow_run_id = _persist_engineering_workflow(
        ctx.db, ctx.repo, ctx.conversation, report
    )
    report["metrics"]["workflow_run_id"] = str(workflow_run_id)
    return _engineering_workflow_response(ctx.repo, workflow_run_id, report)
