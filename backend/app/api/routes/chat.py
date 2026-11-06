import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.models import (
    AgentRun,
    AgentTaskRun,
    AgentWorkflowRun,
    ChatMessage,
    Issue,
    PullRequest,
    Repository,
    WorkflowRun,
)
from app.db.session import get_db
from app.schemas.chat import (
    ChatHistoryMessage,
    ChatPlanExecuteRequest,
    ChatRequest,
    ChatResponse,
    PromptRecommendationRequest,
    PromptRecommendationResponse,
)
from app.schemas.workflow import WorkflowSpec
from app.services.agents.chat_agent import ChatAgent, encode_sse
from app.services.agents.planner_agent import PlannerAgent
from app.services.agents.recommendation_agent import RecommendationAgent
from app.services.agents.workflow_models import execution_label
from app.services.agents.workflow_orchestrator import WorkflowOrchestrator
from app.services.chat_memory import (
    ContextAssembler,
    EvidenceStore,
    MessageStore,
    ProgressiveContextManager,
    SessionSealer,
)
from app.services.conversations import ensure_conversation, touch_conversation
from app.services.skills import get_skill_registry
from app.tools import build_conversation_tools as _build_conversation_tools
from app.tools.engineering_workflow import (
    WorkflowTargetResolutionError,
    _build_engineering_workflow_runtime,
    _engineering_workflow_response,
    _persist_engineering_workflow,
)
from app.tools.helpers import _repo_payload
from app.tools.workspace import _repo_checkout_path  # noqa: F401  (re-export for tests)

router = APIRouter()


@router.get("/workflow-runs")
async def list_workflow_runs(
    repo_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    query = db.query(AgentWorkflowRun)
    if repo_id is not None:
        query = query.filter(AgentWorkflowRun.repo_id == repo_id)
    rows = query.order_by(AgentWorkflowRun.created_at.desc()).limit(limit).all()
    workflow_ids = [row.id for row in rows]
    tasks = (
        db.query(AgentTaskRun)
        .filter(AgentTaskRun.workflow_id.in_(workflow_ids))
        .order_by(AgentTaskRun.started_at.asc(), AgentTaskRun.task_id.asc())
        .all()
        if workflow_ids
        else []
    )
    tasks_by_workflow: dict[uuid.UUID, list[AgentTaskRun]] = {}
    for task in tasks:
        tasks_by_workflow.setdefault(task.workflow_id, []).append(task)
    return [
        {
            "id": str(row.id),
            "repo_id": str(row.repo_id) if row.repo_id else None,
            "conversation_id": str(row.conversation_id)
            if row.conversation_id
            else None,
            "goal": row.goal,
            "status": row.status,
            "spec": row.spec_json or {},
            "observation": row.observation_json or {},
            "final_answer": row.final_answer,
            "metrics": row.metrics or {},
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
            "tasks": [
                {
                    "id": str(task.id),
                    "task_id": task.task_id,
                    "agent_name": task.agent_name,
                    "task_type": task.task_type,
                    "status": task.status,
                    "summary": str((task.result_json or {}).get("summary") or ""),
                    "error": task.error,
                    "started_at": task.started_at.isoformat()
                    if task.started_at
                    else None,
                    "completed_at": task.completed_at.isoformat()
                    if task.completed_at
                    else None,
                }
                for task in tasks_by_workflow.get(row.id, [])
            ],
        }
        for row in rows
    ]


@router.get("/history", response_model=list[ChatHistoryMessage])
async def chat_history(
    repo_id: uuid.UUID = Query(...),
    conversation_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    before_message_id: uuid.UUID | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    _repo_or_404(db, repo_id)
    conversation = ensure_conversation(db, repo_id, conversation_id)
    conversation_id = conversation.id
    db.commit()
    rows = [
        item
        for item in MessageStore(db).timeline(
            repo_id,
            conversation_id,
            limit=limit,
            before_message_id=before_message_id,
        )
        if item.role in {"user", "assistant"}
    ]
    return [
        {
            "id": str(item.id),
            "conversation_id": str(item.conversation_id)
            if item.conversation_id
            else None,
            "role": item.role,
            "content": item.content,
            "route": item.route,
            "tool_calls": item.tool_calls or [],
            "agent_events": (item.meta or {}).get("agent_events", []),
            "compression_stats": (item.meta or {}).get("compression_stats", {}),
            "progressive_compaction": (item.meta or {}).get(
                "progressive_compaction", {}
            ),
            "model_usage": (item.meta or {}).get("model_usage", []),
            "context_diagnostics": (item.meta or {}).get("context_diagnostics", {}),
            "created_at": item.created_at.isoformat() if item.created_at else None,
        }
        for item in rows
    ]


def _repo_or_404(db: Session, repo_id: uuid.UUID) -> Repository:
    repo = db.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="未找到指定仓库。")
    return repo


def _client_context(value: dict[str, Any] | None) -> dict[str, Any]:
    server_owned = {
        "repo_id",
        "conversation_id",
        "tools",
        "server_context",
        "server_messages",
        "evidence",
        "compression_stats",
        "progressive_compaction",
        "registered_skills",
        "skill_description_by_tool",
    }

    return {key: item for key, item in (value or {}).items() if key not in server_owned}


def _recommendation_payload(
    repo: Repository | None,
    issues: list[Issue],
    prs: list[PullRequest],
    runs: list[WorkflowRun],
    exclude: list[str],
    limit: int,
) -> dict[str, Any]:
    return {
        "repo": {"id": str(repo.id), "full_name": repo.full_name} if repo else None,
        "issues": [
            {
                "id": str(item.id),
                "number": item.number,
                "title": item.title,
                "state": item.state,
                "labels": item.labels or [],
                "assignees": item.assignees or [],
                "created_at": item.created_at,
                "updated_at": item.updated_at,
                "closed_at": item.closed_at,
            }
            for item in issues
        ],
        "pull_requests": [
            {
                "id": str(item.id),
                "number": item.number,
                "title": item.title,
                "state": item.state,
                "author": item.author,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
                "merged_at": item.merged_at,
            }
            for item in prs
        ],
        "workflow_runs": [
            {
                "id": str(item.id),
                "name": item.name,
                "status": item.status,
                "conclusion": item.conclusion,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
            }
            for item in runs
        ],
        "exclude": exclude,
        "limit": limit,
    }


def _skill_runtime_context() -> dict[str, Any]:
    registry = get_skill_registry()
    return {
        "_skill_registry": registry,
        "registered_skills": registry.prompt_context(),
        "skill_trace_by_tool": registry.trace_metadata_by_tool(),
        "skill_description_by_tool": registry.tool_description_suffixes(),
    }


def _workflow_plan_answer(spec: WorkflowSpec) -> str:
    lines = [
        "已创建执行计划，确认后我会按这个 WorkflowSpec 执行。",
        "",
        f"目标：{spec.goal}",
        f"规划来源：{execution_label(spec.planning)}",
        "",
        "任务：",
    ]
    for index, task in enumerate(spec.tasks, start=1):
        deps = f"；依赖：{', '.join(task.dependencies)}" if task.dependencies else ""
        critical = "；关键任务" if task.critical else ""
        lines.append(
            f"{index}. {task.agent_name} / {task.task_type}: {task.objective}{deps}{critical}"
        )
    if spec.acceptance_criteria:
        lines.extend(["", "验收标准："])
        lines.extend(f"- {item}" for item in spec.acceptance_criteria)
    return "\n".join(lines)


async def _conversation_plan(payload: ChatRequest, db: Session) -> dict[str, Any]:
    repo = _repo_or_404(db, payload.repo_id)
    conversation = ensure_conversation(db, repo.id, payload.conversation_id)
    db.commit()
    context = {
        **_client_context(payload.context),
        **_skill_runtime_context(),
        "repo_id": str(repo.id),
        "conversation_id": str(conversation.id),
    }
    workflow_context, _task_runners = _build_engineering_workflow_runtime(
        repo, db, payload.message, context
    )
    spec_data = await PlannerAgent().run({"message": payload.message}, workflow_context)
    spec = WorkflowSpec.model_validate(spec_data)
    spec_json = spec.model_dump(mode="json")
    return {
        "route": "engineering_plan",
        "conversation_id": str(conversation.id),
        "answer": _workflow_plan_answer(spec),
        "plan": spec_json,
        "tool_calls": [
            {
                "tool_name": "planner_agent.create_workflow_spec",
                "arguments": {"repo_id": str(repo.id), "workflow_id": spec.workflow_id},
                "status": "success",
            }
        ],
        "agent_events": [
            {
                "type": "workflow_spec",
                "workflow_id": spec.workflow_id,
                "goal": spec.goal,
                "planning": spec.planning.model_dump(mode="json")
                if spec.planning
                else None,
                "tasks": [
                    {
                        "id": task.id,
                        "agent_name": task.agent_name,
                        "task_type": task.task_type,
                        "dependencies": task.dependencies,
                        "claim": task.claim.model_dump(mode="json"),
                    }
                    for task in spec.tasks
                ],
            }
        ],
    }


def _workflow_execution_trace_events(
    report: dict[str, Any], workflow_tool_id: str
) -> list[dict[str, Any]]:
    events = [
        {
            "event": "tool_result",
            "data": {
                "tool_use_id": workflow_tool_id,
                "tool_name": "workflow.run_engineering_review",
                "status": "success",
                "route": "engineering_workflow",
                "content": {
                    "answer_preview": "Confirmed plan executed.",
                    "citations_count": len(report.get("citations") or []),
                },
            },
        }
    ]
    for item in report.get("agent_events") or []:
        if not isinstance(item, dict):
            continue
        event_type = item.get("type")
        if event_type == "workflow_task_result":
            events.append(
                {
                    "event": "tool_result",
                    "data": {
                        "tool_use_id": f"{item.get('workflow_id')}_{item.get('task_id')}",
                        "tool_name": f"workflow.{item.get('task_type')}",
                        "status": item.get("status") or "success",
                        "route": "engineering_workflow",
                        "content": {
                            "answer_preview": item.get("summary") or "",
                            "citations_count": item.get("evidence_count") or 0,
                        },
                    },
                }
            )
        elif event_type == "workflow_replan":
            events.append(
                {
                    "event": "tool_result",
                    "data": {
                        "tool_use_id": f"{item.get('workflow_id')}_replan_{item.get('iteration')}",
                        "tool_name": "planner_agent.replan_workflow_spec",
                        "status": "success",
                        "route": "engineering_workflow",
                        "content": {
                            "answer_preview": (
                                f"Replan #{item.get('iteration')}: {item.get('reason')}; "
                                f"added tasks={', '.join(str(task) for task in item.get('added_tasks') or []) or 'none'}"
                            ),
                            "citations_count": 0,
                        },
                    },
                }
            )
        elif event_type == "workflow_observer_result":
            events.append(
                {
                    "event": "tool_result",
                    "data": {
                        "tool_use_id": f"{item.get('workflow_id')}_observer",
                        "tool_name": "workflow.observer",
                        "status": "success",
                        "route": "engineering_workflow",
                        "content": {
                            "answer_preview": f"Observer confidence={item.get('overall_confidence')}, findings={len(item.get('findings') or [])}",
                            "citations_count": 0,
                        },
                    },
                }
            )
    return events


async def _conversation_plan_execute_sse(payload: ChatPlanExecuteRequest, db: Session):
    repo = _repo_or_404(db, payload.repo_id)

    conversation = ensure_conversation(db, repo.id, payload.conversation_id)
    if conversation:
        db.commit()
    compaction_stats = await ProgressiveContextManager(db).ensure_headroom(
        repo, conversation, payload.message
    )
    if compaction_stats.get("attempted"):
        db.commit()
    message_store = MessageStore(db)
    user_message = message_store.append(
        repo_id=repo.id,
        conversation_id=conversation.id,
        role="user",
        content=payload.message,
    )
    EvidenceStore(db).rebuild_repo(repo, conversation)
    db.commit()
    assembled = ContextAssembler(db).assemble(repo, conversation, payload.message)
    context = {
        **_client_context(payload.context),
        **_skill_runtime_context(),
        "repo_id": str(repo.id),
        "conversation_id": str(conversation.id),
        "server_context": assembled.system_context,
        "server_messages": assembled.history_messages,
        "evidence": assembled.evidence,
        "compression_stats": assembled.compression_stats,
        "progressive_compaction": compaction_stats,
    }
    workflow_tool_id = (
        f"confirmed_{payload.workflow_spec.get('workflow_id') or uuid.uuid4().hex[:8]}"
    )
    try:
        spec = WorkflowSpec.model_validate(payload.workflow_spec)
        yield encode_sse(
            {
                "event": "tool_use",
                "data": {
                    "id": workflow_tool_id,
                    "tool_name": "workflow.run_engineering_review",
                    "arguments": {
                        "repo_id": str(repo.id),
                        "workflow_id": spec.workflow_id,
                        "confirmed_plan": True,
                    },
                },
            }
        )
        workflow_context, task_runners = _build_engineering_workflow_runtime(
            repo, db, payload.message, context
        )
        report = await WorkflowOrchestrator(task_runners).run_spec(
            spec, workflow_context
        )
        workflow_run_id = _persist_engineering_workflow(db, repo, conversation, report)
        report["metrics"]["workflow_run_id"] = str(workflow_run_id)
        for event in _workflow_execution_trace_events(report, workflow_tool_id):
            yield encode_sse(event)

        result = _engineering_workflow_response(repo, workflow_run_id, report)
        run_id = uuid.uuid4()
        result["run_id"] = str(run_id)
        result["compression_stats"] = assembled.compression_stats
        result["progressive_compaction"] = compaction_stats
        for index in range(0, len(result["answer"]), 48):
            yield encode_sse(
                {
                    "event": "delta",
                    "data": {"content": result["answer"][index : index + 48]},
                }
            )

        assistant_message = message_store.append(
            repo_id=repo.id,
            conversation_id=conversation.id,
            role="assistant",
            content=result["answer"],
            route=result["route"],
            tool_calls=result["tool_calls"],
            meta={
                "run_id": str(run_id),
                "agent_events": result.get("agent_events", []),
                "model_usage": result.get("model_usage", []),
                "context_diagnostics": result.get("context_diagnostics", {}),
                "compression_stats": assembled.compression_stats,
                "progressive_compaction": compaction_stats,
            },
        )
        result["message_id"] = str(assistant_message.id)
        db.add(
            AgentRun(
                id=run_id,
                repo_id=repo.id,
                conversation_id=conversation.id,
                user_message=payload.message,
                route=result["route"],
                tool_calls=result["tool_calls"],
                final_answer=result["answer"],
                status="success",
            )
        )
        touch_conversation(db, conversation, user_message=payload.message, increment=2)
        await SessionSealer(db).seal(
            repo=repo,
            conversation=conversation,
            user_message=user_message,
            assistant_message=assistant_message,
            route=result["route"],
            tool_calls=result["tool_calls"],
            agent_events=result.get("agent_events", []),
            model_usage=result.get("model_usage", []),
            context_diagnostics=result.get("context_diagnostics", {}),
        )
        db.commit()
        yield encode_sse({"event": "final", "data": result})
    except Exception as exc:
        db.rollback()
        run_id = uuid.uuid4()
        answer = f"执行计划失败：{exc}"
        assistant_message = message_store.append(
            repo_id=repo.id,
            conversation_id=conversation.id,
            role="assistant",
            content=answer,
            route="error",
            tool_calls=[],
            meta={"run_id": str(run_id), "error": str(exc)},
        )
        db.add(
            AgentRun(
                id=run_id,
                repo_id=repo.id,
                conversation_id=conversation.id,
                user_message=payload.message,
                route="error",
                tool_calls=[],
                final_answer=answer,
                status="error",
            )
        )
        touch_conversation(db, conversation, user_message=payload.message, increment=2)
        await SessionSealer(db).seal(
            repo=repo,
            conversation=conversation,
            user_message=user_message,
            assistant_message=assistant_message,
            route="error",
            tool_calls=[],
            agent_events=[],
        )
        db.commit()
        yield encode_sse(
            {
                "event": "final",
                "data": {
                    "run_id": str(run_id),
                    "message_id": str(assistant_message.id),
                    "route": "error",
                    "tool_calls": [],
                    "answer": answer,
                    "citations": [],
                    "agent_events": [],
                },
            }
        )


async def _conversation_response(payload: ChatRequest, db: Session) -> dict[str, Any]:
    repo = _repo_or_404(db, payload.repo_id)
    conversation = ensure_conversation(db, repo.id, payload.conversation_id)
    db.commit()
    compaction_stats = await ProgressiveContextManager(db).ensure_headroom(
        repo, conversation, payload.message
    )
    if compaction_stats.get("attempted"):
        db.commit()
    message_store = MessageStore(db)
    user_message = message_store.append(
        repo_id=repo.id,
        conversation_id=conversation.id,
        role="user",
        content=payload.message,
    )
    EvidenceStore(db).rebuild_repo(repo, conversation)
    db.commit()
    assembled = ContextAssembler(db).assemble(repo, conversation, payload.message)
    context = {
        **_client_context(payload.context),
        **_skill_runtime_context(),
        "repo_id": str(repo.id),
        "conversation_id": str(conversation.id),
        "server_context": assembled.system_context,
        "server_messages": assembled.history_messages,
        "evidence": assembled.evidence,
        "compression_stats": assembled.compression_stats,
        "progressive_compaction": compaction_stats,
    }
    context["tools"] = _build_conversation_tools(repo, conversation, db)
    result = await ChatAgent().run({"message": payload.message}, context)
    run_id = uuid.uuid4()
    result["run_id"] = str(run_id)
    result["compression_stats"] = assembled.compression_stats
    result["progressive_compaction"] = compaction_stats
    assistant_message: ChatMessage | None = None
    assistant_message = message_store.append(
        repo_id=repo.id,
        conversation_id=conversation.id,
        role="assistant",
        content=result["answer"],
        route=result["route"],
        tool_calls=result["tool_calls"],
        meta={
            "run_id": str(run_id),
            "agent_events": result.get("agent_events", []),
            "model_usage": result.get("model_usage", []),
            "context_diagnostics": result.get("context_diagnostics", {}),
            "compression_stats": assembled.compression_stats,
            "progressive_compaction": compaction_stats,
        },
    )
    result["message_id"] = str(assistant_message.id)
    db.add(
        AgentRun(
            id=run_id,
            repo_id=repo.id,
            conversation_id=conversation.id,
            user_message=payload.message,
            route=result["route"],
            tool_calls=result["tool_calls"],
            final_answer=result["answer"],
            status="success",
        )
    )
    touch_conversation(db, conversation, user_message=payload.message, increment=2)
    await SessionSealer(db).seal(
        repo=repo,
        conversation=conversation,
        user_message=user_message,
        assistant_message=assistant_message,
        route=result["route"],
        tool_calls=result["tool_calls"],
        agent_events=result.get("agent_events", []),
        model_usage=result.get("model_usage", []),
        context_diagnostics=result.get("context_diagnostics", {}),
    )
    db.commit()
    return result


async def _conversation_sse(payload: ChatRequest, db: Session):
    repo = _repo_or_404(db, payload.repo_id)
    conversation = ensure_conversation(db, repo.id, payload.conversation_id)
    db.commit()
    compaction_stats = await ProgressiveContextManager(db).ensure_headroom(
        repo, conversation, payload.message
    )
    if compaction_stats.get("attempted"):
        db.commit()
    message_store = MessageStore(db)
    user_message = message_store.append(
        repo_id=repo.id,
        conversation_id=conversation.id,
        role="user",
        content=payload.message,
    )
    EvidenceStore(db).rebuild_repo(repo, conversation)
    db.commit()
    assembled = ContextAssembler(db).assemble(repo, conversation, payload.message)
    context = {
        **_client_context(payload.context),
        **_skill_runtime_context(),
        "repo_id": str(repo.id),
        "conversation_id": str(conversation.id),
        "server_context": assembled.system_context,
        "server_messages": assembled.history_messages,
        "evidence": assembled.evidence,
        "compression_stats": assembled.compression_stats,
        "progressive_compaction": compaction_stats,
    }
    context["tools"] = _build_conversation_tools(repo, conversation, db)
    try:
        async for event in ChatAgent().run_stream(
            {"message": payload.message}, context
        ):
            if event["event"] == "final":
                run_id = uuid.uuid4()
                event["data"]["run_id"] = str(run_id)
                event["data"]["compression_stats"] = assembled.compression_stats
                event["data"]["progressive_compaction"] = compaction_stats
                assistant_message = message_store.append(
                    repo_id=repo.id,
                    conversation_id=conversation.id,
                    role="assistant",
                    content=event["data"]["answer"],
                    route=event["data"]["route"],
                    tool_calls=event["data"]["tool_calls"],
                    meta={
                        "run_id": str(run_id),
                        "agent_events": event["data"].get("agent_events", []),
                        "model_usage": event["data"].get("model_usage", []),
                        "context_diagnostics": event["data"].get(
                            "context_diagnostics", {}
                        ),
                        "compression_stats": assembled.compression_stats,
                        "progressive_compaction": compaction_stats,
                    },
                )
                event["data"]["message_id"] = str(assistant_message.id)
                db.add(
                    AgentRun(
                        id=run_id,
                        repo_id=repo.id,
                        conversation_id=conversation.id,
                        user_message=payload.message,
                        route=event["data"]["route"],
                        tool_calls=event["data"]["tool_calls"],
                        final_answer=event["data"]["answer"],
                        status="success",
                    )
                )
                touch_conversation(
                    db, conversation, user_message=payload.message, increment=2
                )
                await SessionSealer(db).seal(
                    repo=repo,
                    conversation=conversation,
                    user_message=user_message,
                    assistant_message=assistant_message,
                    route=event["data"]["route"],
                    tool_calls=event["data"]["tool_calls"],
                    agent_events=event["data"].get("agent_events", []),
                    model_usage=event["data"].get("model_usage", []),
                    context_diagnostics=event["data"].get("context_diagnostics", {}),
                )
                db.commit()
            yield encode_sse(event)
    except Exception as exc:
        db.rollback()
        run_id = uuid.uuid4()
        answer = f"请求失败：{exc}"
        failed_event = {
            "event": "final",
            "data": {
                "run_id": str(run_id),
                "route": "error",
                "tool_calls": [],
                "answer": answer,
                "citations": [],
            },
        }
        assistant_message = message_store.append(
            repo_id=repo.id,
            conversation_id=conversation.id,
            role="assistant",
            content=answer,
            route="error",
            tool_calls=[],
            meta={"run_id": str(run_id), "error": str(exc)},
        )
        failed_event["data"]["message_id"] = str(assistant_message.id)
        db.add(
            AgentRun(
                id=run_id,
                repo_id=repo.id,
                conversation_id=conversation.id,
                user_message=payload.message,
                route="error",
                tool_calls=[],
                final_answer=answer,
                status="error",
            )
        )
        touch_conversation(db, conversation, user_message=payload.message, increment=2)
        await SessionSealer(db).seal(
            repo=repo,
            conversation=conversation,
            user_message=user_message,
            assistant_message=assistant_message,
            route="error",
            tool_calls=[],
            agent_events=[],
        )
        db.commit()
        yield encode_sse(failed_event)


@router.post("/plan")
async def chat_plan(
    payload: ChatRequest, db: Session = Depends(get_db)
) -> dict[str, Any]:
    try:
        return await _conversation_plan(payload, db)
    except WorkflowTargetResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/plan/execute/stream")
async def chat_plan_execute_stream(
    payload: ChatPlanExecuteRequest, db: Session = Depends(get_db)
) -> StreamingResponse:
    return StreamingResponse(
        _conversation_plan_execute_sse(payload, db), media_type="text/event-stream"
    )


@router.post("", response_model=ChatResponse)
async def chat(payload: ChatRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    return await _conversation_response(payload, db)


@router.post("/stream")
async def chat_stream(
    payload: ChatRequest, db: Session = Depends(get_db)
) -> StreamingResponse:
    return StreamingResponse(
        _conversation_sse(payload, db), media_type="text/event-stream"
    )


@router.post("/recommendations", response_model=PromptRecommendationResponse)
async def prompt_recommendations(
    payload: PromptRecommendationRequest, db: Session = Depends(get_db)
) -> dict[str, Any]:
    repo = _repo_or_404(db, payload.repo_id)
    issues, prs, runs = _repo_payload(repo.id, db)
    result = await RecommendationAgent().run(
        _recommendation_payload(
            repo, issues, prs, runs, payload.exclude, payload.limit
        ),
        {"repo_id": str(repo.id)},
    )
    return {
        "agent": result["agent"],
        "suggestions": result["suggestions"],
    }
