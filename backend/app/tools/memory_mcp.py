"""通过 MCP 客户端访问记忆库的工具（证据搜索、线程上下文、会话事件）。

这三个工具共享同一条 MCP 调用通道，仅 tool_name 不同，因此放在同一文件。
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.tools.context import ToolContext


class SearchEvidenceParams(BaseModel):
    model_config = ConfigDict(extra="allow")

    query: str = Field(default="", description="检索查询或关键词")
    message: str = Field(
        default="", description="原始用户消息，query 为空时的回退"
    )
    limit: int = Field(default=5, ge=1, description="最多返回条数")


class ThreadContextParams(BaseModel):
    model_config = ConfigDict(extra="allow")

    query: str = Field(default="", description="检索查询或关键词")
    keyword: str = Field(default="", description="关键词过滤")
    limit: int = Field(default=20, ge=1, description="最多返回条数")
    max_chars: int = Field(default=12000, ge=1, description="最多返回字符数")
    message_id: str = Field(default="", description="精确读取的消息 UUID")
    session_id: str = Field(default="", description="会话片段 UUID")
    include_transcript: bool = Field(
        default=False, description="是否包含原始 transcript"
    )


async def _call_memory_mcp(
    ctx: ToolContext,
    tool_name: str,
    input_data: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    arguments = dict(input_data)
    if ctx.repo:
        arguments["repo_id"] = str(ctx.repo.id)
    if ctx.conversation:
        arguments["conversation_id"] = str(ctx.conversation.id)
    if tool_name == "kynflow_search_evidence":
        arguments.setdefault("query", input_data.get("message") or "")
    result = await ctx.mcp_client.call_tool(tool_name, arguments)
    text_parts = [
        str(item.get("text") or "")
        for item in result.get("content", [])
        if isinstance(item, dict) and item.get("type") == "text"
    ]
    return {
        "route": tool_name.replace("kynflow_", ""),
        "tool_calls": [
            {"tool_name": tool_name, "arguments": arguments, "status": "success"}
        ],
        "answer": "\n".join(text_parts).strip(),
        "citations": [],
    }


def build_memory_mcp_tools(ctx: ToolContext) -> dict[str, Any]:
    async def search_evidence_mcp(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        return await _call_memory_mcp(
            ctx, "kynflow_search_evidence", input_data, context
        )

    async def get_thread_context_mcp(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        return await _call_memory_mcp(
            ctx, "kynflow_get_thread_context", input_data, context
        )

    async def read_session_events_mcp(
        input_data: dict[str, Any], context: dict[str, Any]
    ) -> dict[str, Any]:
        return await _call_memory_mcp(
            ctx, "kynflow_read_session_events", input_data, context
        )

    return {
        "kynflow_search_evidence": search_evidence_mcp,
        "kynflow_get_thread_context": get_thread_context_mcp,
        "kynflow_read_session_events": read_session_events_mcp,
    }
