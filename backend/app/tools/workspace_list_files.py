"""workspace.list_files 工具：列出工作区文件。"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.tools.context import ToolContext
from app.tools.workspace import (
    _iter_workspace_files,
    _workspace_path,
    _workspace_relative,
    _workspace_root,
)


class ListFilesParams(BaseModel):
    model_config = ConfigDict(extra="allow")

    path: str = Field(default=".", description="相对工作区的目录路径")
    pattern: str = Field(default="", description="文件名子串过滤，忽略大小写")
    limit: int = Field(default=80, ge=1, description="最多返回条数，上限 200")


async def list_workspace_files_tool(
    ctx: ToolContext, input_data: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    params = ListFilesParams.model_validate(input_data)
    workspace_root = _workspace_root(ctx.repo)
    root = _workspace_path(workspace_root, params.path)
    limit = min(max(params.limit, 1), 200)
    raw_pattern = params.pattern.strip().lower()
    rows: list[str] = []
    for path in _iter_workspace_files(root, workspace_root):
        relative = _workspace_relative(path, workspace_root)
        if raw_pattern and raw_pattern not in relative.lower():
            continue
        rows.append(relative)
        if len(rows) >= limit:
            break
    answer = "\n".join(rows) if rows else "没有找到匹配的工作区文件。"
    return {
        "route": "workspace_list_files",
        "tool_calls": [
            {
                "tool_name": "workspace.list_files",
                "arguments": {
                    "path": params.path,
                    "pattern": raw_pattern,
                    "limit": limit,
                },
                "status": "success",
            }
        ],
        "answer": answer,
        "citations": [
            {
                "type": "workspace",
                "id": str(workspace_root),
                "title": ctx.repo.full_name if ctx.repo else "项目工作区",
            }
        ],
    }
