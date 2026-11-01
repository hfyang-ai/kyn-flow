"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, X } from "lucide-react";

import type { CIAnalysisResult, Issue, IssueAnalysisResult, IssueAnalysisTraceItem, PRAnalysisResult, PullRequest, WorkflowRun } from "../types";
import { MarkdownMessage } from "./chat";

export function IssueAnalysisOverlay({
  issue,
  analysis,
  traceItems,
  loading,
  error,
  onRetry,
  onClose
}: {
  issue: Issue;
  analysis?: IssueAnalysisResult;
  traceItems: IssueAnalysisTraceItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const checklist = analysis?.checklist?.length ? analysis.checklist : analysis?.action_items ?? [];
  const drafts = analysis?.drafts;
  const hasDrafts = Boolean(drafts?.clarification_comment || drafts?.task_breakdown);
  const traceScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = traceScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [traceItems]);

  return (
    <div className="absolute inset-0 z-50 grid grid-cols-1 items-center gap-3 bg-stone-950/35 p-4 backdrop-blur-sm xl:grid-cols-[280px_minmax(0,1fr)] xl:p-6">
      <aside className="order-2 flex max-h-[28vh] min-h-0 flex-col overflow-hidden rounded-lg border border-sage-800 bg-panel/95 shadow-xl xl:order-1 xl:h-[86vh] xl:max-h-[86vh]">
        <div className="border-b border-line px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Thinking Trace</div>
          <h3 className="mt-1 text-sm font-semibold text-ink">公开分析过程</h3>
          <p className="mt-1 text-xs leading-5 text-stone-400">展示工具调用、证据收集和面向用户的分析摘要。</p>
        </div>
        <div ref={traceScrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {traceItems.length === 0 && (
            <div className="rounded-md border border-dashed border-line bg-panel p-3 text-xs leading-5 text-stone-400">
              点击“重新分析”后，这里会流式显示分析步骤。
            </div>
          )}
          {traceItems.map((item) => (
            <div
              key={item.id}
              className={`rounded-md border p-3 text-xs leading-5 shadow-sm ${item.kind === "error"
                ? "border-rose-800/60 bg-rose-900/40 text-rose-300"
                : item.kind === "thinking"
                  ? "border-sage-700 bg-sage-900/80 text-stone-200"
                  : "border-line bg-panel text-stone-300"
                }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{item.title}</span>
                {item.status === "running" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />}
              </div>
              {item.kind === "thinking" ? <MarkdownMessage content={item.content} /> : <div className="whitespace-pre-wrap">{item.content}</div>}
            </div>
          ))}
        </div>
      </aside>

      <div role="dialog" aria-modal="true" className="order-1 flex max-h-[86vh] min-h-0 w-full flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl xl:order-2">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Issue Agent</div>
            <h3 className="mt-1 line-clamp-2 text-base font-semibold text-ink">
              #{issue.number} {issue.title}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={onRetry}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-panel px-2.5 text-xs text-stone-300 transition hover:bg-sage-900 disabled:opacity-50"
              title="重新分析"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              重新分析
            </button>
            <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel text-stone-400 transition hover:bg-panel" title="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && !analysis && (
            <div className="rounded-md border border-line bg-panel p-4 text-sm text-stone-300">Issue Agent 正在检索 Issue、相似历史、代码、文档和会话上下文...</div>
          )}

          {error && (
            <div className="rounded-md border border-rose-800/60 bg-rose-900/40 p-4 text-sm leading-6 text-rose-300">
              分析失败：{error}
            </div>
          )}

          {analysis && (
            <div className="space-y-4">
              <section className="rounded-md border border-sage-700 bg-sage-900/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-[#062a1d]">{analysis.conclusion}</span>
                  <span className="rounded-full bg-panel px-2.5 py-1 text-xs text-stone-300">优先级 {analysis.priority}</span>
                  <span className="rounded-full bg-panel px-2.5 py-1 text-xs text-stone-300">复杂度 {analysis.complexity}</span>
                  <span className="rounded-full bg-panel px-2.5 py-1 text-xs text-stone-300">分类 {analysis.category}</span>
                  <span className="rounded-full bg-panel px-2.5 py-1 text-xs text-stone-300">置信度 {Math.round((analysis.confidence ?? 0) * 100)}%</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-stone-200">{analysis.conclusion_reason || analysis.summary}</p>
              </section>

              <section className="rounded-md border border-line bg-panel p-4">
                <h4 className="text-sm font-semibold text-ink">建议负责人</h4>
                <p className="mt-2 text-sm leading-6 text-stone-200">
                  <span className="font-semibold text-ink">{analysis.suggested_owner}</span>
                  <span className="ml-2">{analysis.owner_reason}</span>
                </p>
              </section>

              <section className="rounded-md border border-line bg-panel p-4">
                <h4 className="text-sm font-semibold text-ink">证据</h4>
                <div className="mt-3 space-y-2">
                  {(analysis.evidence ?? []).length === 0 && <div className="text-sm text-stone-400">暂无可用证据。</div>}
                  {(analysis.evidence ?? []).map((item, index) => (
                    <div key={`${item.source_type}-${item.reference ?? "ref"}-${index}`} className="rounded-md bg-[#0e1a16] p-3 text-sm leading-6 text-stone-200">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] text-stone-400">{item.source_type}</span>
                        <span className="font-medium text-ink">{item.title}</span>
                        {typeof item.confidence === "number" && <span className="text-xs text-stone-500">{Math.round(item.confidence * 100)}%</span>}
                      </div>
                      <p className="mt-1">{item.snippet}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-md border border-line bg-panel p-4">
                <h4 className="text-sm font-semibold text-ink">下一步 checklist</h4>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-stone-200">
                  {checklist.map((item) => (
                    <li key={item} className="flex gap-2">
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-accent" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {hasDrafts && (
                <section className="rounded-md border border-line bg-panel p-4">
                  <h4 className="text-sm font-semibold text-ink">可选草稿</h4>
                  {drafts?.clarification_comment && (
                    <div className="mt-3 rounded-md bg-panel p-3 text-sm leading-6 text-stone-200">
                      <div className="mb-2 text-xs font-semibold text-stone-400">澄清评论</div>
                      <MarkdownMessage content={drafts.clarification_comment} />
                    </div>
                  )}
                  {drafts?.task_breakdown && (
                    <div className="mt-3 rounded-md bg-panel p-3 text-sm leading-6 text-stone-200">
                      <div className="mb-2 text-xs font-semibold text-stone-400">任务拆分说明</div>
                      <MarkdownMessage content={drafts.task_breakdown} />
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AgentTraceAside({
  eyebrow,
  title,
  description,
  emptyLabel,
  traceItems
}: {
  eyebrow: string;
  title: string;
  description: string;
  emptyLabel: string;
  traceItems: IssueAnalysisTraceItem[];
}) {
  const traceScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = traceScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [traceItems]);

  return (
    <aside className="order-2 flex max-h-[28vh] min-h-0 flex-col overflow-hidden rounded-lg border border-sage-800 bg-panel/95 shadow-xl xl:order-1 xl:h-[86vh] xl:max-h-[86vh]">
      <div className="border-b border-line px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">{eyebrow}</div>
        <h3 className="mt-1 text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-stone-400">{description}</p>
      </div>
      <div ref={traceScrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {traceItems.length === 0 && (
          <div className="rounded-md border border-dashed border-line bg-panel p-3 text-xs leading-5 text-stone-400">{emptyLabel}</div>
        )}
        {traceItems.map((item) => (
          <div
            key={item.id}
            className={`rounded-md border p-3 text-xs leading-5 shadow-sm ${item.kind === "error"
              ? "border-rose-800/60 bg-rose-900/40 text-rose-300"
              : item.kind === "thinking"
                ? "border-sage-700 bg-sage-900/80 text-stone-200"
                : "border-line bg-panel text-stone-300"
              }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">{item.title}</span>
              {item.status === "running" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />}
            </div>
            {item.kind === "thinking" ? <MarkdownMessage content={item.content} /> : <div className="whitespace-pre-wrap">{item.content}</div>}
          </div>
        ))}
      </div>
    </aside>
  );
}

export function PRAnalysisOverlay({
  pr,
  analysis,
  traceItems,
  loading,
  error,
  onRetry,
  onClose
}: {
  pr: PullRequest;
  analysis?: PRAnalysisResult;
  traceItems: IssueAnalysisTraceItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid grid-cols-1 items-center gap-3 bg-stone-950/35 p-4 backdrop-blur-sm xl:grid-cols-[280px_minmax(0,1fr)] xl:p-6">
      <AgentTraceAside
        eyebrow="Plan & Execute"
        title="PR Review 过程"
        description="展示 Review 计划、执行步骤、证据收集和合入判断。"
        emptyLabel="点击“重新分析”后，这里会流式显示 PR Review 计划和执行过程。"
        traceItems={traceItems}
      />

      <div role="dialog" aria-modal="true" className="order-1 flex max-h-[86vh] min-h-0 w-full flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl xl:order-2">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">PR Merge Readiness Agent</div>
            <h3 className="mt-1 line-clamp-2 text-base font-semibold text-ink">
              #{pr.number} {pr.title}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={onRetry}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-panel px-2.5 text-xs text-stone-300 transition hover:bg-sage-900 disabled:opacity-50"
              title="重新分析"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              重新分析
            </button>
            <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel text-stone-400 transition hover:bg-panel" title="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && !analysis && (
            <div className="rounded-md border border-line bg-panel p-4 text-sm text-stone-300">PR Agent 正在制定 Review 计划，并检查 diff、代码、CI、文档和 review comments...</div>
          )}

          {error && (
            <div className="rounded-md border border-rose-800/60 bg-rose-900/40 p-4 text-sm leading-6 text-rose-300">
              分析失败：{error}
            </div>
          )}

          {analysis && (
            <div className="space-y-4">
              <section className="rounded-md border border-sage-700 bg-sage-900/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-[#062a1d]">{analysis.merge_recommendation}</span>
                  <span className="rounded-full bg-panel px-2.5 py-1 text-xs text-stone-300">置信度 {Math.round((analysis.confidence ?? 0) * 100)}%</span>
                  <span className="rounded-full bg-panel px-2.5 py-1 text-xs text-stone-300">风险点 {(analysis.risk_points ?? []).length}</span>
                  <span className="rounded-full bg-panel px-2.5 py-1 text-xs text-stone-300">阻塞项 {(analysis.blocking_issues ?? []).length}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-stone-200">{analysis.recommendation_reason || analysis.summary}</p>
              </section>

              <section className="rounded-md border border-line bg-panel p-4">
                <h4 className="text-sm font-semibold text-ink">Review 计划与执行</h4>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <AnalysisBulletList title="计划" items={analysis.plan ?? []} emptyLabel="暂无计划。" />
                  <AnalysisBulletList title="已执行" items={analysis.executed_steps ?? []} emptyLabel="暂无执行记录。" />
                </div>
              </section>

              <section className="rounded-md border border-line bg-panel p-4">
                <h4 className="text-sm font-semibold text-ink">变更与风险</h4>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <AnalysisBulletList title="关键变更" items={analysis.key_changes ?? []} emptyLabel="暂无关键变更摘要。" />
                  <AnalysisBulletList title="风险点" items={analysis.risk_points ?? []} emptyLabel="暂无明显风险点。" tone="warn" />
                  <AnalysisBulletList title="阻塞项" items={analysis.blocking_issues ?? []} emptyLabel="暂无阻塞项。" tone="danger" />
                  <AnalysisBulletList title="重点文件" items={analysis.files_need_attention ?? []} emptyLabel="暂无重点文件。" />
                </div>
              </section>

              <section className="rounded-md border border-line bg-panel p-4">
                <h4 className="text-sm font-semibold text-ink">合入前动作</h4>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <AnalysisBulletList title="Review checklist" items={analysis.review_checklist ?? []} emptyLabel="暂无 checklist。" />
                  <AnalysisBulletList title="测试建议" items={analysis.test_suggestions ?? []} emptyLabel="暂无测试建议。" />
                </div>
              </section>

              {(analysis.review_comments ?? []).length > 0 && (
                <section className="rounded-md border border-line bg-panel p-4">
                  <h4 className="text-sm font-semibold text-ink">Review comments 摘要</h4>
                  <AnalysisBulletList items={analysis.review_comments ?? []} emptyLabel="暂无 review comments。" />
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CIAnalysisOverlay({
  run,
  analysis,
  traceItems,
  loading,
  error,
  onRetry,
  onClose
}: {
  run: WorkflowRun;
  analysis?: CIAnalysisResult;
  traceItems: IssueAnalysisTraceItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid grid-cols-1 items-center gap-3 bg-stone-950/35 p-4 backdrop-blur-sm xl:grid-cols-[280px_minmax(0,1fr)] xl:p-6">
      <AgentTraceAside
        eyebrow="Plan & Execute"
        title="CI 排查过程"
        description="展示排查计划、失败定位、日志证据和阻塞判断。"
        emptyLabel="点击“重新分析”后，这里会流式显示 CI 排查计划和执行过程。"
        traceItems={traceItems}
      />

      <div role="dialog" aria-modal="true" className="order-1 flex max-h-[86vh] min-h-0 w-full flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl xl:order-2">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">CI Root Cause Agent</div>
            <h3 className="mt-1 line-clamp-2 text-base font-semibold text-ink">{run.name}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={onRetry}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-panel px-2.5 text-xs text-stone-300 transition hover:bg-sage-900 disabled:opacity-50"
              title="重新分析"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              重新分析
            </button>
            <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel text-stone-400 transition hover:bg-panel" title="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && !analysis && (
            <div className="rounded-md border border-line bg-panel p-4 text-sm text-stone-300">CI Agent 正在制定排查计划，并检查失败 job、错误日志、相关文件和最近 PR...</div>
          )}

          {error && (
            <div className="rounded-md border border-rose-800/60 bg-rose-900/40 p-4 text-sm leading-6 text-rose-300">
              分析失败：{error}
            </div>
          )}

          {analysis && (
            <div className="space-y-4">
              <section className="rounded-md border border-sage-700 bg-sage-900/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-[#062a1d]">{analysis.failure_type}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${analysis.is_merge_blocking ? "bg-rose-900/40 text-rose-300" : "bg-emerald-900/40 text-emerald-300"}`}>
                    {analysis.is_merge_blocking ? "阻塞合并" : "不阻塞合并"}
                  </span>
                  <span className="rounded-full bg-panel px-2.5 py-1 text-xs text-stone-300">置信度 {Math.round((analysis.confidence ?? 0) * 100)}%</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-stone-200">{analysis.root_cause || analysis.failure_summary}</p>
                {analysis.blocking_reason && <p className="mt-2 text-xs leading-5 text-stone-400">{analysis.blocking_reason}</p>}
              </section>

              <section className="rounded-md border border-line bg-panel p-4">
                <h4 className="text-sm font-semibold text-ink">排查计划与执行</h4>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <AnalysisBulletList title="计划" items={analysis.plan ?? []} emptyLabel="暂无计划。" />
                  <AnalysisBulletList title="已执行" items={analysis.executed_steps ?? []} emptyLabel="暂无执行记录。" />
                </div>
              </section>

              {analysis.first_error && (
                <section className="rounded-md border border-line bg-panel p-4">
                  <h4 className="text-sm font-semibold text-ink">首个关键错误块</h4>
                  <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-rose-800/60 bg-rose-900/40 p-3 text-xs leading-5 text-rose-100">{analysis.first_error}</pre>
                </section>
              )}

              <section className="rounded-md border border-line bg-panel p-4">
                <h4 className="text-sm font-semibold text-ink">根因与修复</h4>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <AnalysisBulletList title="可能原因" items={analysis.possible_causes ?? []} emptyLabel="暂无可能原因。" tone="warn" />
                  <AnalysisBulletList title="修复步骤" items={analysis.fix_steps ?? []} emptyLabel="暂无修复步骤。" />
                  <AnalysisBulletList title="排查步骤" items={analysis.debug_steps ?? []} emptyLabel="暂无排查步骤。" />
                  <AnalysisBulletList title="相关文件" items={analysis.related_files ?? []} emptyLabel="暂无相关文件。" />
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AnalysisBulletList({
  title,
  items,
  emptyLabel,
  tone = "default"
}: {
  title?: string;
  items: string[];
  emptyLabel: string;
  tone?: "default" | "warn" | "danger";
}) {
  const iconClass = tone === "danger" ? "text-rose-400" : tone === "warn" ? "text-amber-400" : "text-accent";
  const Icon = tone === "default" ? CheckCircle2 : AlertTriangle;
  return (
    <div className="rounded-md bg-[#0e1a16] p-3">
      {title && <div className="text-xs font-semibold text-stone-400">{title}</div>}
      {items.length === 0 ? (
        <div className={`${title ? "mt-2" : ""} text-sm text-stone-400`}>{emptyLabel}</div>
      ) : (
        <ul className={`${title ? "mt-2" : ""} space-y-2 text-sm leading-6 text-stone-200`}>
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <Icon className={`mt-1 h-4 w-4 shrink-0 ${iconClass}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
