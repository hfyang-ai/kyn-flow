"""日志查询接口：把散落在四张表里的运行记录统一成「时间倒序 + 分页」的只读视图。"""

from datetime import UTC, date, datetime, time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Query as OrmQuery
from sqlalchemy.orm import Session

from app.db.models import (
    AgentRun,
    AgentTaskRun,
    AgentWorkflowRun,
    AuditLog,
    ChatMessage,
    Repository,
    User,
)
from app.db.session import get_db
from app.schemas.logs import (
    AgentRunLog,
    AgentRunLogPage,
    AuditLogEntry,
    AuditLogPage,
    ChatMessageLog,
    ChatMessageLogPage,
    WorkflowRunLog,
    WorkflowRunLogPage,
    WorkflowTaskLog,
)
from app.services.permissions import has_permission, require_permission

router = APIRouter()

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
CONTENT_PREVIEW_CHARS = 2000
DATE_ONLY_LENGTH = 10


def _parse_bound(raw: str | None, *, end: bool) -> datetime | None:
    """接受 ``YYYY-MM-DD`` 或 ISO8601；纯日期按 UTC 当天 00:00 / 23:59:59.999999 处理。

    纯日期不带时区，因此按 UTC 日界解读；需要「按本地自然日」过滤时，
    由调用方传带偏移量的完整时刻（前端就是这么做的）。
    """
    if raw is None:
        return None
    value = raw.strip()
    if not value:
        return None
    if len(value) == DATE_ONLY_LENGTH:
        try:
            day: date = date.fromisoformat(value)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail=f"日期无法解析：{value}"
            ) from exc
        moment = time.max if end else time.min
        return datetime.combine(day, moment, tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"时间无法解析：{value}") from exc
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _window(
    query: OrmQuery, column, start_at: datetime | None, end_at: datetime | None
) -> OrmQuery:
    if start_at is not None:
        query = query.filter(column >= start_at)
    if end_at is not None:
        query = query.filter(column <= end_at)
    return query


def _repo_names(db: Session, repo_ids: set[UUID | None]) -> dict[UUID, str]:
    ids = [item for item in repo_ids if item is not None]
    if not ids:
        return {}
    rows = (
        db.query(Repository.id, Repository.full_name)
        .filter(Repository.id.in_(ids))
        .all()
    )
    return {row[0]: row[1] for row in rows}


def _duration_ms(start: datetime | None, end: datetime | None) -> int | None:
    if start is None or end is None:
        return None
    try:
        return max(0, int((end - start).total_seconds() * 1000))
    except TypeError:  # 混用 aware / naive（SQLite 历史数据）
        return None


def _truncate(text: str, limit: int = CONTENT_PREVIEW_CHARS) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return text[:limit], True


def _like(value: str) -> str:
    return f"%{value.strip()}%"


@router.get("/agent-runs", response_model=AgentRunLogPage)
async def list_agent_runs(
    start: str | None = Query(
        default=None, description="起始时间：YYYY-MM-DD 或 ISO8601"
    ),
    end: str | None = Query(
        default=None, description="结束时间：YYYY-MM-DD 或 ISO8601"
    ),
    repo_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    q: str | None = Query(
        default=None, description="在用户消息 / 最终回答 / 路由中搜索"
    ),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("repo:read")),
) -> AgentRunLogPage:
    start_at = _parse_bound(start, end=False)
    end_at = _parse_bound(end, end=True)
    query = _window(db.query(AgentRun), AgentRun.created_at, start_at, end_at)
    if repo_id is not None:
        query = query.filter(AgentRun.repo_id == repo_id)
    if status:
        query = query.filter(AgentRun.status == status)
    if q and q.strip():
        pattern = _like(q)
        query = query.filter(
            or_(
                AgentRun.user_message.ilike(pattern),
                AgentRun.final_answer.ilike(pattern),
                AgentRun.route.ilike(pattern),
            )
        )
    total = query.count()
    rows = query.order_by(AgentRun.created_at.desc()).offset(offset).limit(limit).all()
    names = _repo_names(db, {row.repo_id for row in rows})
    items = [
        AgentRunLog(
            id=row.id,
            repo_id=row.repo_id,
            repo_name=names.get(row.repo_id) if row.repo_id else None,
            conversation_id=row.conversation_id,
            user_message=row.user_message,
            route=row.route,
            status=row.status,
            tool_call_count=len(row.tool_calls or []),
            tool_calls=row.tool_calls or [],
            final_answer=row.final_answer,
            created_at=row.created_at,
        )
        for row in rows
    ]
    return AgentRunLogPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        start=start_at,
        end=end_at,
    )


@router.get("/chat-messages", response_model=ChatMessageLogPage)
async def list_chat_messages(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    repo_id: UUID | None = Query(default=None),
    role: str | None = Query(default=None),
    q: str | None = Query(default=None, description="在消息正文中搜索"),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("repo:read")),
) -> ChatMessageLogPage:
    start_at = _parse_bound(start, end=False)
    end_at = _parse_bound(end, end=True)
    query = _window(db.query(ChatMessage), ChatMessage.created_at, start_at, end_at)
    if repo_id is not None:
        query = query.filter(ChatMessage.repo_id == repo_id)
    if role:
        query = query.filter(ChatMessage.role == role)
    if q and q.strip():
        query = query.filter(ChatMessage.content.ilike(_like(q)))
    total = query.count()
    rows = (
        query.order_by(ChatMessage.created_at.desc()).offset(offset).limit(limit).all()
    )
    names = _repo_names(db, {row.repo_id for row in rows})
    items = []
    for row in rows:
        content, truncated = _truncate(row.content or "")
        items.append(
            ChatMessageLog(
                id=row.id,
                repo_id=row.repo_id,
                repo_name=names.get(row.repo_id) if row.repo_id else None,
                conversation_id=row.conversation_id,
                role=row.role,
                route=row.route,
                content=content,
                content_length=len(row.content or ""),
                content_truncated=truncated,
                tool_call_count=len(row.tool_calls or []),
                meta=row.meta or {},
                created_at=row.created_at,
            )
        )
    return ChatMessageLogPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        start=start_at,
        end=end_at,
    )


@router.get("/audit-logs", response_model=AuditLogPage)
async def list_audit_log_entries(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    repo_id: UUID | None = Query(default=None),
    action: str | None = Query(default=None),
    status: str | None = Query(default=None),
    q: str | None = Query(default=None, description="在动作名 / 目标 ID 中搜索"),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("settings:manage")),
) -> AuditLogPage:
    start_at = _parse_bound(start, end=False)
    end_at = _parse_bound(end, end=True)
    query = _window(db.query(AuditLog), AuditLog.created_at, start_at, end_at)
    if repo_id is not None:
        query = query.filter(AuditLog.repo_id == repo_id)
    if action:
        query = query.filter(AuditLog.action == action)
    if status:
        query = query.filter(AuditLog.status == status)
    if q and q.strip():
        pattern = _like(q)
        query = query.filter(
            or_(AuditLog.action.ilike(pattern), AuditLog.target_id.ilike(pattern))
        )
    total = query.count()
    rows = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()
    names = _repo_names(db, {row.repo_id for row in rows})
    items = [
        AuditLogEntry(
            id=row.id,
            user_id=row.user_id,
            repo_id=row.repo_id,
            repo_name=names.get(row.repo_id) if row.repo_id else None,
            action=row.action,
            target_type=row.target_type,
            target_id=row.target_id,
            status=row.status,
            request_json=row.request_json or {},
            result_json=row.result_json or {},
            created_at=row.created_at,
        )
        for row in rows
    ]
    return AuditLogPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        start=start_at,
        end=end_at,
    )


@router.get("/workflows", response_model=WorkflowRunLogPage)
async def list_workflow_logs(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    repo_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    q: str | None = Query(default=None, description="在目标 / 最终结论中搜索"),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission("repo:read")),
) -> WorkflowRunLogPage:
    start_at = _parse_bound(start, end=False)
    end_at = _parse_bound(end, end=True)
    query = _window(
        db.query(AgentWorkflowRun), AgentWorkflowRun.created_at, start_at, end_at
    )
    if repo_id is not None:
        query = query.filter(AgentWorkflowRun.repo_id == repo_id)
    if status:
        query = query.filter(AgentWorkflowRun.status == status)
    if q and q.strip():
        pattern = _like(q)
        query = query.filter(
            or_(
                AgentWorkflowRun.goal.ilike(pattern),
                AgentWorkflowRun.final_answer.ilike(pattern),
            )
        )
    total = query.count()
    rows = (
        query.order_by(AgentWorkflowRun.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    names = _repo_names(db, {row.repo_id for row in rows})
    tasks_by_workflow: dict[UUID, list[AgentTaskRun]] = {row.id: [] for row in rows}
    if rows:
        task_rows = (
            db.query(AgentTaskRun)
            .filter(AgentTaskRun.workflow_id.in_(list(tasks_by_workflow)))
            .order_by(AgentTaskRun.started_at.asc(), AgentTaskRun.task_id.asc())
            .all()
        )
        for task in task_rows:
            tasks_by_workflow.setdefault(task.workflow_id, []).append(task)
    items = [
        WorkflowRunLog(
            id=row.id,
            repo_id=row.repo_id,
            repo_name=names.get(row.repo_id) if row.repo_id else None,
            conversation_id=row.conversation_id,
            goal=row.goal,
            status=row.status,
            spec=row.spec_json or {},
            observation=row.observation_json or {},
            metrics=row.metrics or {},
            final_answer=row.final_answer or "",
            created_at=row.created_at,
            completed_at=row.completed_at,
            duration_ms=_duration_ms(row.created_at, row.completed_at),
            tasks=[
                WorkflowTaskLog(
                    id=task.id,
                    task_id=task.task_id,
                    agent_name=task.agent_name,
                    task_type=task.task_type,
                    status=task.status,
                    error=task.error,
                    started_at=task.started_at,
                    completed_at=task.completed_at,
                    duration_ms=_duration_ms(task.started_at, task.completed_at),
                    claim=task.claim_json or {},
                    input=task.input_json or {},
                    result=task.result_json or {},
                )
                for task in tasks_by_workflow.get(row.id, [])
            ],
        )
        for row in rows
    ]
    return WorkflowRunLogPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        start=start_at,
        end=end_at,
    )


@router.get("/summary")
async def log_summary(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    repo_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("repo:read")),
) -> dict[str, int | str | None]:
    """四个 tab 的条数总览，用于左侧导航显示计数。"""
    start_at = _parse_bound(start, end=False)
    end_at = _parse_bound(end, end=True)

    def count(model, column) -> int:
        query = _window(db.query(model), column, start_at, end_at)
        if repo_id is not None:
            query = query.filter(model.repo_id == repo_id)
        return query.count()

    return {
        "agent_runs": count(AgentRun, AgentRun.created_at),
        "chat_messages": count(ChatMessage, ChatMessage.created_at),
        "audit_logs": count(AuditLog, AuditLog.created_at)
        if has_permission(user, "settings:manage")
        else 0,
        "workflows": count(AgentWorkflowRun, AgentWorkflowRun.created_at),
        "start": start_at.isoformat() if start_at else None,
        "end": end_at.isoformat() if end_at else None,
    }
