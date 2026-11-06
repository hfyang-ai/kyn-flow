"""工具执行的共享上下文。

每个对话工具都接收一个 :class:`ToolContext`，携带仓库、会话、数据库会话和
MCP 客户端，避免在 chat 路由层用闭包捕获这些依赖。
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.db.models import Conversation, Repository
from app.services.mcp_client import StdioMcpClient


@dataclass
class ToolContext:
    repo: Repository | None
    conversation: Conversation | None
    db: Session
    mcp_client: StdioMcpClient


def agent_context(context: dict[str, Any]) -> dict[str, Any]:
    """剥离服务端注入字段，只保留可安全传给子 Agent 的客户端上下文。"""
    return {
        key: value
        for key, value in context.items()
        if key not in {"tools", "_skill_registry"}
    }
