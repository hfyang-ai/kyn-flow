"""日志查询接口：四个表的过滤、分页、权限与日期边界。"""

import os
from datetime import UTC, datetime, timedelta

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes import logs as log_routes
from app.db.models import (
    AgentRun,
    AgentTaskRun,
    AgentWorkflowRun,
    AuditLog,
    Base,
    ChatMessage,
    Repository,
    User,
)
from app.db.session import get_db

BASE_TIME = datetime(2026, 11, 2, 9, 0, tzinfo=UTC)


@pytest.fixture
def log_env():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = Session(engine)
    owner = User(name="demo-owner", role="owner")
    repo = Repository(
        owner="kynflow",
        name="log-demo",
        full_name="kynflow/log-demo",
        provider="github",
    )
    db.add_all([owner, repo])
    db.flush()

    db.add_all(
        [
            AgentRun(
                repo_id=repo.id,
                user_message="这个 PR 为什么卡住",
                route="pr_review",
                tool_calls=[{"name": "get_pr"}, {"name": "get_diff"}],
                final_answer="等待 CI 通过",
                status="success",
                created_at=BASE_TIME,
            ),
            AgentRun(
                repo_id=repo.id,
                user_message="总结今天的 CI 失败",
                route="ci_debug",
                tool_calls=[],
                final_answer="两个 job 超时",
                status="failed",
                created_at=BASE_TIME + timedelta(days=1),
            ),
            AgentRun(
                repo_id=None,
                user_message="无仓库的对话",
                route="chat",
                tool_calls=[],
                final_answer="ok",
                status="success",
                created_at=BASE_TIME + timedelta(days=2),
            ),
            ChatMessage(
                repo_id=repo.id,
                role="assistant",
                content="答" * 2500,
                route="chat",
                tool_calls=[],
                meta={"tokens": {"prompt": 1200, "completion": 300}},
                created_at=BASE_TIME,
            ),
            ChatMessage(
                repo_id=repo.id,
                role="user",
                content="短消息",
                tool_calls=[],
                meta={},
                created_at=BASE_TIME + timedelta(days=1),
            ),
            AuditLog(
                user_id=owner.id,
                repo_id=repo.id,
                action="action_draft.confirm",
                target_type="issue",
                target_id="42",
                status="success",
                request_json={"number": 42},
                result_json={"posted": True},
                created_at=BASE_TIME,
            ),
            AuditLog(
                repo_id=repo.id,
                action="repo.delete",
                status="failed",
                request_json={},
                result_json={"error": "boom"},
                created_at=BASE_TIME + timedelta(days=1),
            ),
        ]
    )

    workflow = AgentWorkflowRun(
        repo_id=repo.id,
        goal="排查 CI 失败",
        spec_json={"tasks": [{"id": "t1"}, {"id": "t2"}]},
        observation_json={"confidence": 0.7},
        metrics={"tool_calls": 4},
        final_answer="建议先修超时",
        status="success",
        created_at=BASE_TIME,
        completed_at=BASE_TIME + timedelta(seconds=90),
    )
    db.add(workflow)
    db.flush()
    db.add_all(
        [
            AgentTaskRun(
                workflow_id=workflow.id,
                task_id="t2",
                agent_name="ci-agent",
                task_type="ci_debug",
                status="success",
                claim_json={"claim": "t2"},
                input_json={},
                result_json={"ok": True},
                started_at=BASE_TIME + timedelta(seconds=40),
                completed_at=BASE_TIME + timedelta(seconds=80),
            ),
            AgentTaskRun(
                workflow_id=workflow.id,
                task_id="t1",
                agent_name="repo-agent",
                task_type="repo_scan",
                status="success",
                error=None,
                claim_json={},
                input_json={"path": "src"},
                result_json={},
                started_at=BASE_TIME,
                completed_at=BASE_TIME + timedelta(seconds=30),
            ),
        ]
    )
    db.commit()

    app = FastAPI()
    app.include_router(log_routes.router, prefix="/api/logs")
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as client:
        yield client, db, repo, owner
    db.close()


def test_agent_runs_expose_full_chain(log_env) -> None:
    client, _db, _repo, _owner = log_env
    response = client.get("/api/logs/agent-runs")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    first = body["items"][0]
    assert first["user_message"] == "无仓库的对话"
    assert first["repo_name"] is None
    assert [item["route"] for item in body["items"][1:]] == ["ci_debug", "pr_review"]
    assert body["items"][2]["tool_call_count"] == 2
    assert body["items"][2]["repo_name"] == "kynflow/log-demo"


def test_date_range_covers_the_whole_end_day(log_env) -> None:
    client, _db, _repo, _owner = log_env
    body = client.get("/api/logs/agent-runs?start=2026-11-03&end=2026-11-03").json()
    assert body["total"] == 1
    assert body["items"][0]["route"] == "ci_debug"
    assert body["start"].startswith("2026-11-03T00:00")
    assert body["end"].startswith("2026-11-03T23:59")


def test_invalid_date_is_rejected(log_env) -> None:
    client, _db, _repo, _owner = log_env
    response = client.get("/api/logs/agent-runs?start=11/03/2026")
    assert response.status_code == 400
    assert "无法解析" in response.json()["detail"]


def test_agent_runs_filters_and_pagination(log_env) -> None:
    client, _db, repo, _owner = log_env
    repo_scoped = client.get(f"/api/logs/agent-runs?repo_id={repo.id}").json()
    assert repo_scoped["total"] == 2

    failed = client.get("/api/logs/agent-runs?status=failed").json()
    assert failed["total"] == 1
    assert failed["items"][0]["route"] == "ci_debug"

    keyword = client.get("/api/logs/agent-runs?q=PR").json()
    assert keyword["total"] == 1

    paged = client.get("/api/logs/agent-runs?limit=1&offset=1").json()
    assert paged["total"] == 3
    assert len(paged["items"]) == 1
    assert paged["items"][0]["route"] == "ci_debug"


def test_chat_messages_truncate_and_keep_meta(log_env) -> None:
    client, _db, _repo, _owner = log_env
    body = client.get("/api/logs/chat-messages").json()
    assert body["total"] == 2
    assistant = next(item for item in body["items"] if item["role"] == "assistant")
    assert assistant["content_truncated"] is True
    assert assistant["content_length"] == 2500
    assert len(assistant["content"]) == 2000
    assert assistant["meta"]["tokens"]["prompt"] == 1200

    only_user = client.get("/api/logs/chat-messages?role=user").json()
    assert only_user["total"] == 1
    assert only_user["items"][0]["meta"] == {}


def test_audit_logs_are_filterable_and_permission_gated(log_env) -> None:
    client, db, _repo, owner = log_env
    body = client.get("/api/logs/audit-logs").json()
    assert body["total"] == 2
    assert body["items"][1]["action"] == "action_draft.confirm"
    assert body["items"][1]["request_json"] == {"number": 42}

    filtered = client.get("/api/logs/audit-logs?status=failed").json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["action"] == "repo.delete"

    by_action = client.get("/api/logs/audit-logs?action=action_draft.confirm").json()
    assert by_action["total"] == 1
    assert by_action["items"][0]["target_id"] == "42"

    owner.role = "viewer"
    db.commit()
    denied = client.get("/api/logs/audit-logs")
    assert denied.status_code == 403
    assert "settings:manage" in denied.json()["detail"]

    summary = client.get("/api/logs/summary").json()
    assert summary["audit_logs"] == 0
    assert summary["agent_runs"] == 3
    owner.role = "owner"
    db.commit()


def test_workflow_logs_include_ordered_tasks(log_env) -> None:
    client, _db, _repo, _owner = log_env
    body = client.get("/api/logs/workflows").json()
    assert body["total"] == 1
    run = body["items"][0]
    assert run["goal"] == "排查 CI 失败"
    assert run["duration_ms"] == 90_000
    assert [task["task_id"] for task in run["tasks"]] == ["t1", "t2"]
    assert run["tasks"][1]["duration_ms"] == 40_000
    assert run["metrics"] == {"tool_calls": 4}

    assert client.get("/api/logs/workflows?status=failed").json()["total"] == 0
    assert client.get("/api/logs/workflows?q=超时").json()["total"] == 1


def test_summary_counts_for_window(log_env) -> None:
    client, _db, _repo, _owner = log_env
    summary = client.get("/api/logs/summary?start=2026-11-02&end=2026-11-02").json()
    assert summary["agent_runs"] == 1
    assert summary["chat_messages"] == 1
    assert summary["audit_logs"] == 1
    assert summary["workflows"] == 1
    assert summary["start"].startswith("2026-11-02T00:00")
