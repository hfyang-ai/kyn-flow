@echo off
setlocal
rem 切换到 UTF-8 代码页，避免中文乱码
chcp 65001 >nul

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

echo ========================================
echo        Kynflow 一键启动脚本
echo ========================================
echo.

echo [1/4] 检查依赖...
where docker >nul 2>nul
if errorlevel 1 (
    echo   错误: 未找到 docker，请先安装 Docker Desktop
    exit /b 1
)
where uv >nul 2>nul
if errorlevel 1 (
    echo   错误: 未找到 uv，请先安装 uv ^(https://docs.astral.sh/uv/^)
    exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
    echo   错误: 未找到 node，请先安装 Node.js
    exit /b 1
)
echo   OK: docker / uv / node 均已就绪
echo.

echo [2/4] 初始化配置文件...
if exist "%PROJECT_DIR%\.env" (
    echo   .env 已存在，跳过
) else (
    copy "%PROJECT_DIR%\.env.example" "%PROJECT_DIR%\.env" >nul
    echo   已从 .env.example 创建 .env
)
echo.

echo [3/4] 启动 Docker 服务（postgres, etcd, minio, milvus）...
cd /d "%PROJECT_DIR%"
docker compose up -d postgres etcd minio milvus
if errorlevel 1 (
    echo   错误: Docker 服务启动失败
    exit /b 1
)
echo   Docker 服务已启动
echo.

echo [4/4] 打开 Docker / 后端 / 前端窗口...
start "kynflow-docker" /D "%PROJECT_DIR%" cmd /k "docker compose logs -f postgres etcd minio milvus"
start "kynflow-backend" /D "%PROJECT_DIR%\backend" cmd /k "uv sync && uv run uvicorn app.main:app --reload"
start "kynflow-frontend" /D "%PROJECT_DIR%\frontend" cmd /k "npm install && npm run dev"

echo.
echo ========================================
echo   已打开 3 个独立窗口：
echo     - Docker 日志  (postgres / etcd / minio / milvus)
echo     - 后端 API      http://localhost:8000
echo     - 前端页面      http://localhost:3000
echo ========================================
echo   停止服务：在对应窗口按 Ctrl+C
echo.
endlocal
