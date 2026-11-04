from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class LogPageBase(BaseModel):
    """四条日志共用的分页外壳：按「时间倒序 + 分页」返回，并回显生效的时间窗口。"""

    total: int
    limit: int
    offset: int
    start: datetime | None = None
    end: datetime | None = None


class AgentRunLog(BaseModel):
    id: UUID
    repo_id: UUID | None = None
    repo_name: str | None = None
    conversation_id: UUID | None = None
    user_message: str
    route: str
    status: str
    tool_call_count: int = 0
    tool_calls: list[dict] = Field(default_factory=list)
    final_answer: str
    created_at: datetime


class AgentRunLogPage(LogPageBase):
    items: list[AgentRunLog] = Field(default_factory=list)


class ChatMessageLog(BaseModel):
    id: UUID
    repo_id: UUID | None = None
    repo_name: str | None = None
    conversation_id: UUID | None = None
    role: str
    route: str | None = None
    content: str
    content_length: int = 0
    content_truncated: bool = False
    tool_call_count: int = 0
    meta: dict = Field(default_factory=dict)
    created_at: datetime


class ChatMessageLogPage(LogPageBase):
    items: list[ChatMessageLog] = Field(default_factory=list)


class AuditLogEntry(BaseModel):
    id: UUID
    user_id: UUID | None = None
    repo_id: UUID | None = None
    repo_name: str | None = None
    action: str
    target_type: str | None = None
    target_id: str | None = None
    status: str
    request_json: dict = Field(default_factory=dict)
    result_json: dict = Field(default_factory=dict)
    created_at: datetime


class AuditLogPage(LogPageBase):
    items: list[AuditLogEntry] = Field(default_factory=list)


class WorkflowTaskLog(BaseModel):
    id: UUID
    task_id: str
    agent_name: str
    task_type: str
    status: str
    error: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = None
    claim: dict = Field(default_factory=dict)
    input: dict = Field(default_factory=dict)
    result: dict = Field(default_factory=dict)


class WorkflowRunLog(BaseModel):
    id: UUID
    repo_id: UUID | None = None
    repo_name: str | None = None
    conversation_id: UUID | None = None
    goal: str
    status: str
    spec: dict = Field(default_factory=dict)
    observation: dict = Field(default_factory=dict)
    metrics: dict = Field(default_factory=dict)
    final_answer: str = ""
    created_at: datetime
    completed_at: datetime | None = None
    duration_ms: int | None = None
    tasks: list[WorkflowTaskLog] = Field(default_factory=list)


class WorkflowRunLogPage(LogPageBase):
    items: list[WorkflowRunLog] = Field(default_factory=list)
