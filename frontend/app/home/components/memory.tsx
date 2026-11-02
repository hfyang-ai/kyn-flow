"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock3,
  Database,
  FileText,
  Folder,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";
import type {
  KnowledgeItem,
  MemoryCandidate,
  MemoryNote,
  MemoryNoteDraft,
  MemorySearchResult,
  MemoryStatus,
  ProjectIndexState,
  RecallEvent,
} from "../types";
import {
  formatDateTime,
  getFriendlyError,
  knowledgeTypeLabel,
  memoryCandidateKindLabel,
  numberFromUnknown,
  recordFromUnknown,
} from "../utils";

export function MemoryIndexPromptCard({
  repo,
  state,
  scanning,
  error,
  onStartScan,
  onSnooze,
}: {
  repo: Repository;
  state: ProjectIndexState;
  scanning: boolean;
  error: string | null;
  onStartScan: () => void;
  onSnooze: () => void;
}) {
  const isFailed = state.status === "failed";
  const isStale = state.status === "stale";
  const title = scanning
    ? "正在建立项目记忆索引..."
    : isFailed
      ? "记忆索引构建失败"
      : isStale
        ? "记忆索引已过期"
        : "这个项目还没有记忆索引";
  const description = scanning
    ? "正在扫描项目文档、README 和配置清单，完成后 Agent 就能在当前仓库里检索这些上下文。"
    : isFailed
      ? `项目 ${repo.full_name} 上次扫描没有完成：${state.error_message || error || "未知错误"}`
      : isStale
        ? `项目 ${repo.full_name} 的本地内容已变化，建议更新索引，让回答保持新鲜。`
        : "建立索引后，Kynflow 可以检索项目说明、架构文档、ADR、计划和经验记录，不必每次从零开始。";
  const actionLabel = scanning
    ? "扫描中..."
    : isFailed
      ? "重试扫描"
      : isStale
        ? "更新索引"
        : "开始扫描";

  return (
    <div className="flex justify-start">
      <div className="w-full rounded-md border border-sage-800 bg-panel px-4 py-4 text-sm shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-sage-900 text-accent">
            {isFailed ? (
              <AlertTriangle className="h-5 w-5" />
            ) : scanning ? (
              <RefreshCw className="h-5 w-5 animate-spin" />
            ) : (
              <Database className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ink">{title}</div>
            <p className="mt-1 text-xs leading-5 text-stone-400">{description}</p>
            {!isFailed && (
              <div className="mt-3 grid gap-2 text-xs text-stone-400 sm:grid-cols-3">
                <div className="inline-flex items-center gap-1.5">
                  <Folder className="h-3.5 w-3.5 text-accent" />
                  README / docs / manifest
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5 text-accent" />
                  后台扫描，可继续对话
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                  仅写入本地知识库
                </div>
              </div>
            )}
            {error && !isFailed && (
              <div className="mt-3 rounded-md border border-rose-800/60 bg-rose-900/40 px-3 py-2 text-xs text-rose-300">
                {error}
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={onSnooze}
                disabled={scanning}
                className="rounded-md border border-line bg-panel px-3 py-2 text-xs font-medium text-stone-400 transition hover:bg-panel disabled:opacity-60"
              >
                稍后再说
              </button>
              <button
                onClick={onStartScan}
                disabled={scanning}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-[#062a1d] transition hover:bg-sage-400 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
                {actionLabel}
              </button>
              <span className="text-xs text-stone-500">
                稍后提醒会冷却 7 天，也可以在知识库页手动管理索引内容。
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MemoryHubWorkspace({
  repoId,
  notes,
  draft,
  knowledgeItems,
  uploading,
  onDraftChange,
  onAddNote,
  onRemoveNote,
  onUploadFile,
  onRemoveKnowledgeItem,
  onRefreshKnowledge,
}: {
  repoId?: string;
  notes: MemoryNote[];
  draft: MemoryNoteDraft;
  knowledgeItems: KnowledgeItem[];
  uploading: boolean;
  onDraftChange: (value: MemoryNoteDraft) => void;
  onAddNote: () => void;
  onRemoveNote: (noteId: string) => void;
  onUploadFile: (file: File) => void;
  onRemoveKnowledgeItem: (item: KnowledgeItem) => void;
  onRefreshKnowledge: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"recall" | "search" | "status" | "review">("recall");
  const [recallEvents, setRecallEvents] = useState<RecallEvent[]>([]);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemorySearchResult[]>([]);
  const [loadingPanel, setLoadingPanel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visibleKnowledgeItems = knowledgeItems.filter(
    (item) => item.source_type !== "memory_note" && item.source_type !== "team_member",
  );

  async function loadRecallEvents() {
    if (!repoId) return;
    setLoadingPanel("recall");
    setError(null);
    try {
      setRecallEvents(
        await apiGet<RecallEvent[]>(`/api/repos/${repoId}/memory/recall-events?limit=30`),
      );
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === "recall" ? null : current));
    }
  }

  async function loadMemoryStatus() {
    if (!repoId) return;
    setLoadingPanel("status");
    setError(null);
    try {
      setMemoryStatus(await apiGet<MemoryStatus>(`/api/repos/${repoId}/memory/status`));
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === "status" ? null : current));
    }
  }

  async function loadCandidates(status = "pending") {
    if (!repoId) return;
    setLoadingPanel("review");
    setError(null);
    try {
      setCandidates(
        await apiGet<MemoryCandidate[]>(
          `/api/repos/${repoId}/memory/candidates?status=${encodeURIComponent(status)}&limit=50`,
        ),
      );
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === "review" ? null : current));
    }
  }

  async function runMemorySearch() {
    if (!repoId || !searchQuery.trim()) return;
    setLoadingPanel("search");
    setError(null);
    try {
      const response = await apiGet<{ results: MemorySearchResult[] }>(
        `/api/repos/${repoId}/memory/search?q=${encodeURIComponent(searchQuery.trim())}&limit=10`,
      );
      setSearchResults(response.results);
      await loadRecallEvents();
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === "search" ? null : current));
    }
  }

  async function approveCandidate(candidateId: string) {
    if (!repoId) return;
    setLoadingPanel(candidateId);
    setError(null);
    try {
      await apiPost(`/api/repos/${repoId}/memory/candidates/${candidateId}/approve`, {});
      await Promise.all([loadCandidates(), loadMemoryStatus()]);
      onRefreshKnowledge();
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === candidateId ? null : current));
    }
  }

  async function rejectCandidate(candidateId: string) {
    if (!repoId) return;
    setLoadingPanel(candidateId);
    setError(null);
    try {
      await apiPost(`/api/repos/${repoId}/memory/candidates/${candidateId}/reject`, {});
      await Promise.all([loadCandidates(), loadMemoryStatus()]);
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === candidateId ? null : current));
    }
  }

  useEffect(() => {
    if (!repoId) return;
    loadRecallEvents();
    loadMemoryStatus();
    loadCandidates();
  }, [repoId]);

  const tabs = [
    { id: "recall", label: "召回记录" },
    { id: "search", label: "搜索" },
    { id: "status", label: "索引状态" },
    { id: "review", label: "待确认知识" },
  ] as const;
  const vectorRuntime = recordFromUnknown(memoryStatus?.vector);
  const vectorEmbedding = recordFromUnknown(vectorRuntime.embedding);
  const vectorBackend = memoryStatus
    ? `${String(vectorRuntime.backend ?? "未配置")} · ${String(vectorRuntime.status ?? "unknown")}`
    : "未加载";

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-md border border-line bg-panel p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === tab.id ? "bg-accent text-[#062a1d]" : "text-stone-300 hover:bg-panel"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-800/60 bg-red-900/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {activeTab === "recall" && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">召回记录</h3>
            <button
              type="button"
              onClick={loadRecallEvents}
              className="rounded-md border border-line px-2 py-1 text-xs text-stone-300 hover:bg-panel"
            >
              刷新
            </button>
          </div>
          {loadingPanel === "recall" && (
            <div className="rounded-md border border-line bg-panel p-4 text-sm text-stone-400">
              正在读取召回记录...
            </div>
          )}
          {!loadingPanel && recallEvents.length === 0 && (
            <div className="rounded-md border border-line bg-panel p-4 text-sm text-stone-400">
              还没有召回记录。智能体调用 search_evidence 或 RAG 搜索后会显示在这里。
            </div>
          )}
          {recallEvents.map((event) => (
            <div key={event.id} className="rounded-md border border-line bg-panel p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-accent">{event.tool_name}</div>
                  <div className="mt-1 line-clamp-2 text-sm font-semibold text-ink">
                    {event.query || "空查询"}
                  </div>
                  <div className="mt-1 text-xs text-stone-400">
                    {event.result_count} 个结果 · {event.mode} · {formatDateTime(event.created_at)}
                  </div>
                </div>
                <span className="rounded-md bg-panel px-2 py-1 text-[11px] text-stone-300">
                  {event.scope}
                </span>
              </div>
              <div className="mt-2 space-y-1">
                {(event.results ?? []).slice(0, 3).map((item, index) => (
                  <div
                    key={`${event.id}-${index}`}
                    className="rounded-md bg-panel px-3 py-2 text-xs text-stone-300"
                  >
                    <span className="font-medium text-ink">
                      {String(item.source_type || "source")}
                    </span>
                    <span className="mx-1">·</span>
                    {String(item.title || "")}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {activeTab === "search" && (
        <section className="space-y-4">
          <div className="rounded-md border border-line bg-panel p-4">
            <h3 className="text-sm font-semibold text-ink">统一记忆搜索</h3>
            <div className="mt-3 flex gap-2">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runMemorySearch();
                }}
                placeholder="搜索 Issue、PR、CI、文档、会话记忆..."
                className="h-9 min-w-0 flex-1 rounded-md border border-line px-3 text-sm outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-100"
              />
              <button
                type="button"
                onClick={runMemorySearch}
                disabled={!searchQuery.trim() || loadingPanel === "search"}
                className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-[#062a1d] transition hover:bg-sage-400 disabled:opacity-60"
              >
                搜索
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {searchResults.map((item) => (
                <div
                  key={`${item.source_type}-${item.source_id}-${item.title}`}
                  className="rounded-md bg-panel p-3"
                >
                  <div className="text-xs font-medium text-accent">
                    {knowledgeTypeLabel(item.source_type)}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-ink">{item.title}</div>
                  <div className="mt-1 line-clamp-3 text-xs leading-5 text-stone-300">
                    {item.snippet}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <section className="rounded-md border border-line bg-panel p-4">
            <h3 className="text-sm font-semibold text-ink">项目记忆</h3>
            <p className="mt-1 text-xs leading-5 text-stone-400">
              记录项目约定、架构背景和长期偏好，会写入当前项目的 RAG 文档。
            </p>
            <div className="mt-4 grid gap-2">
              <input
                value={draft.title}
                onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
                placeholder="标题，例如 认证模块约定"
                className="h-9 rounded-md border border-line bg-panel px-3 text-sm outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-100"
              />
              <textarea
                value={draft.content}
                onChange={(event) => onDraftChange({ ...draft, content: event.target.value })}
                placeholder="记忆内容，例如 登录相关 Issue 优先分给熟悉 JWT 和 FastAPI 的成员"
                className="min-h-24 resize-none rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-100"
              />
              <button
                onClick={onAddNote}
                disabled={!draft.title.trim() && !draft.content.trim()}
                className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-[#062a1d] transition hover:bg-sage-400 disabled:opacity-60"
              >
                保存记忆
              </button>
            </div>
          </section>

          <section className="rounded-md border border-line bg-panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">知识库文件</h3>
                <p className="mt-1 text-xs leading-5 text-stone-400">
                  上传文档后会切片写入向量索引，并参与统一记忆搜索。
                </p>
              </div>
              <FileText className="h-4 w-4 text-accent" />
            </div>
            <label className="mt-4 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-sage-700 bg-sage-900/50 px-3 py-4 text-center transition hover:bg-sage-900">
              <Upload className="h-5 w-5 text-accent" />
              <span className="mt-2 text-sm font-medium text-ink">
                {uploading ? "上传并索引中..." : "上传文件到知识库"}
              </span>
              <span className="mt-1 text-xs text-stone-400">
                支持文本、Markdown、JSON、CSV、PDF、DOCX 等可抽取文本的文件
              </span>
              <input
                type="file"
                className="hidden"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUploadFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-stone-300">
              <div className="rounded-md bg-panel px-3 py-2">
                知识条目：{visibleKnowledgeItems.length}
              </div>
            </div>
          </section>

          <MemoryItemLists
            notes={notes}
            knowledgeItems={visibleKnowledgeItems}
            onRemoveNote={onRemoveNote}
            onRemoveKnowledgeItem={onRemoveKnowledgeItem}
          />
        </section>
      )}

      {activeTab === "status" && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">索引与健康状态</h3>
            <button
              type="button"
              onClick={loadMemoryStatus}
              className="rounded-md border border-line px-2 py-1 text-xs text-stone-300 hover:bg-panel"
            >
              刷新
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-stone-300">
            <MemoryStatusTile
              label="索引状态"
              value={String(memoryStatus?.index?.status ?? "missing")}
            />
            <MemoryStatusTile
              label="项目文档"
              value={`${numberFromUnknown(memoryStatus?.documents?.total)} 条`}
            />
            <MemoryStatusTile
              label="Evidence"
              value={`${numberFromUnknown(memoryStatus?.evidence?.total)} 条`}
            />
            <MemoryStatusTile
              label="召回记录"
              value={`${numberFromUnknown(memoryStatus?.recall?.total)} 次`}
            />
            <MemoryStatusTile
              label="待确认"
              value={`${numberFromUnknown(memoryStatus?.candidates?.pending)} 条`}
            />
            <MemoryStatusTile label="向量后端" value={vectorBackend} />
          </div>
          <div className="rounded-md border border-line bg-panel p-3 text-xs leading-5 text-stone-300">
            <div>最后扫描：{String(memoryStatus?.index?.last_scan_at ?? "暂无")}</div>
            <div>Embedding Provider：{String(vectorEmbedding.provider ?? "未配置")}</div>
            <div>Embedding：{String(vectorEmbedding.model ?? "未配置")}</div>
            <div>维度：{String(vectorEmbedding.dimensions ?? "未配置")}</div>
            <div>Collection：{String(vectorRuntime.collection ?? "未配置")}</div>
            <div>状态说明：{String(vectorRuntime.error ?? vectorRuntime.status ?? "暂无")}</div>
          </div>
        </section>
      )}

      {activeTab === "review" && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">待确认知识</h3>
            <button
              type="button"
              onClick={() => loadCandidates()}
              className="rounded-md border border-line px-2 py-1 text-xs text-stone-300 hover:bg-panel"
            >
              刷新
            </button>
          </div>
          {candidates.length === 0 && (
            <div className="rounded-md border border-line bg-panel p-4 text-sm text-stone-400">
              还没有待确认知识。新的会话总结会在这里沉淀为候选项。
            </div>
          )}
          {candidates.map((candidate) => (
            <div key={candidate.id} className="rounded-md border border-line bg-panel p-3">
              <div className="text-xs font-medium text-accent">
                {memoryCandidateKindLabel(candidate.kind)}
              </div>
              <div className="mt-1 text-sm font-semibold text-ink">{candidate.title}</div>
              <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-stone-300">
                {candidate.content}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={loadingPanel === candidate.id}
                  onClick={() => approveCandidate(candidate.id)}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-[#062a1d] hover:bg-sage-400 disabled:opacity-60"
                >
                  确认入库
                </button>
                <button
                  type="button"
                  disabled={loadingPanel === candidate.id}
                  onClick={() => rejectCandidate(candidate.id)}
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-stone-300 hover:bg-panel disabled:opacity-60"
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

export function MemoryStatusTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2">
      <div className="text-[11px] text-stone-400">{label}</div>
      <div className="mt-1 font-semibold text-ink">{value}</div>
    </div>
  );
}

export function MemoryItemLists({
  notes,
  knowledgeItems,
  onRemoveNote,
  onRemoveKnowledgeItem,
}: {
  notes: MemoryNote[];
  knowledgeItems: KnowledgeItem[];
  onRemoveNote: (noteId: string) => void;
  onRemoveKnowledgeItem: (item: KnowledgeItem) => void;
}) {
  return (
    <>
      <section className="space-y-2">
        {notes.length === 0 && (
          <div className="rounded-md border border-line bg-panel p-4 text-sm text-stone-400">
            还没有项目记忆。
          </div>
        )}
        {notes.map((note) => (
          <div key={note.id} className="rounded-md border border-line bg-panel p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium text-ink">{note.title}</div>
              <button
                onClick={() => onRemoveNote(note.id)}
                className="rounded-md border border-line px-2 py-1 text-xs text-stone-400 hover:bg-panel"
              >
                移除
              </button>
            </div>
            <div className="mt-2 whitespace-pre-wrap text-xs leading-6 text-stone-300">
              {note.content || "无内容"}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        {knowledgeItems.length === 0 && (
          <div className="rounded-md border border-line bg-panel p-4 text-sm text-stone-400">
            还没有上传文件或生成周报。
          </div>
        )}
        {knowledgeItems.map((item) => (
          <div
            key={`${item.source_type}-${item.id}`}
            className="rounded-md border border-line bg-panel p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="line-clamp-1 font-medium text-ink">{item.title}</div>
                <div className="mt-1 text-xs text-stone-400">
                  {knowledgeTypeLabel(item.source_type)} · {item.chunk_count} 个切片
                </div>
              </div>
              <button
                onClick={() => onRemoveKnowledgeItem(item)}
                className="rounded-md border border-line px-2 py-1 text-xs text-stone-400 hover:bg-panel"
              >
                移除
              </button>
            </div>
            <div className="mt-2 line-clamp-3 text-xs leading-6 text-stone-300">
              {item.content_preview || "无内容预览"}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
