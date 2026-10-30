#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ===== OS 检测 =====
# Darwin = macOS；Linux = 各类 Linux 发行版；MINGW/MSYS/CYGWIN = Windows 上的 Git Bash 等环境
OS_TYPE="$(uname -s)"
IS_MACOS=0
IS_LINUX=0
IS_WINDOWS=0
case "$OS_TYPE" in
    Darwin) IS_MACOS=1 ;;
    Linux)  IS_LINUX=1 ;;
    MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
esac

# Windows（Git Bash 等）无法运行本脚本，引导到 start.bat
if [ "$IS_WINDOWS" = "1" ]; then
    echo -e "${YELLOW}检测到 Windows（Git Bash/MSYS）环境，请改用 Windows 启动脚本：${NC}"
    echo -e "${CYAN}  start.bat   （在 cmd / PowerShell 中运行，或双击）${NC}"
    exit 0
fi

# macOS：检测终端应用
if [ "$IS_MACOS" = "1" ]; then
    if [ -d "/Applications/iTerm.app" ]; then
        TERMINAL_APP="iTerm"
    else
        TERMINAL_APP="Terminal"
    fi
fi

# Linux：检测 tmux（用于分窗口看日志）
HAS_TMUX=0
if [ "$IS_LINUX" = "1" ] && command -v tmux &>/dev/null; then
    HAS_TMUX=1
fi

# docker compose 命令（兼容 v2「docker compose」与 v1「docker-compose」）
if docker compose version &>/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    DOCKER_COMPOSE=""
fi

# 在同一个终端窗口内新建一个 tab 并执行命令（仅 macOS）
# 首次调用会自动创建窗口，后续调用都在该窗口内开新 tab
# $1: tab 标题  $2: 要执行的命令
open_terminal() {
    local title="$1"
    local cmd="$2"
    # ESC ]0; <title> BEL 用于设置 tab 标题
    local prefix="printf '\\033]0;${title}\\007'"

    if [ "$TERMINAL_APP" = "iTerm" ]; then
        osascript -e "on run argv" \
            -e "tell application \"iTerm\"" \
            -e "activate" \
            -e "if (count of windows) = 0 then" \
            -e "  create window with default profile" \
            -e "else" \
            -e "  tell current window to create tab with default profile" \
            -e "end if" \
            -e "tell current session of current window to write text (item 1 of argv)" \
            -e "end tell" \
            -e "end run" "${prefix}; ${cmd}" >/dev/null || true
    else
        osascript -e "on run argv" \
            -e "tell application \"Terminal\"" \
            -e "activate" \
            -e "if (count of windows) = 0 then" \
            -e "  do script (item 1 of argv)" \
            -e "else" \
            -e "  do script (item 1 of argv) in front window" \
            -e "end if" \
            -e "end tell" \
            -e "end run" "${prefix}; ${cmd}" >/dev/null || true
    fi
}

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}       Kynflow 一键启动脚本${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 1. 检查依赖
echo -e "${YELLOW}[1/4] 检查依赖...${NC}"

if ! command -v docker &>/dev/null; then
    echo -e "${RED}错误: 未找到 docker，请先安装 Docker${NC}"
    exit 1
fi

if [ -z "$DOCKER_COMPOSE" ]; then
    echo -e "${RED}错误: 未找到 docker compose（v2 或 v1 均可）${NC}"
    exit 1
fi

if ! command -v uv &>/dev/null; then
    echo -e "${RED}错误: 未找到 uv，请先安装 uv (https://docs.astral.sh/uv/)${NC}"
    exit 1
fi

if ! command -v node &>/dev/null; then
    echo -e "${RED}错误: 未找到 node，请先安装 Node.js${NC}"
    exit 1
fi

echo -e "${GREEN}  ✓ docker $(docker --version | awk '{print $3}' | tr -d ',')${NC}"
echo -e "${GREEN}  ✓ uv $(uv --version | awk '{print $2}')${NC}"
echo -e "${GREEN}  ✓ node $(node --version)${NC}"
echo ""

# 2. 初始化 .env
echo -e "${YELLOW}[2/4] 初始化配置文件...${NC}"

if [ -f "$PROJECT_DIR/.env" ]; then
    echo -e "${GREEN}  ✓ .env 已存在，跳过${NC}"
else
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    echo -e "${GREEN}  ✓ 已从 .env.example 创建 .env，请根据需要编辑配置${NC}"
fi
echo ""

# 3. 启动 Docker 服务
echo -e "${YELLOW}[3/4] 启动 Docker 服务（postgres, etcd, minio, milvus）...${NC}"

cd "$PROJECT_DIR"
$DOCKER_COMPOSE up -d postgres etcd minio milvus
echo -e "${GREEN}  ✓ Docker 服务已启动${NC}"
echo ""

# 4. 分别打开 Docker / 后端 / 前端终端
echo -e "${YELLOW}[4/4] 打开 Docker / 后端 / 前端终端...${NC}"
echo ""

if [ "$IS_MACOS" = "1" ]; then
    open_terminal "kynflow-docker" "cd '$PROJECT_DIR' && $DOCKER_COMPOSE logs -f postgres etcd minio milvus"
    open_terminal "kynflow-backend" "cd '$PROJECT_DIR/backend' && uv sync && uv run uvicorn app.main:app --reload"
    open_terminal "kynflow-frontend" "cd '$PROJECT_DIR/frontend' && npm install && npm run dev"

    echo -e "${CYAN}========================================${NC}"
    echo -e "${GREEN}  已在同一窗口新建 3 个终端标签页：${NC}"
    echo -e "${GREEN}    · Docker 日志  (postgres / etcd / minio / milvus)${NC}"
    echo -e "${GREEN}    · 后端 API      http://localhost:8000${NC}"
    echo -e "${GREEN}    · 前端页面      http://localhost:3000${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo -e "${YELLOW}  停止服务：在对应标签页按 Ctrl+C${NC}"
    echo -e "${YELLOW}  提示：首次运行若弹出「允许控制终端」的授权请求，请点允许${NC}"
    echo ""
elif [ "$IS_LINUX" = "1" ] && [ "$HAS_TMUX" = "1" ]; then
    # 已存在同名会话则先清理（视为重启）
    tmux has-session -t kynflow 2>/dev/null && tmux kill-session -t kynflow

    tmux new-session -d -s kynflow -n docker "cd $PROJECT_DIR && $DOCKER_COMPOSE logs -f postgres etcd minio milvus"
    tmux new-window -t kynflow -n backend "cd $PROJECT_DIR/backend && uv sync && uv run uvicorn app.main:app --reload"
    tmux new-window -t kynflow -n frontend "cd $PROJECT_DIR/frontend && npm install && npm run dev"

    echo -e "${CYAN}========================================${NC}"
    echo -e "${GREEN}  已在 tmux 会话 kynflow 中创建 3 个窗口：${NC}"
    echo -e "${GREEN}    · docker   Docker 日志  (postgres / etcd / minio / milvus)${NC}"
    echo -e "${GREEN}    · backend  后端 API      http://localhost:8000${NC}"
    echo -e "${GREEN}    · frontend 前端页面      http://localhost:3000${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo -e "${YELLOW}  切换窗口: Ctrl+B 然后按 0/1/2${NC}"
    echo -e "${YELLOW}  分离会话: Ctrl+B 然后按 D（重新进入用 tmux attach -t kynflow）${NC}"
    echo ""
    tmux attach -t kynflow
else
    # 兜底：Linux 无 tmux 或其它 Unix 环境，退回后台启动，日志输出到当前终端
    echo -e "${YELLOW}  当前环境无 tmux，改用后台启动（日志输出到当前终端）...${NC}"
    echo ""

    (cd "$PROJECT_DIR/backend" && uv sync && uv run uvicorn app.main:app --reload) &
    (cd "$PROJECT_DIR/frontend" && npm install && npm run dev) &

    echo -e "${GREEN}  后端 API:     http://localhost:8000${NC}"
    echo -e "${GREEN}  前端页面:     http://localhost:3000${NC}"
    echo -e "${YELLOW}  按 Ctrl+C 停止所有服务${NC}"
    echo ""
    wait
fi
