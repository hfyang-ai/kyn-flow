"""workspace.read_file 工具：读取工作区文件指定行区间。"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.tools.context import ToolContext
from app.tools.workspace import (
    _read_workspace_text,
    _workspace_path,
    _workspace_relative,
    _workspace_root,
)

MAX_LINES = 800


class ReadFileParams(BaseModel):
    model_config = ConfigDict(extra="allow")

    path: str = Field(min_length=1, description="相对工作区的文件路径")
    start_line: int = Field(default=1, ge=1, description="起始行号，从 1 开始")
    line_count: int = Field(
        default=160, ge=1, description=f"最多读取多少行，上限 {MAX_LINES}"
    )


async def read_workspace_file_tool(
    ctx: ToolContext, input_data: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    params = ReadFileParams.model_validate(input_data)
    workspace_root = _workspace_root(ctx.repo)
    path = _workspace_path(workspace_root, params.path)
    text = _read_workspace_text(path)
    lines = text.splitlines()
    total_lines = len(lines)
    requested_start = params.start_line
    line_count = min(params.line_count, MAX_LINES)
    relative = _workspace_relative(path, workspace_root)
    if total_lines == 0:
        start_line = 0
        end_line = 0
        answer = f"{relative}: 空文件（0 行）"
    elif requested_start > total_lines:
        start_line = total_lines
        end_line = total_lines
        answer = (
            f"{relative} 共 {total_lines} 行，start_line={requested_start} 超出范围；"
            f"可用范围是 1-{total_lines}。"
        )
    else:
        start_line = requested_start
        end_line = min(start_line + line_count - 1, total_lines)
        numbered = [
            f"{line_number}: {lines[line_number - 1]}"
            for line_number in range(start_line, end_line + 1)
        ]
        # 头部一次交代「读到哪、还剩多少、下一步从哪读」。这段位于 answer 开头，
        # 即使后续被 token 预算从尾部截断也一定保留，模型不需要靠换 start_line /
        # line_count 反复试探才能把文件读完。
        header = f"{relative}:{start_line}-{end_line}（共 {total_lines} 行"
        if params.line_count > MAX_LINES:
            header += f"，单次最多返回 {MAX_LINES} 行"
        remaining = total_lines - end_line
        if remaining > 0:
            header += f"，还有 {remaining} 行未读，续读请用 start_line={end_line + 1}"
        else:
            header += "，已读到文件末尾"
        answer = f"{header}）\n" + "\n".join(numbered)
    return {
        "route": "workspace_read_file",
        "tool_calls": [
            {
                "tool_name": "workspace.read_file",
                "arguments": {
                    "path": relative,
                    "start_line": start_line,
                    "line_count": line_count,
                },
                "status": "success",
            }
        ],
        "answer": answer,
        "citations": [{"type": "workspace_file", "id": relative, "title": relative}],
        "read_range": {
            "path": relative,
            "start_line": start_line,
            "end_line": end_line,
            "total_lines": total_lines,
            "truncated": end_line < total_lines,
            "next_start_line": end_line + 1 if end_line < total_lines else None,
        },
    }
