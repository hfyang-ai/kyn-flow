import asyncio
import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from langchain_core.messages import AIMessage

from app.api.routes.chat import _build_conversation_tools, _repo_checkout_path
from app.core.config import settings
from app.services.agents.chat_agent import ChatAgent


class ScriptedToolModel:
    def __init__(self) -> None:
        self.calls = 0

    def bind_tools(self, tools: list[Any]) -> "ScriptedToolModel":
        self.tools = tools
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.calls += 1
        if self.calls == 1:
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "workspace__list_files",
                        "args": {"path": ".", "limit": 5},
                        "id": "call_list",
                    },
                ],
            )
        if self.calls == 2:
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "workspace__read_file",
                        "args": {"path": "README.md"},
                        "id": "call_read",
                    },
                ],
            )
        return AIMessage(content="README.md says this is the project overview.")


class SummaryModel:
    def bind_tools(self, tools: list[Any]) -> "SummaryModel":
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        return AIMessage(content="The README says this project coordinates AI agents.")


class RecentRecallModel:
    def __init__(self) -> None:
        self.calls = 0
        self.bind_tools_calls = 0

    def bind_tools(self, tools: list[Any]) -> "RecentRecallModel":
        self.bind_tools_calls += 1
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.calls += 1
        return AIMessage(content="你刚刚说的是：hi")


class CapturingModel:
    def __init__(self) -> None:
        self.messages: list[Any] = []

    def bind_tools(self, tools: list[Any]) -> "CapturingModel":
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.messages = messages
        return AIMessage(content="No team members are configured.")


class SingleToolModel:
    def __init__(self) -> None:
        self.calls = 0

    def bind_tools(self, tools: list[Any]) -> "SingleToolModel":
        self.tools = tools
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.calls += 1
        if self.calls == 1:
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "workspace__read_file",
                        "args": {"path": "README.md"},
                        "id": "call_read",
                    },
                ],
            )
        return AIMessage(content="The README has been read.")


class RepeatingToolModel:
    def __init__(self) -> None:
        self.calls = 0

    def bind_tools(self, tools: list[Any]) -> "RepeatingToolModel":
        self.tools = tools
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.calls += 1
        if self.calls <= 3:
            # 前三次都请求相同的工具与参数；第三次应被 guard 拦截而非执行。
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "workspace__read_file",
                        "args": {"path": "README.md"},
                        "id": f"call_read_{self.calls}",
                    },
                ],
            )
        # guard 提示后模型换路，直接基于已读内容作答。
        return AIMessage(content="I will answer from what I already read.")


class RewrittenRagModel:
    def __init__(self) -> None:
        self.calls = 0

    def bind_tools(self, tools: list[Any]) -> "RewrittenRagModel":
        self.tools = tools
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.calls += 1
        if self.calls == 1:
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "rag__search_similar_documents",
                        "args": {"query": "token refresh timeout history"},
                        "id": "call_rag_history",
                    }
                ],
            )
        if self.calls == 2:
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "rag__search_similar_documents",
                        "args": {"query": "idempotent retry decision"},
                        "id": "call_rag_decision",
                    }
                ],
            )
        return AIMessage(
            content="The history and retry decision agree: retry once with an idempotency key."
        )


class UsageModel:
    def bind_tools(self, tools: list[Any]) -> "UsageModel":
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        return AIMessage(
            content="usage captured",
            usage_metadata={
                "input_tokens": 123,
                "output_tokens": 7,
                "total_tokens": 130,
            },
        )


class OverflowThenSuccessModel:
    def __init__(self) -> None:
        self.calls = 0

    def bind_tools(self, tools: list[Any]) -> "OverflowThenSuccessModel":
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("maximum context length exceeded")
        return AIMessage(content="recovered after compact projection")


def _history_context(
    *, complete_and_exact: bool, exact_suffix_messages: int = 3
) -> dict[str, Any]:
    return {
        "server_messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "你好！有什么可以帮你？"},
            {"role": "user", "content": "我刚刚说了什么？"},
        ],
        "compression_stats": {
            "history_coverage": {
                "complete_and_exact": complete_and_exact,
                "exact_suffix_messages": exact_suffix_messages,
                "omitted_messages": 0 if complete_and_exact else 1,
                "truncated_messages": 0,
                "source_limit_reached": not complete_and_exact,
                "has_compaction_boundary": False,
                "microcompacted_messages": 0,
            }
        },
    }


@pytest.mark.asyncio
async def test_chat_agent_records_provider_usage_and_prompt_breakdown() -> None:
    final = await ChatAgent(model=UsageModel()).run(  # type: ignore[arg-type]
        {"message": "Give me a concise answer."},
        {"tools": {}},
    )

    assert final["answer"] == "usage captured"
    assert final["model_usage"][-1]["input_tokens"] == 123
    assert final["model_usage"][-1]["source"] == "provider"
    prompt_call = final["context_diagnostics"]["prompt_calls"][-1]
    assert prompt_call["estimated_prompt_tokens"] > 0
    assert prompt_call["tool_schema_tokens"] == 0


@pytest.mark.asyncio
async def test_context_overflow_retries_only_the_failed_model_call() -> None:
    model = OverflowThenSuccessModel()
    final = await ChatAgent(model=model).run(  # type: ignore[arg-type]
        {"message": "Continue the task."},
        {"tools": {}},
    )

    assert final["answer"] == "recovered after compact projection"
    assert model.calls == 2
    assert final["context_diagnostics"]["reactive_overflow_retry"] is True
    assert any(
        event["type"] == "context_overflow_recovery" for event in final["agent_events"]
    )


def test_runtime_tool_projection_compacts_old_observations_without_mutating_audit_state() -> (
    None
):
    agent = ChatAgent(model=None)
    state = {
        "observations": [
            {
                "tool_name": f"tool-{index}",
                "arguments": {"query": "auth"},
                "observation": {"answer_preview": (f"result-{index} " * 5000)},
            }
            for index in range(4)
        ],
        "agent_events": [],
    }
    original = state["observations"][0]["observation"]["answer_preview"]

    prompt_observations, _events, stats = agent._runtime_tool_context(state)  # type: ignore[arg-type]

    assert stats["estimated_tokens_saved"] > 0
    assert stats["prompt_observation_tokens"] <= stats["observation_budget_tokens"]
    assert state["observations"][0]["observation"]["answer_preview"] == original
    assert len(prompt_observations) >= 1


@pytest.mark.asyncio
async def test_recent_recall_uses_injected_history_without_memory_tool() -> None:
    model = RecentRecallModel()
    memory_tool_calls = 0

    async def get_thread_context(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        nonlocal memory_tool_calls
        memory_tool_calls += 1
        return {
            "route": "thread_context",
            "tool_calls": [],
            "answer": "user: hi",
            "citations": [],
        }

    final = await ChatAgent(model=model).run(  # type: ignore[arg-type]
        {"message": "我刚刚说了什么？"},
        {
            **_history_context(complete_and_exact=True),
            "tools": {"kynflow_get_thread_context": get_thread_context},
        },
    )

    assert final["answer"] == "你刚刚说的是：hi"
    assert final["route"] == "direct_answer"
    assert final["tool_calls"] == []
    assert memory_tool_calls == 0
    assert model.calls == 1
    assert model.bind_tools_calls == 0
    policy = next(
        event for event in final["agent_events"] if event["type"] == "context_policy"
    )
    assert policy["mode"] == "direct_recent_history"
    assert policy["reason"] == "exact_recent_messages_available"


@pytest.mark.asyncio
async def test_recent_recall_fetches_thread_context_when_prompt_history_is_incomplete() -> (
    None
):
    model = RecentRecallModel()
    memory_tool_calls = 0

    async def get_thread_context(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        nonlocal memory_tool_calls
        memory_tool_calls += 1
        return {
            "route": "thread_context",
            "tool_calls": [
                {
                    "tool_name": "kynflow_get_thread_context",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "user: hi",
            "citations": [],
        }

    final = await ChatAgent(model=model).run(  # type: ignore[arg-type]
        {"message": "我刚刚说了什么？"},
        {
            **_history_context(complete_and_exact=False, exact_suffix_messages=1),
            "tools": {"kynflow_get_thread_context": get_thread_context},
        },
    )

    assert memory_tool_calls == 1
    assert [call["tool_name"] for call in final["tool_calls"]] == [
        "kynflow_get_thread_context"
    ]
    assert not any(
        call["tool_name"] == "kynflow_search_evidence" for call in final["tool_calls"]
    )
    policy = next(
        event for event in final["agent_events"] if event["type"] == "context_policy"
    )
    assert policy["reason"] == "recent_history_incomplete"


@pytest.mark.asyncio
async def test_exact_recall_request_verifies_with_thread_context() -> None:
    invocations = 0

    async def get_thread_context(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        nonlocal invocations
        invocations += 1
        return {
            "route": "thread_context",
            "tool_calls": [
                {
                    "tool_name": "kynflow_get_thread_context",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "user: hi",
            "citations": [],
        }

    context = _history_context(complete_and_exact=True)
    context["server_messages"][-1]["content"] = "请逐字核实我刚刚说的原话"
    final = await ChatAgent(model=RecentRecallModel()).run(  # type: ignore[arg-type]
        {"message": "请逐字核实我刚刚说的原话"},
        {**context, "tools": {"kynflow_get_thread_context": get_thread_context}},
    )

    assert invocations == 1
    assert [call["tool_name"] for call in final["tool_calls"]] == [
        "kynflow_get_thread_context"
    ]
    policy = next(
        event for event in final["agent_events"] if event["type"] == "context_policy"
    )
    assert policy["reason"] == "exact_verification_requested"


@pytest.mark.asyncio
async def test_cross_session_recall_uses_session_events() -> None:
    invocations = 0

    async def read_session_events(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        nonlocal invocations
        invocations += 1
        return {
            "route": "session_events",
            "tool_calls": [
                {
                    "tool_name": "kynflow_read_session_events",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "上次会话决定使用短期令牌。",
            "citations": [],
        }

    context = _history_context(complete_and_exact=True)
    context["server_messages"][-1]["content"] = "上次会话我们决定了什么？"
    final = await ChatAgent(model=RecentRecallModel()).run(  # type: ignore[arg-type]
        {"message": "上次会话我们决定了什么？"},
        {**context, "tools": {"kynflow_read_session_events": read_session_events}},
    )

    assert invocations == 1
    assert [call["tool_name"] for call in final["tool_calls"]] == [
        "kynflow_read_session_events"
    ]
    policy = next(
        event for event in final["agent_events"] if event["type"] == "context_policy"
    )
    assert policy["reason"] == "cross_session_request"


@pytest.mark.asyncio
async def test_chat_agent_can_continue_from_list_files_to_read_file() -> None:
    model = ScriptedToolModel()
    tool_invocations: list[tuple[str, dict[str, Any]]] = []

    async def list_files(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        tool_invocations.append(("list", input_data))
        return {
            "route": "workspace_list_files",
            "tool_calls": [
                {
                    "tool_name": "workspace.list_files",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "README.md",
            "citations": [],
        }

    async def read_file(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        tool_invocations.append(("read", input_data))
        return {
            "route": "workspace_read_file",
            "tool_calls": [
                {
                    "tool_name": "workspace.read_file",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "README.md:1-1\n1: # Project",
            "citations": [
                {"type": "workspace_file", "id": "README.md", "title": "README.md"}
            ],
        }

    agent = ChatAgent(model=model)  # type: ignore[arg-type]
    events = [
        event
        async for event in agent.run_stream(
            {"message": "Find the overview files, then read README.md."},
            {
                "tools": {
                    "workspace.list_files": list_files,
                    "workspace.read_file": read_file,
                }
            },
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    assert model.calls == 3
    assert [name for name, _input_data in tool_invocations] == ["list", "read"]
    assert final["route"] == "workspace_read_file"
    assert [call["tool_name"] for call in final["tool_calls"]] == [
        "workspace.list_files",
        "workspace.read_file",
    ]
    assert [
        event["type"]
        for event in final["agent_events"]
        if event["type"] in {"tool_use", "tool_result"}
    ] == [
        "tool_use",
        "tool_result",
        "tool_use",
        "tool_result",
    ]


@pytest.mark.asyncio
async def test_chat_agent_streams_tool_use_before_tool_finishes() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    async def read_file(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        started.set()
        await release.wait()
        return {
            "route": "workspace_read_file",
            "tool_calls": [
                {
                    "tool_name": "workspace.read_file",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "README.md:1-1\n1: # Project",
            "citations": [
                {"type": "workspace_file", "id": "README.md", "title": "README.md"}
            ],
        }

    agent = ChatAgent(model=SingleToolModel())  # type: ignore[arg-type]
    stream = agent.run_stream(
        {"message": "Read README.md."},
        {"tools": {"workspace.read_file": read_file}},
    )

    first_event = await stream.__anext__()
    assert first_event["event"] == "tool_use"
    assert first_event["data"]["tool_name"] == "workspace.read_file"
    assert not started.is_set()

    next_event = asyncio.create_task(stream.__anext__())
    await asyncio.wait_for(started.wait(), timeout=1)
    assert not next_event.done()
    release.set()
    tool_result = await asyncio.wait_for(next_event, timeout=1)
    assert tool_result["event"] == "tool_result"
    remaining_events = [event async for event in stream]
    assert remaining_events[-1]["event"] == "final"


@pytest.mark.asyncio
async def test_project_overview_prefetches_readme_without_waiting_for_model_tool_choice() -> (
    None
):
    tool_invocations: list[tuple[str, dict[str, Any]]] = []

    async def list_files(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        tool_invocations.append(("list", input_data))
        return {
            "route": "workspace_list_files",
            "tool_calls": [
                {
                    "tool_name": "workspace.list_files",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "README.md\nREADME.zh-CN.md\npackage.json",
            "citations": [],
        }

    async def read_file(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        tool_invocations.append(("read", input_data))
        return {
            "route": "workspace_read_file",
            "tool_calls": [
                {
                    "tool_name": "workspace.read_file",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": f"{input_data['path']}:1-1\n1: # Clowder AI",
            "citations": [
                {
                    "type": "workspace_file",
                    "id": input_data["path"],
                    "title": input_data["path"],
                }
            ],
        }

    agent = ChatAgent(model=SummaryModel())  # type: ignore[arg-type]
    events = [
        event
        async for event in agent.run_stream(
            {"message": "What is this project?"},
            {
                "tools": {
                    "workspace.list_files": list_files,
                    "workspace.read_file": read_file,
                }
            },
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    assert [name for name, _input_data in tool_invocations] == [
        "list",
        "read",
        "read",
        "read",
    ]
    assert final["route"] == "workspace_read_file"
    assert "coordinates AI agents" in final["answer"]
    assert (
        len([event for event in final["agent_events"] if event["type"] == "tool_use"])
        == 4
    )
    assert (
        len(
            [event for event in final["agent_events"] if event["type"] == "tool_result"]
        )
        == 4
    )


@pytest.mark.asyncio
async def test_chat_agent_combines_prefetched_evidence_with_rewritten_rag_searches() -> (
    None
):
    model = RewrittenRagModel()
    queries: list[str] = []

    async def search_rag(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        query = str(input_data.get("query") or "")
        queries.append(query)
        return {
            "route": "semantic_search",
            "tool_calls": [
                {
                    "tool_name": "rag.search_similar_documents",
                    "arguments": {"query": query},
                    "status": "success",
                }
            ],
            "answer": f"Evidence for {query}",
            "citations": [{"type": "project_doc", "id": query, "title": query}],
        }

    events = [
        event
        async for event in ChatAgent(model=model).run_stream(  # type: ignore[arg-type]
            {
                "message": "Why does token refresh fail, and what retry policy did we choose?"
            },
            {
                "tools": {"rag.search_similar_documents": search_rag},
                "evidence": [{"title": "prefetched auth overview"}],
                "server_context": "[Related Evidence]\nauth overview\n[/Related Evidence]",
            },
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    assert queries == ["token refresh timeout history", "idempotent retry decision"]
    assert [call["arguments"]["query"] for call in final["tool_calls"]] == queries
    strategy = next(
        event for event in final["agent_events"] if event["type"] == "rag_strategy"
    )
    assert strategy["mode"] == "hybrid_rag"
    assert strategy["pre_retrieval"]["evidence_count"] == 1
    assert (
        strategy["pre_retrieval"]["query"]
        == "Why does token refresh fail, and what retry policy did we choose?"
    )
    assert strategy["pre_retrieval"]["sources"] == [
        {
            "source_id": "",
            "source_type": "evidence",
            "title": "prefetched auth overview",
            "score": None,
        }
    ]
    assert strategy["reasoning_retrieval"]["supports_query_rewrite"] is True
    assert final["completion"]["tool_call_count"] == 2


@pytest.mark.asyncio
async def test_chat_agent_evaluation_mode_preserves_prefetch_and_tool_retrieval_contexts() -> (
    None
):
    model = RewrittenRagModel()

    async def search_rag(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        query = str(input_data.get("query") or "")
        source_id = f"source-{len(query)}"
        snippet = f"Evidence returned for {query}."
        return {
            "route": "semantic_search",
            "tool_calls": [
                {
                    "tool_name": "rag.search_similar_documents",
                    "arguments": {"query": query},
                    "status": "success",
                }
            ],
            "answer": snippet,
            "citations": [{"type": "project_doc", "id": source_id, "title": query}],
            "retrieved_contexts": [snippet],
            "retrieval_results": [
                {
                    "id": source_id,
                    "source_id": source_id,
                    "source_type": "project_doc",
                    "title": query,
                    "snippet": snippet,
                    "score": 0.9,
                }
            ],
        }

    final = await ChatAgent(model=model).run(  # type: ignore[arg-type]
        {"message": "How should auth retries work?"},
        {
            "tools": {"rag.search_similar_documents": search_rag},
            "evaluation_mode": True,
            "evidence": [
                {
                    "source_id": "prefetch-1",
                    "source_type": "project_doc",
                    "title": "Authentication policy",
                    "snippet": "Authentication retries must be idempotent.",
                    "score": 1.0,
                }
            ],
        },
    )

    trace = final["evaluation_trace"]
    assert trace["target"] == "ChatAgent"
    assert [item["stage"] for item in trace["retrievals"]] == [
        "prefetch",
        "agent_tool",
        "agent_tool",
    ]
    assert (
        "[project_doc] Authentication policy: Authentication retries must be idempotent."
        in trace["retrieved_contexts"]
    )
    assert any(
        item.endswith("Evidence returned for token refresh timeout history.")
        for item in trace["retrieved_contexts"]
    )
    assert len(trace["tool_observations"]) == 2

    normal = await ChatAgent(model=SummaryModel()).run(  # type: ignore[arg-type]
        {"message": "Summarize the evidence."},
        {"tools": {}, "evidence": []},
    )
    assert "evaluation_trace" not in normal


@pytest.mark.asyncio
async def test_project_overview_without_llm_uses_workspace_evidence(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "llm_api_key", None)

    async def list_files(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "route": "workspace_list_files",
            "tool_calls": [
                {
                    "tool_name": "workspace.list_files",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "README.md frontend/package.json",
            "citations": [],
        }

    async def read_file(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        return {
            "route": "workspace_read_file",
            "tool_calls": [
                {
                    "tool_name": "workspace.read_file",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "README.md:1-2\n1: # Kynflow\n2: Core capability: repository analysis.",
            "citations": [],
        }

    events = [
        event
        async for event in ChatAgent(model=None).run_stream(
            {"message": "What does this project do?"},
            {
                "tools": {
                    "workspace.list_files": list_files,
                    "workspace.read_file": read_file,
                }
            },
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    assert "Core capability: repository analysis" in final["answer"]
    assert final["completion"]["tool_call_count"] == 2
    assert final["completion"]["tool_error_count"] == 0
    assert final["completion"]["status"] == "completed"
    assert final["completion"]["reason"] == "project_context_loaded"


@pytest.mark.asyncio
async def test_open_issue_question_without_llm_uses_prefetched_issue_evidence(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "llm_api_key", None)

    async def unexpected_workspace_call(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        raise AssertionError("Issue query must not be routed to workspace tools")

    events = [
        event
        async for event in ChatAgent(model=None).run_stream(
            {"message": "请列出当前仓库未关闭的 Issue，并说明你使用了哪些数据。"},
            {
                "tools": {"workspace.list_files": unexpected_workspace_call},
                "evidence": [
                    {
                        "source_type": "issue",
                        "source_id": "issue-18",
                        "title": "Issue #18: Token refresh race",
                        "snippet": "Token refresh can race under concurrent requests. state: open",
                        "metadata": {"number": 18, "state": "open"},
                    },
                    {
                        "source_type": "issue",
                        "source_id": "issue-11",
                        "title": "Issue #11: Retired task",
                        "snippet": "This task is complete. state: closed",
                        "metadata": {"number": 11, "state": "closed"},
                    },
                ],
            },
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    assert "Issue #18: Token refresh race" in final["answer"]
    assert "Issue #11: Retired task" not in final["answer"]
    assert "本轮没有调用工作区源码工具" in final["answer"]
    assert final["tool_calls"] == []
    assert final["route"] == "prefetched_evidence"
    assert final["completion"]["status"] == "completed"
    assert final["completion"]["reason"] == "prefetched_evidence_available"


@pytest.mark.asyncio
async def test_conversation_rag_tool_prefers_agent_rewritten_query(monkeypatch) -> None:
    repo = SimpleNamespace(id=uuid.uuid4(), full_name="acme/auth-service")
    conversation = SimpleNamespace(id=uuid.uuid4())
    captured: dict[str, Any] = {}

    def fake_semantic_search(repo_arg, query, context, db):
        captured["search_query"] = query
        return (
            "rewritten evidence",
            [{"type": "project_doc", "id": "doc-1", "title": "Retry policy"}],
            [
                {
                    "source_type": "project_doc",
                    "source_id": "doc-1",
                    "title": "Retry policy",
                }
            ],
        )

    def fake_record_recall_event(*args, **kwargs):
        captured["recall_query"] = kwargs["query"]
        captured["metadata"] = kwargs["metadata"]

    monkeypatch.setattr(
        "app.tools.semantic_search._semantic_search", fake_semantic_search
    )
    monkeypatch.setattr(
        "app.tools.semantic_search.record_recall_event", fake_record_recall_event
    )
    tools = _build_conversation_tools(repo, conversation, object())

    result = await tools["rag.search_similar_documents"](
        {
            "message": "Why does authentication fail?",
            "query": "refresh token idempotency race condition",
        },
        {},
    )

    assert captured["search_query"] == "refresh token idempotency race condition"
    assert captured["recall_query"] == "refresh token idempotency race condition"
    assert captured["metadata"]["query_rewritten"] is True
    assert (
        result["tool_calls"][0]["arguments"]["query"]
        == "refresh token idempotency race condition"
    )


def test_repo_checkout_path_reuses_existing_same_full_name_checkout(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "repo_checkout_dir", str(tmp_path))
    stale_checkout = tmp_path / "old-id-296569015__clowder-ai"
    stale_checkout.mkdir()
    repo = SimpleNamespace(id=uuid.uuid4(), full_name="296569015/clowder-ai")

    assert _repo_checkout_path(repo) == stale_checkout.resolve()


def test_assignment_prompt_treats_empty_team_as_no_candidates() -> None:
    agent = ChatAgent(model=SummaryModel())  # type: ignore[arg-type]
    prompt = agent._tool_calling_user_prompt(
        {
            "message": "这个桌面化 Issue 应该分给谁？",
            "context": {
                "team_members": [],
                "server_context": "README mentions 布偶猫 / opus as project personas.",
            },
            "observations": [],
            "agent_events": [],
            "tools": {},
        }
    )

    assert "team_members: []" in prompt
    assert "当前仓库还没有配置 Kynflow 团队成员" in prompt
    assert "不要把仓库内容" in prompt


@pytest.mark.asyncio
async def test_final_prompt_keeps_assignment_candidates_scoped_to_team_members() -> (
    None
):
    model = CapturingModel()
    agent = ChatAgent(model=model)  # type: ignore[arg-type]
    await agent._final_from_observations(
        {
            "message": "这个桌面化 Issue 应该分给谁？",
            "context": {
                "team_members": [],
                "server_context": "README mentions 布偶猫 / opus as project personas.",
            },
            "observations": [
                {"answer": "Issue text mentions 布偶猫 and desktop work."}
            ],
            "agent_events": [],
        }
    )
    prompt = "\n".join(str(message.content) for message in model.messages)

    assert "team_members: []" in prompt
    assert "团队比喻都不能当成人" in prompt
    assert "在团队面板中添加开发者" in prompt


@pytest.mark.asyncio
async def test_chat_agent_retries_transient_tool_error_once() -> None:
    attempts = 0

    async def flaky_read_file(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise TimeoutError("temporary timeout")
        return {
            "route": "workspace_read_file",
            "tool_calls": [
                {
                    "tool_name": "workspace.read_file",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "README.md:1-1\n1: # Project",
            "citations": [],
        }

    agent = ChatAgent(model=SingleToolModel())  # type: ignore[arg-type]
    events = [
        event
        async for event in agent.run_stream(
            {"message": "Read README.md."},
            {"tools": {"workspace.read_file": flaky_read_file}},
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    assert attempts == 2
    assert final["tool_calls"][0]["status"] == "success"
    assert any(
        event["type"] == "tool_retry" and event["error_kind"] == "timeout"
        for event in final["agent_events"]
    )
    assert final["completion"]["status"] == "completed"


@pytest.mark.asyncio
async def test_chat_agent_stops_repeated_identical_tool_calls() -> None:
    invocations = 0

    async def read_file(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        nonlocal invocations
        invocations += 1
        return {
            "route": "workspace_read_file",
            "tool_calls": [
                {
                    "tool_name": "workspace.read_file",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "README.md:1-1\n1: # Project",
            "citations": [],
        }

    agent = ChatAgent(model=RepeatingToolModel())  # type: ignore[arg-type]
    events = [
        event
        async for event in agent.run_stream(
            {"message": "Read README.md."},
            {"tools": {"workspace.read_file": read_file}},
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    # 前两次真正执行，第三次被 guard 拦截不执行，之后模型换路直接作答。
    assert invocations == agent.max_repeated_tool_calls
    assert final["completion"]["status"] == "completed"
    assert final["completion"]["reason"] == "model_final_answer"
    assert final["answer"] == "I will answer from what I already read."
    assert any(
        event["type"] == "tool_loop_guard" and event["guard"] == "identical_tool_call"
        for event in final["agent_events"]
    )
    # guard 只拦截本次调用，不再终止整个 Loop。
    assert not any(
        event["type"] == "agent_loop_stop" and event["reason"] == "repeated_tool_call"
        for event in final["agent_events"]
    )


@pytest.mark.asyncio
async def test_read_workspace_file_reports_remaining_lines(
    tmp_path, monkeypatch
) -> None:
    """工具输出必须自带"读到哪、还剩多少、下一步从哪读"，模型不靠试参数。"""
    repo = SimpleNamespace(id=uuid.uuid4(), full_name="acme/demo")
    monkeypatch.setattr(settings, "repo_checkout_dir", str(tmp_path))
    checkout = _repo_checkout_path(repo)
    checkout.mkdir(parents=True, exist_ok=True)
    (checkout / "demo.py").write_text(
        "\n".join(f"line{i}" for i in range(1, 1201)) + "\n", encoding="utf-8"
    )
    tools = _build_conversation_tools(repo, None, object())
    read_file = tools["workspace.read_file"]

    first = await read_file({"path": "demo.py", "start_line": 1, "line_count": 200}, {})
    assert first["answer"].splitlines()[0] == (
        "demo.py:1-200（共 1200 行，还有 1000 行未读，续读请用 start_line=201）"
    )
    assert first["read_range"] == {
        "path": "demo.py",
        "start_line": 1,
        "end_line": 200,
        "total_lines": 1200,
        "truncated": True,
        "next_start_line": 201,
    }

    capped = await read_file(
        {"path": "demo.py", "start_line": 1, "line_count": 900}, {}
    )
    capped_header = capped["answer"].splitlines()[0]
    assert "单次最多返回 800 行" in capped_header
    assert capped["read_range"]["end_line"] == 800

    tail = await read_file(
        {"path": "demo.py", "start_line": 801, "line_count": 800}, {}
    )
    assert tail["answer"].splitlines()[0].endswith("已读到文件末尾）")
    assert tail["read_range"]["truncated"] is False
    assert tail["read_range"]["next_start_line"] is None

    out_of_range = await read_file(
        {"path": "demo.py", "start_line": 1300, "line_count": 100}, {}
    )
    assert "start_line=1300 超出范围" in out_of_range["answer"]


class AdvancingReadModel:
    """合法续读：每次都有新行（与上次部分重叠但持续推进），不应触发 guard。"""

    def __init__(self) -> None:
        self.calls = 0
        self.plan = [
            {"path": "README.md", "start_line": 1, "line_count": 160},
            {"path": "README.md", "start_line": 101, "line_count": 100},
            {"path": "README.md", "start_line": 191, "line_count": 60},
        ]

    def bind_tools(self, tools: list[Any]) -> "AdvancingReadModel":
        self.tools = tools
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.calls += 1
        if self.calls <= len(self.plan):
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "workspace__read_file",
                        "args": dict(self.plan[self.calls - 1]),
                        "id": f"call_read_{self.calls}",
                    },
                ],
            )
        return AIMessage(content="Finished reading the file.")


class FullyCoveredSubsetModel:
    """读完一整段后又反复请求其子集（0 个新行）：应触发 guard，但 Loop 不终止。"""

    def __init__(self) -> None:
        self.calls = 0

    def bind_tools(self, tools: list[Any]) -> "FullyCoveredSubsetModel":
        self.tools = tools
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.calls += 1
        if self.calls == 1:
            args = {"path": "README.md", "start_line": 1, "line_count": 200}
        elif self.calls <= 4:
            args = {"path": "README.md", "start_line": 1, "line_count": 100}
        else:
            return AIMessage(content="I will answer from what I already read.")
        return AIMessage(
            content="",
            tool_calls=[
                {
                    "name": "workspace__read_file",
                    "args": args,
                    "id": f"call_read_{self.calls}",
                },
            ],
        )


@pytest.mark.asyncio
async def test_chat_agent_allows_advancing_reads() -> None:
    """合法续读（每次都有新行）不应被 guard 拦截，任务完整执行到给出答案。"""
    invocations = 0

    async def read_file(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        nonlocal invocations
        invocations += 1
        start = int(input_data.get("start_line") or 1)
        end = min(start + int(input_data.get("line_count") or 160) - 1, 400)
        return {
            "route": "workspace_read_file",
            "tool_calls": [
                {
                    "tool_name": "workspace.read_file",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": f"README.md:{start}-{end}\n1: # Project",
            "citations": [],
            "read_range": {
                "path": "README.md",
                "start_line": start,
                "end_line": end,
                "total_lines": 400,
                "truncated": end < 400,
                "next_start_line": end + 1 if end < 400 else None,
            },
        }

    agent = ChatAgent(model=AdvancingReadModel())  # type: ignore[arg-type]
    events = [
        event
        async for event in agent.run_stream(
            {"message": "Read README.md."},
            {"tools": {"workspace.read_file": read_file}},
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    assert invocations == 3
    assert final["completion"]["status"] == "completed"
    assert final["answer"] == "Finished reading the file."
    assert not any(
        event["type"] == "tool_loop_guard" for event in final["agent_events"]
    )


@pytest.mark.asyncio
async def test_chat_agent_guards_fully_covered_reads_without_stopping() -> None:
    """0 个新行的重复读触发 guard，但只拦截本次、不终止 Loop，模型换路后完成。"""
    invocations = 0

    async def read_file(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        nonlocal invocations
        invocations += 1
        start = int(input_data.get("start_line") or 1)
        end = min(start + int(input_data.get("line_count") or 160) - 1, 400)
        return {
            "route": "workspace_read_file",
            "tool_calls": [
                {
                    "tool_name": "workspace.read_file",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": f"README.md:{start}-{end}\n1: # Project",
            "citations": [],
            "read_range": {
                "path": "README.md",
                "start_line": start,
                "end_line": end,
                "total_lines": 400,
                "truncated": end < 400,
                "next_start_line": end + 1 if end < 400 else None,
            },
        }

    agent = ChatAgent(model=FullyCoveredSubsetModel())  # type: ignore[arg-type]
    events = [
        event
        async for event in agent.run_stream(
            {"message": "Read README.md."},
            {"tools": {"workspace.read_file": read_file}},
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    # 1-200 执行一次，第一次 1-100（redundant=1）放行执行；后续子集读被 guard 拦截。
    assert invocations == 2
    assert final["completion"]["status"] == "completed"
    assert final["answer"] == "I will answer from what I already read."
    assert any(
        event["type"] == "tool_loop_guard" and event["guard"] == "redundant_read"
        for event in final["agent_events"]
    )
    # guard 只拦截本次调用，不再终止整个 Loop。
    assert not any(
        event["type"] == "agent_loop_stop" and event["reason"] == "redundant_tool_read"
        for event in final["agent_events"]
    )


def test_runtime_tool_context_keeps_distinct_read_ranges_of_same_file() -> None:
    """同一文件的不同区间都要保留：续读拼起来的上下文不能被折叠成一条。"""
    agent = ChatAgent(model=ScriptedToolModel())  # type: ignore[arg-type]
    state: dict[str, Any] = {
        "observations": [
            {
                "tool_name": "workspace.read_file",
                "arguments": {"path": "a.py", "start_line": 1, "line_count": 160},
                "observation": {
                    "route": "workspace_read_file",
                    "answer_preview": "A-first",
                },
            },
            {
                "tool_name": "workspace.read_file",
                "arguments": {"path": "b.py", "start_line": 1, "line_count": 160},
                "observation": {
                    "route": "workspace_read_file",
                    "answer_preview": "B-only",
                },
            },
            {
                "tool_name": "workspace.read_file",
                "arguments": {"path": "a.py", "start_line": 161, "line_count": 160},
                "observation": {
                    "route": "workspace_read_file",
                    "answer_preview": "A-second",
                },
            },
        ],
        "agent_events": [],
    }

    prompt_observations, _events, stats = agent._runtime_tool_context(state)
    previews = [
        item["observation"].get("answer_preview")
        for item in prompt_observations
        if isinstance(item.get("observation"), dict)
    ]
    # 1-160 与 161-320 是相邻但不重叠的两段，都属于有效内容，不能互相取代。
    assert "A-first" in previews
    assert "A-second" in previews
    assert "B-only" in previews
    assert stats["superseded_read_observations"] == 0


def test_runtime_tool_context_drops_reads_covered_by_later_reads() -> None:
    """旧读取被后续更大区间完整覆盖时才折叠，避免 prompt 里叠同一段内容。"""
    agent = ChatAgent(model=ScriptedToolModel())  # type: ignore[arg-type]
    state: dict[str, Any] = {
        "observations": [
            {
                "tool_name": "workspace.read_file",
                "arguments": {"path": "a.py", "start_line": 1, "line_count": 100},
                "observation": {
                    "route": "workspace_read_file",
                    "answer_preview": "A-narrow",
                },
            },
            {
                "tool_name": "workspace.read_file",
                "arguments": {"path": "a.py", "start_line": 1, "line_count": 200},
                "observation": {
                    "route": "workspace_read_file",
                    "answer_preview": "A-wide",
                },
            },
        ],
        "agent_events": [],
    }

    prompt_observations, _events, stats = agent._runtime_tool_context(state)
    previews = [
        item["observation"].get("answer_preview")
        for item in prompt_observations
        if isinstance(item.get("observation"), dict)
    ]
    assert "A-narrow" not in previews
    assert "A-wide" in previews
    assert stats["superseded_read_observations"] == 1
    assert any(item.get("superseded_reads") == ["a.py"] for item in prompt_observations)


def test_read_coverage_merges_adjacent_ranges() -> None:
    merged = ChatAgent._merge_read_ranges([], 1, 100)
    merged = ChatAgent._merge_read_ranges(merged, 101, 200)
    merged = ChatAgent._merge_read_ranges(merged, 400, 420)
    merged = ChatAgent._merge_read_ranges(merged, 150, 180)
    assert merged == [[1, 200], [400, 420]]


def test_runtime_tool_context_preserves_read_file_content() -> None:
    """读文件结果是答案原材料，不能被观测条数摊薄到看不到内容。

    回归场景：模型读一个 92 行文件后，投影里必须仍能看到文件末尾
    （execute 方法体所在行），否则它会反复重读同一文件耗尽步数。
    """
    agent = ChatAgent(model=ScriptedToolModel())  # type: ignore[arg-type]
    long_file = "\n".join(f"{i}: line{i}" for i in range(1, 93))
    read_item = {
        "tool_name": "workspace.read_file",
        "arguments": {"path": "a.py", "start_line": 1, "line_count": 160},
        "observation": {
            "route": "workspace_read_file",
            "answer_preview": f"a.py:1-92（共 92 行，已读到文件末尾）\n{long_file}",
        },
    }
    others = [
        {
            "tool_name": "workspace.search_code",
            "arguments": {"pattern": "x"},
            "observation": {
                "route": "workspace_search_code",
                "answer_preview": f"result-{i} " + "x" * 800,
            },
        }
        for i in range(19)
    ]
    state: dict[str, Any] = {"observations": [*others, read_item], "agent_events": []}

    prompt_observations, _events, _stats = agent._runtime_tool_context(state)
    read_preview = next(
        (
            item["observation"].get("answer_preview", "")
            for item in prompt_observations
            if item.get("tool_name") == "workspace.read_file"
            and isinstance(item.get("observation"), dict)
        ),
        "",
    )
    assert read_preview, "read_file 结果不应被投影省略"
    assert "92: line92" in read_preview


class RepeatedSearchQueryModel:
    """同一 query 换 path 反复搜：第 2 次应被 guard 拦截，模型换路后作答。"""

    def __init__(self) -> None:
        self.calls = 0

    def bind_tools(self, tools: list[Any]) -> "RepeatedSearchQueryModel":
        self.tools = tools
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.calls += 1
        if self.calls == 1:
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "workspace__search_code",
                        "args": {
                            "query": "MAX_OUTPUT_TOKENS",
                            "path": "kyncode",
                            "limit": 20,
                        },
                        "id": "call_search_1",
                    },
                ],
            )
        if self.calls == 2:
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "workspace__search_code",
                        "args": {
                            "query": "MAX_OUTPUT_TOKENS",
                            "path": "kyncode/tools/runtime.py",
                            "limit": 20,
                        },
                        "id": "call_search_2",
                    },
                ],
            )
        return AIMessage(content="I will answer from the first search results.")


@pytest.mark.asyncio
async def test_chat_agent_guards_repeated_search_query() -> None:
    """换 path 重搜同一个 query 是纯浪费，第 2 次就应被 guard 拦截。"""
    invocations = 0

    async def search_code(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        nonlocal invocations
        invocations += 1
        return {
            "route": "workspace_search_code",
            "tool_calls": [
                {
                    "tool_name": "workspace.search_code",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "runtime.py:15: MAX_OUTPUT_TOKENS = 15000",
            "citations": [],
        }

    agent = ChatAgent(model=RepeatedSearchQueryModel())  # type: ignore[arg-type]
    events = [
        event
        async for event in agent.run_stream(
            {"message": "Where is MAX_OUTPUT_TOKENS defined?"},
            {"tools": {"workspace.search_code": search_code}},
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    assert invocations == 1
    assert final["completion"]["status"] == "completed"
    assert final["answer"] == "I will answer from the first search results."
    assert any(
        event["type"] == "tool_loop_guard"
        and event["guard"] == "repeated_search_query"
        for event in final["agent_events"]
    )


class OverlapRereadModel:
    """从头反复读同一文件并扩大 line_count：第 2 次重叠重读应被 guard 拦截。"""

    def __init__(self) -> None:
        self.calls = 0
        self.plan = [
            {"path": "grep.py", "start_line": 1, "line_count": 200},
            {"path": "grep.py", "start_line": 1, "line_count": 220},
            {"path": "grep.py", "start_line": 1, "line_count": 240},
        ]

    def bind_tools(self, tools: list[Any]) -> "OverlapRereadModel":
        self.tools = tools
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.calls += 1
        if self.calls <= len(self.plan):
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "workspace__read_file",
                        "args": dict(self.plan[self.calls - 1]),
                        "id": f"call_read_{self.calls}",
                    },
                ],
            )
        return AIMessage(content="I have read enough.")


@pytest.mark.asyncio
async def test_chat_agent_guards_overlap_rereads() -> None:
    """从已读区间内反复重读（只是把 line_count 调大）应被 guard 引导续读。"""
    invocations = 0

    async def read_file(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        nonlocal invocations
        invocations += 1
        start = int(input_data.get("start_line") or 1)
        end = min(start + int(input_data.get("line_count") or 160) - 1, 400)
        return {
            "route": "workspace_read_file",
            "tool_calls": [
                {
                    "tool_name": "workspace.read_file",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": f"grep.py:{start}-{end}\n{start}: # code",
            "citations": [],
            "read_range": {
                "path": "grep.py",
                "start_line": start,
                "end_line": end,
                "total_lines": 400,
                "truncated": end < 400,
                "next_start_line": end + 1 if end < 400 else None,
            },
        }

    agent = ChatAgent(model=OverlapRereadModel())  # type: ignore[arg-type]
    events = [
        event
        async for event in agent.run_stream(
            {"message": "Read grep.py."},
            {"tools": {"workspace.read_file": read_file}},
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    assert invocations == 2
    assert final["completion"]["status"] == "completed"
    assert final["answer"] == "I have read enough."
    assert any(
        event["type"] == "tool_loop_guard" and event["guard"] == "overlap_reread"
        for event in final["agent_events"]
    )


def test_normalize_search_query_merges_variants() -> None:
    """大小写 / 尾随运算符差异应归并为同一 query 指纹。"""
    assert (
        ChatAgent._normalize_search_query("MAX_OUTPUT_TOKENS")
        == "max_output_tokens"
    )
    assert (
        ChatAgent._normalize_search_query("MAX_OUTPUT_TOKENS =")
        == "max_output_tokens"
    )
    assert ChatAgent._normalize_search_query("  Grep( ") == "grep"
    assert ChatAgent._normalize_search_query("Grep") == "grep"


@pytest.mark.asyncio
async def test_search_workspace_code_empty_result_hint(tmp_path, monkeypatch) -> None:
    """搜索空结果必须显式提示换策略，避免模型换 path 重搜同一个词。"""
    repo = SimpleNamespace(id=uuid.uuid4(), full_name="acme/demo")
    monkeypatch.setattr(settings, "repo_checkout_dir", str(tmp_path))
    checkout = _repo_checkout_path(repo)
    checkout.mkdir(parents=True, exist_ok=True)
    (checkout / "demo.py").write_text("print('hello')\n", encoding="utf-8")
    tools = _build_conversation_tools(repo, None, object())
    search_code = tools["workspace.search_code"]

    result = await search_code({"query": "nonexistent_symbol_xyz", "path": "."}, {})
    assert "没有找到匹配" in result["answer"]
    assert "不要换 path 重复搜索" in result["answer"]


def test_is_symbol_lookup_query() -> None:
    """符号名猜测应被识别，自然语言检索不应误伤。"""
    for q in [
        "class Bash",
        "class Sandbox",
        "def create_sandbox",
        "def is_safe_command",
        "async def",
        "Bash(",
        "sandbox=",
        "_exit_code_hint",
        "_interpret_exit_code",
        "MAX_TIMEOUT",
        "truncated",
    ]:
        assert ChatAgent._is_symbol_lookup_query(q), q

    for q in [
        "how does sandbox work",
        "output truncation strategy",
        "",
        " ",
    ]:
        assert not ChatAgent._is_symbol_lookup_query(q), q


def test_step_budget_warning() -> None:
    """预算充足不提示，接近上限时注入收敛提示。"""
    agent = ChatAgent.__new__(ChatAgent)
    assert agent._step_budget_warning({"step": 0}) == ""
    assert agent._step_budget_warning({"step": 20}) == ""
    warning = agent._step_budget_warning({"step": agent.max_steps - 1})
    assert "步骤预算预警" in warning
    assert "不要再发起新的探索性工具调用" in warning


class SymbolExhaustionModel:
    """连续用不同符号名搜索代码（穷举符号）：第 4 次应被 guard 拦截。"""

    def __init__(self) -> None:
        self.calls = 0
        self.plan = ["class Bash", "class Sandbox", "def create_sandbox", "sandbox="]

    def bind_tools(self, tools: list[Any]) -> "SymbolExhaustionModel":
        self.tools = tools
        return self

    async def ainvoke(self, messages: list[Any]) -> AIMessage:
        self.calls += 1
        if self.calls <= len(self.plan):
            return AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "workspace__search_code",
                        "args": {"query": self.plan[self.calls - 1], "path": "kyncode"},
                        "id": f"call_search_{self.calls}",
                    },
                ],
            )
        return AIMessage(content="I will open the file directly instead.")


@pytest.mark.asyncio
async def test_chat_agent_guards_symbol_search_exhaustion() -> None:
    """连续穷举符号名（即使每个 query 都不同）应被 guard 引导改读文件。"""
    invocations = 0

    async def search_code(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        nonlocal invocations
        invocations += 1
        return {
            "route": "workspace_search_code",
            "tool_calls": [
                {
                    "tool_name": "workspace.search_code",
                    "arguments": input_data,
                    "status": "success",
                }
            ],
            "answer": "bash.py:12: class Bash",
            "citations": [],
        }

    agent = ChatAgent(model=SymbolExhaustionModel())  # type: ignore[arg-type]
    events = [
        event
        async for event in agent.run_stream(
            {"message": "How does the bash tool sandbox work?"},
            {"tools": {"workspace.search_code": search_code}},
        )
    ]

    final = [event for event in events if event["event"] == "final"][-1]["data"]
    # 前 3 次符号搜索执行，第 4 次被 guard 拦，之后模型改读文件作答。
    assert invocations == 3
    assert final["completion"]["status"] == "completed"
    assert final["answer"] == "I will open the file directly instead."
    assert any(
        event["type"] == "tool_loop_guard"
        and event["guard"] == "symbol_search_exhaustion"
        for event in final["agent_events"]
    )
