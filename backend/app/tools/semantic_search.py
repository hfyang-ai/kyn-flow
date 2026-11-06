"""rag.search_similar_documents 工具：语义检索历史记录。"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.services.memory_hub import record_recall_event
from app.tools.context import ToolContext
from app.tools.helpers import _semantic_search
from app.tools.repo_health import repo_health_tool


class SemanticSearchParams(BaseModel):
    model_config = ConfigDict(extra="allow")

    query: str = Field(default="", description="改写后的检索查询")
    message: str = Field(
        default="", description="原始用户消息，query 为空时的回退"
    )


async def semantic_search_tool(
    ctx: ToolContext, input_data: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    if ctx.repo is None:
        return await repo_health_tool(ctx, input_data, context)
    params = SemanticSearchParams.model_validate(input_data)
    original_message = params.message.strip()
    query = (params.query or original_message).strip()
    if not query:
        raise ValueError("query 为必填项")
    answer, citations, results = _semantic_search(ctx.repo, query, context, ctx.db)
    record_recall_event(
        ctx.db,
        repo_id=ctx.repo.id,
        conversation_id=ctx.conversation.id if ctx.conversation else None,
        tool_name="rag.search_similar_documents",
        query=query,
        results=results,
        citations=citations,
        scope="conversation" if ctx.conversation else "project",
        mode="hybrid",
        metadata={
            "source_type": context.get("source_type"),
            "limit": context.get("limit", 5),
            "original_message": original_message,
            "query_rewritten": bool(original_message and query != original_message),
        },
    )
    return {
        "route": "semantic_search",
        "tool_calls": [
            {
                "tool_name": "rag.search_similar_documents",
                "arguments": {"repo_id": str(ctx.repo.id), "query": query},
                "status": "success",
            }
        ],
        "answer": answer,
        "citations": citations,
        "retrieved_contexts": [
            str(item.get("snippet") or "")
            for item in results
            if str(item.get("snippet") or "").strip()
        ],
        "retrieval_results": [
            {
                "id": str(item.get("id") or ""),
                "source_id": str(item.get("source_id") or ""),
                "source_type": str(item.get("source_type") or ""),
                "title": str(item.get("title") or ""),
                "score": item.get("score"),
                "snippet": str(item.get("snippet") or ""),
                "retrieval": item.get("retrieval") or {},
            }
            for item in results
        ],
    }
