"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";

import { apiGet } from "@/lib/api";
import type { Repository } from "@/lib/types";
import { PageTitle } from "@/components/ui/card";
import { getFriendlyError } from "@/app/home/utils";

import {
  AgentRunList,
  AuditLogList,
  ChatMessageList,
  WorkflowLogList,
} from "./components/entries";
import {
  dayEndIso,
  dayStartIso,
  formatDateTime,
  logTabs,
  rangeForPreset,
  todayInput,
  type DateRangePreset,
} from "./utils";
import type {
  AgentRunLog,
  AuditLogEntry,
  ChatMessageLog,
  LogPageResponse,
  LogSummary,
  LogTab,
  WorkflowRunLog,
} from "./types";

const PAGE_SIZE = 20;

const presets: Array<{ key: DateRangePreset; label: string }> = [
  { key: "today", label: "今天" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "all", label: "全部" },
];

const statusOptions: Record<LogTab, string[]> = {
  "agent-runs": ["success", "failed"],
  "chat-messages": [],
  "audit-logs": ["success", "failed"],
  workflows: ["success", "failed", "partial"],
};

const initialRange = rangeForPreset("7d");

export default function LogsPage() {
  const [tab, setTab] = useState<LogTab>("agent-runs");
  const [preset, setPreset] = useState<DateRangePreset>("7d");
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [repoId, setRepoId] = useState("");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [page, setPage] = useState(0);

  const [repos, setRepos] = useState<Repository[]>([]);
  const [summary, setSummary] = useState<LogSummary | null>(null);
  const [items, setItems] = useState<
    AgentRunLog[] | ChatMessageLog[] | AuditLogEntry[] | WorkflowRunLog[]
  >([]);
  const [total, setTotal] = useState(0);
  // 记录当前 items 属于哪个 tab：切换 tab 后 React 会先用旧数据重渲染，
  // 若不校验就会把 AgentRunLog 喂给 ChatMessageList（缺 content 字段）直接崩。
  const [loadedTab, setLoadedTab] = useState<LogTab | null>(null);
  const [window, setWindow] = useState<{ start?: string | null; end?: string | null }>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 递增序号：快速连点 tab 时只认最后一次请求，避免旧响应覆盖新 tab 的数据。
  const requestSeq = useRef(0);

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((rows) => setRepos(rows))
      .catch(() => setRepos([]));
  }, []);

  const loadSummary = useCallback(async () => {
    const params = new URLSearchParams();
    if (start) params.set("start", dayStartIso(start));
    if (end) params.set("end", dayEndIso(end));
    if (repoId) params.set("repo_id", repoId);
    try {
      setSummary(await apiGet<LogSummary>(`/api/logs/summary?${params.toString()}`));
    } catch {
      setSummary(null);
    }
  }, [start, end, repoId]);

  const loadEntries = useCallback(async () => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (start) params.set("start", dayStartIso(start));
    if (end) params.set("end", dayEndIso(end));
    if (repoId) params.set("repo_id", repoId);
    if (status) params.set("status", status);
    if (appliedKeyword.trim()) params.set("q", appliedKeyword.trim());
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<LogPageResponse<unknown>>(
        `/api/logs/${tab}?${params.toString()}`,
      );
      if (seq !== requestSeq.current) return;
      setItems(
        data.items as AgentRunLog[] | ChatMessageLog[] | AuditLogEntry[] | WorkflowRunLog[],
      );
      setTotal(data.total);
      setWindow({ start: data.start, end: data.end });
      setLoadedTab(tab);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(getFriendlyError(err));
      setItems([]);
      setTotal(0);
      setLoadedTab(tab);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [tab, page, start, end, repoId, status, appliedKeyword]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const activeTab = useMemo(() => logTabs.find((item) => item.key === tab)!, [tab]);
  // 只有拿到「与当前 tab 对应」的数据才渲染列表，避免跨 tab 的类型错配。
  const listReady = loadedTab === tab;

  function applyPreset(next: DateRangePreset) {
    const range = rangeForPreset(next);
    setPreset(next);
    setStart(range.start);
    setEnd(range.end);
    setPage(0);
  }

  function submitKeyword() {
    setAppliedKeyword(keyword);
    setPage(0);
  }

  function refresh() {
    void loadEntries();
    void loadSummary();
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <>
      <PageTitle
        title="日志"
        description="四类运行记录的统一只读视图：问答全链路、单条消息的 token 与上下文诊断、操作审计、多 Agent 协作轨迹。"
      />

      <section className="flex flex-wrap items-end gap-x-4 gap-y-3 border-y border-line bg-panel px-4 py-3">
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">日期范围</div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={start}
              max={end || todayInput()}
              onChange={(event) => {
                setStart(event.target.value);
                setPreset("all");
                setPage(0);
              }}
              className="h-9 rounded-md border border-line bg-panel px-2 text-xs text-ink outline-none focus:border-sage-600"
              aria-label="开始日期"
            />
            <span className="text-xs text-faint">→</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(event) => {
                setEnd(event.target.value);
                setPreset("all");
                setPage(0);
              }}
              className="h-9 rounded-md border border-line bg-panel px-2 text-xs text-ink outline-none focus:border-sage-600"
              aria-label="结束日期"
            />
          </div>
        </div>

        <div className="flex items-center gap-1">
          {presets.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => applyPreset(item.key)}
              className={`h-9 rounded-md border px-2.5 text-xs font-medium transition ${
                preset === item.key
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-line bg-panel text-muted hover:bg-panel-2 hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
          {!start && !end && <span className="ml-1 text-[11px] text-faint">不限时间</span>}
        </div>

        <label className="text-[11px] font-medium text-muted">
          项目
          <select
            value={repoId}
            onChange={(event) => {
              setRepoId(event.target.value);
              setPage(0);
            }}
            className="mt-1 block h-9 min-w-[180px] rounded-md border border-line bg-panel px-2 text-xs text-ink outline-none focus:border-sage-600"
          >
            <option value="">全部项目</option>
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.full_name}
              </option>
            ))}
          </select>
        </label>

        {statusOptions[tab].length > 0 && (
          <label className="text-[11px] font-medium text-muted">
            状态
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
              className="mt-1 block h-9 min-w-[120px] rounded-md border border-line bg-panel px-2 text-xs text-ink outline-none focus:border-sage-600"
            >
              <option value="">全部状态</option>
              {statusOptions[tab].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="text-[11px] font-medium text-muted">
          关键词
          <div className="mt-1 flex h-9 items-center gap-1 rounded-md border border-line bg-panel px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitKeyword();
              }}
              placeholder="搜索正文 / 路由 / 动作"
              className="w-44 bg-transparent text-xs text-ink outline-none placeholder:text-faint"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => {
                  setKeyword("");
                  setAppliedKeyword("");
                  setPage(0);
                }}
                className="text-[11px] text-faint transition hover:text-ink"
              >
                清除
              </button>
            )}
          </div>
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={submitKeyword}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-accent-ink transition hover:bg-accent-bright"
          >
            <Search className="h-3.5 w-3.5" />
            查询
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-panel px-3 text-xs font-medium text-ink transition hover:bg-panel-2 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-1.5">
          {logTabs.map((item) => {
            const active = item.key === tab;
            const count = summary ? summary[item.summaryKey] : null;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setTab(item.key);
                  setStatus("");
                  setPage(0);
                }}
                aria-current={active ? "true" : undefined}
                className={`w-full rounded-md border px-3 py-2.5 text-left transition ${
                  active
                    ? "border-accent bg-sage-50"
                    : "border-line bg-panel hover:bg-panel-2"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-sm ${active ? "font-semibold text-ink" : "font-medium text-muted"}`}
                  >
                    {item.label}
                  </span>
                  <span
                    className={`font-mono text-[11px] ${active ? "text-accent" : "text-faint"}`}
                  >
                    {count === null ? "–" : count}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-faint">{item.description}</p>
              </button>
            );
          })}
          <p className="pt-1 text-[11px] leading-5 text-faint">
            统计窗口
            {window.start
              ? `：${formatDateTime(window.start)} → ${formatDateTime(window.end)}`
              : "：不限时间"}
          </p>
        </aside>

        <main className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">{activeTab.label}</h2>
            <span className="text-[11px] text-faint">
              {!listReady || loading ? "读取中…" : `共 ${total} 条`}
            </span>
          </div>

          {error && (
            <div className="mb-2 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1 break-words">{error}</div>
              <button
                type="button"
                onClick={refresh}
                className="shrink-0 font-medium underline-offset-2 hover:underline"
              >
                重试
              </button>
            </div>
          )}

          {!listReady ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-line bg-panel px-4 py-10 text-sm text-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取日志…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-md border border-dashed border-line bg-panel px-4 py-10 text-center text-sm text-faint">
              当前时间窗口内没有记录。
              <div className="mt-1 text-xs">试着放宽日期范围、清空项目/状态过滤，或调整关键词。</div>
            </div>
          ) : (
            <>
              {tab === "agent-runs" && <AgentRunList items={items as AgentRunLog[]} />}
              {tab === "chat-messages" && (
                <ChatMessageList items={items as ChatMessageLog[]} />
              )}
              {tab === "audit-logs" && <AuditLogList items={items as AuditLogEntry[]} />}
              {tab === "workflows" && <WorkflowLogList items={items as WorkflowRunLog[]} />}
            </>
          )}

          {listReady && total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-[11px] text-faint">
              <span>
                第 {from}-{to} 条 / 共 {total} 条
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                  disabled={page === 0 || loading}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-panel px-2 font-medium text-ink transition hover:bg-panel-2 disabled:opacity-50"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => setPage((value) => value + 1)}
                  disabled={to >= total || loading}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-panel px-2 font-medium text-ink transition hover:bg-panel-2 disabled:opacity-50"
                >
                  下一页
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
