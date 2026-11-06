"""workspace.search_code 工具：在工作区代码中检索关键词。"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.services.code_search import query_terms, search_checkout_code
from app.tools.context import ToolContext
from app.tools.workspace import _workspace_path, _workspace_root


class SearchCodeParams(BaseModel):
    model_config = ConfigDict(extra="allow")

    query: str = Field(default="", description="搜索关键词或代码片段")
    message: str = Field(
        default="", description="原始用户消息，query 为空时的回退"
    )
    path: str = Field(default=".", description="限定搜索目录")
    limit: int = Field(default=12, ge=1, description="最多返回条数，上限 50")


async def search_workspace_code_tool(
    ctx: ToolContext, input_data: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    params = SearchCodeParams.model_validate(input_data)
    query = (params.query or params.message).strip()
    if not query_terms(query):
        raise ValueError("query 为必填项")
    workspace_root = _workspace_root(ctx.repo)
    relative_path = params.path
    _workspace_path(workspace_root, relative_path)
    limit = min(max(params.limit, 1), 50)
    matches = search_checkout_code(
        workspace_root, query, limit=limit, relative_path=relative_path
    )
    rows = [item["snippet"] for item in matches]
    citations = [
        {"type": "workspace_file", "id": item["source_id"], "title": item["title"]}
        for item in matches
    ]
    # 空/少结果时显式提示换策略，避免模型换 path 重搜同一个词陷入死循环。
    if not rows:
        answer = (
            f"没有找到匹配「{query}」的工作区代码。"
            "请不要换 path 重复搜索同一个词；请换一个更精确或不同的关键词，"
            "或改用 read_file 直接读文件。"
        )
    elif len(rows) < 2:
        answer = (
            f"只找到 {len(rows)} 条匹配「{query}」的结果：\n"
            + "\n".join(rows)
            + "\n若结果不足以回答问题，请换关键词或改用 read_file 读文件，"
            "不要换 path 重复搜索同一个词。"
        )
    else:
        answer = "\n".join(rows)
    return {
        "route": "workspace_search_code",
        "tool_calls": [
            {
                "tool_name": "workspace.search_code",
                "arguments": {
                    "query": query,
                    "path": relative_path,
                    "limit": limit,
                },
                "status": "success",
            }
        ],
        "answer": answer,
        "citations": citations,
    }
