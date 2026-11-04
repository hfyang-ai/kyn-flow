from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from math import ceil
from typing import Any

import httpx

from app.core.config import settings

RATE_LIMIT_STATUSES = {403, 429}


def _reset_at(response: httpx.Response) -> datetime | None:
    """Return the UTC instant at which the rate limit window resets."""
    reset = response.headers.get("x-ratelimit-reset", "")
    if reset.isdigit():
        try:
            return datetime.fromtimestamp(int(reset), tz=UTC)
        except (OverflowError, OSError, ValueError):
            return None
    retry_after = response.headers.get("retry-after", "")
    if retry_after.isdigit():
        return datetime.now(UTC) + timedelta(seconds=int(retry_after))
    return None


def _is_rate_limited(response: httpx.Response) -> bool:
    """Tell a real rate limit apart from a plain 403 permission denial."""
    if response.status_code not in RATE_LIMIT_STATUSES:
        return False
    if response.headers.get("x-ratelimit-remaining") == "0":
        return True
    if response.headers.get("retry-after"):
        return True
    try:
        payload = response.json()
    except ValueError:
        return False
    message = payload.get("message") if isinstance(payload, dict) else None
    return isinstance(message, str) and "rate limit" in message.lower()


class GitHubRateLimitError(httpx.HTTPStatusError):
    """GitHub rejected the call because the API quota is exhausted.

    Subclasses ``httpx.HTTPStatusError`` so existing ``except httpx.HTTPError``
    call sites keep working while the message stays actionable.
    """

    def __init__(self, response: httpx.Response, *, authenticated: bool) -> None:
        self.status_code = response.status_code
        self.limit = response.headers.get("x-ratelimit-limit")
        self.remaining = response.headers.get("x-ratelimit-remaining")
        self.reset_at = _reset_at(response)
        self.authenticated = authenticated
        self.retry_after_seconds = (
            max(0, ceil((self.reset_at - datetime.now(UTC)).total_seconds()))
            if self.reset_at is not None
            else None
        )
        super().__init__(self._describe(), request=response.request, response=response)

    def _describe(self) -> str:
        quota = (
            f"{self.remaining}/{self.limit}"
            if self.remaining is not None and self.limit is not None
            else "已耗尽"
        )
        if self.retry_after_seconds is not None:
            minutes = max(1, ceil(self.retry_after_seconds / 60))
            clock = (
                self.reset_at.astimezone().strftime("%H:%M") if self.reset_at else ""
            )
            when = (
                f"约 {minutes} 分钟后（{clock}）" if clock else f"约 {minutes} 分钟后"
            )
        else:
            when = "稍后"
        hint = (
            ""
            if self.authenticated
            else "；当前为匿名访问（60 次/小时），配置 GITHUB_TOKEN 可提升至 5000 次/小时"
        )
        return f"GitHub 限流：剩余额度 {quota}，请{when}再试{hint}"


class PaginatedItems(list[dict]):
    """List-compatible result with coverage information for repository sync."""

    def __init__(self, items: list[dict], *, complete: bool, pages: int) -> None:
        super().__init__(items)
        self.complete = complete
        self.pages = pages


class GitHubClient:
    def __init__(self, token: str | None = None, base_url: str | None = None) -> None:
        self.token = token or settings.github_token
        self.base_url = (base_url or settings.github_api_base_url).rstrip("/")

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _raise_for_status(self, response: httpx.Response) -> None:
        """Raise with an actionable message when GitHub throttles the request."""
        if _is_rate_limited(response):
            raise GitHubRateLimitError(response, authenticated=bool(self.token))
        response.raise_for_status()

    async def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.get(
                f"{self.base_url}{path}", headers=self._headers(), params=params
            )
            self._raise_for_status(response)
            return response.json()

    async def get_paginated(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        *,
        item_key: str | None = None,
        limit: int | None = None,
        include: Callable[[dict], bool] | None = None,
    ) -> PaginatedItems:
        if limit is not None and limit < 1:
            raise ValueError("limit must be positive or None")
        query = dict(params or {})
        query["per_page"] = min(limit or 100, 100)
        url = f"{self.base_url}{path}"
        items: list[dict] = []
        visited: set[str] = set()
        pages = 0
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            while url:
                if url in visited:
                    raise ValueError("GitHub pagination returned a repeated next page")
                # Never forward the repository token to a different API origin.
                if (
                    httpx.URL(url).scheme != httpx.URL(self.base_url).scheme
                    or httpx.URL(url).netloc != httpx.URL(self.base_url).netloc
                ):
                    raise ValueError(
                        "GitHub pagination returned a different API origin"
                    )
                visited.add(url)
                response = await client.get(url, headers=self._headers(), params=query)
                self._raise_for_status(response)
                payload = response.json()
                batch = (
                    payload.get(item_key)
                    if item_key and isinstance(payload, dict)
                    else payload
                )
                if not isinstance(batch, list) or any(
                    not isinstance(item, dict) for item in batch
                ):
                    raise ValueError("GitHub list response has an unexpected shape")
                pages += 1
                accepted = [item for item in batch if include is None or include(item)]
                next_url = response.links.get("next", {}).get("url")
                if limit is not None and len(items) + len(accepted) >= limit:
                    remaining = limit - len(items)
                    items.extend(accepted[:remaining])
                    return PaginatedItems(
                        items,
                        complete=not next_url and len(accepted) <= remaining,
                        pages=pages,
                    )
                items.extend(accepted)
                url = str(response.url.join(next_url)) if next_url else ""
                query = None  # The Link URL already contains its pagination parameters.
        return PaginatedItems(items, complete=True, pages=pages)

    async def get_bytes(self, path: str, params: dict[str, Any] | None = None) -> bytes:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            response = await client.get(
                f"{self.base_url}{path}", headers=self._headers(), params=params
            )
            self._raise_for_status(response)
            return response.content

    async def post(self, path: str, payload: dict[str, Any]) -> Any:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.post(
                f"{self.base_url}{path}", headers=self._headers(), json=payload
            )
            self._raise_for_status(response)
            return response.json()

    async def patch(self, path: str, payload: dict[str, Any]) -> Any:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.patch(
                f"{self.base_url}{path}", headers=self._headers(), json=payload
            )
            self._raise_for_status(response)
            return response.json()

    async def get_repo(self, owner: str, repo: str) -> dict[str, Any]:
        return await self.get(f"/repos/{owner}/{repo}")

    async def create_issue_comment(
        self, owner: str, repo: str, issue_number: int, body: str
    ) -> dict[str, Any]:
        return await self.post(
            f"/repos/{owner}/{repo}/issues/{issue_number}/comments", {"body": body}
        )

    async def create_issue(
        self, owner: str, repo: str, title: str, body: str
    ) -> dict[str, Any]:
        return await self.post(
            f"/repos/{owner}/{repo}/issues", {"title": title, "body": body}
        )

    async def close_issue(
        self, owner: str, repo: str, issue_number: int
    ) -> dict[str, Any]:
        return await self.patch(
            f"/repos/{owner}/{repo}/issues/{issue_number}", {"state": "closed"}
        )

    async def add_issue_labels(
        self, owner: str, repo: str, issue_number: int, labels: list[str]
    ) -> dict[str, Any]:
        return await self.post(
            f"/repos/{owner}/{repo}/issues/{issue_number}/labels", {"labels": labels}
        )
