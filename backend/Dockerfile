# Kynflow backend — uv-managed Python 3.12 image
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# 编译字节码加速启动；Docker 里用 copy 模式避免 hardlink 跨层问题
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# 先只复制依赖清单，最大化利用 Docker 层缓存
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# 复制应用源码（package = false，项目本身不安装，直接跑）
COPY app ./app

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
