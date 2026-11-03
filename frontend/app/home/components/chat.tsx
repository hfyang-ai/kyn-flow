"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, CheckCircle2, ChevronDown, Gauge, ListTodo, RefreshCw } from "lucide-react";

import type { ChatTraceItem, WorkflowPlan } from "../types";
import {
  contextNumber,
  contextReasonLabel,
  contextRecord,
  contextStageLabel,
  contextString,
} from "../utils";

export function WorkflowPlanCard({
  plan,
  status,
  disabled,
  onExecute,
}: {
  plan: WorkflowPlan;
  status: "ready" | "executing" | "done" | "error";
  disabled: boolean;
  onExecute: () => void;
}) {
  const statusLabel =
    status === "executing"
      ? "执行中"
      : status === "done"
        ? "已执行"
        : status === "error"
          ? "执行失败"
          : "等待确认";
  return (
    <div className="rounded-md border border-sage-700 bg-sage-100 p-3 text-xs leading-5 text-ink">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <ListTodo className="h-4 w-4 text-accent" />
            <span>计划模式</span>
            <span className="rounded-md bg-panel px-2 py-0.5 text-[11px] font-medium text-faint">
              {statusLabel}
            </span>
          </div>
          <div className="mt-1 line-clamp-2 text-muted">{plan.goal}</div>
        </div>
        <button
          type="button"
          onClick={onExecute}
          disabled={disabled || status === "executing" || status === "done"}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-accent-ink transition hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "executing" ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          <span>
            {status === "done" ? "已执行" : status === "executing" ? "执行中" : "执行计划"}
          </span>
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {plan.tasks.map((task, index) => (
          <div key={task.id} className="rounded-md border border-sage-700 bg-panel px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">
                {index + 1}. {task.agent_name}
              </span>
              <span className="shrink-0 rounded-md bg-stone-100 px-2 py-0.5 text-[11px] text-faint">
                {task.task_type}
              </span>
            </div>
            <div className="mt-1 text-muted">{task.objective}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-faint">
              {task.dependencies?.length ? (
                <span>依赖：{task.dependencies.join(", ")}</span>
              ) : (
                <span>无依赖</span>
              )}
              <span>范围：{task.claim.target_type}</span>
              {task.critical && <span className="text-rose-600">关键任务</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ContextDiagnostics({
  compressionStats,
  progressiveCompaction,
  modelUsage,
  contextDiagnostics,
  collapsed,
  onToggle,
}: {
  compressionStats: Record<string, unknown>;
  progressiveCompaction: Record<string, unknown>;
  modelUsage: Array<Record<string, unknown>>;
  contextDiagnostics: Record<string, unknown>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pressure = contextRecord(compressionStats.pressure);
  const rawPressure = contextRecord(compressionStats.raw_history_pressure);
  const microcompact = contextRecord(compressionStats.microcompact);
  const boundary = contextRecord(compressionStats.compact_boundary);
  const promptBreakdown = contextRecord(compressionStats.prompt_breakdown);
  const historyCoverage = contextRecord(compressionStats.history_coverage);
  const progressivePressure = contextRecord(progressiveCompaction.pressure);
  const runtimeToolContext = contextRecord(contextDiagnostics.runtime_tool_context);
  const promptCalls = Array.isArray(contextDiagnostics.prompt_calls)
    ? contextDiagnostics.prompt_calls
    : [];
  const latestPromptCall =
    promptCalls.length > 0 ? contextRecord(promptCalls[promptCalls.length - 1]) : {};
  const latestUsage = modelUsage.length > 0 ? contextRecord(modelUsage[modelUsage.length - 1]) : {};
  const stage =
    contextString(progressivePressure.stage) || contextString(pressure.stage) || "normal";
  const tokenUsage =
    contextNumber(progressivePressure.token_usage) || contextNumber(pressure.token_usage);
  const windowTokens =
    contextNumber(progressivePressure.effective_window_tokens) ||
    contextNumber(pressure.effective_window_tokens);
  const remainingTokens =
    contextNumber(progressivePressure.remaining_tokens) || contextNumber(pressure.remaining_tokens);
  const utilization =
    windowTokens > 0 ? Math.min(100, Math.round((tokenUsage / windowTokens) * 100)) : 0;
  const attempted = progressiveCompaction.attempted === true;
  const compacted = progressiveCompaction.compacted === true;
  const reason =
    contextString(progressiveCompaction.reason) || (compacted ? "compacted" : "未触发正式压缩");
  const microMessages = contextNumber(microcompact.compacted_messages);
  const microSaved = contextNumber(microcompact.estimated_tokens_saved);
  const rawTokens =
    contextNumber(progressivePressure.raw_segment_estimated_tokens) ||
    contextNumber(rawPressure.token_usage);
  const assembledTokens =
    contextNumber(progressivePressure.assembled_context_estimated_tokens) ||
    contextNumber(compressionStats.assembled_prompt_estimated_tokens) ||
    contextNumber(compressionStats.system_context_estimated_tokens);
  const actualInputTokens = contextNumber(latestUsage.input_tokens);
  const providerUsage = contextString(latestUsage.source) === "provider";
  const toolSchemaTokens =
    contextNumber(latestPromptCall.tool_schema_tokens) ||
    contextNumber(promptBreakdown.tool_schema_tokens);
  const runtimeSaved = contextNumber(runtimeToolContext.estimated_tokens_saved);
  const exactHistory = historyCoverage.complete_and_exact === true;
  const hasBoundary = historyCoverage.has_compaction_boundary === true;
  const stageStyle =
    stage === "manual_path"
      ? "bg-rose-50 text-rose-600"
      : stage === "aggressive"
        ? "bg-orange-50 text-orange-600"
        : stage === "auto_compact"
          ? "bg-amber-50 text-amber-600"
          : stage === "warning"
            ? "bg-yellow-50 text-yellow-700"
            : "bg-emerald-50 text-emerald-600";

  return (
    <div className="mt-3 border-t border-line pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 text-left text-xs text-muted"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Gauge className="h-4 w-4 shrink-0 text-accent" />
          <span className="font-semibold text-ink">上下文诊断</span>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${stageStyle}`}>
            {contextStageLabel(stage)}
          </span>
          {compacted && <span className="shrink-0 text-accent">已插入压缩边界</span>}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-3 rounded-md bg-stone-100 p-3">
          <div>
            <div className="flex items-center justify-between text-[11px] text-faint">
              <span>上下文窗口占用</span>
              <span>
                {tokenUsage.toLocaleString()} / {windowTokens.toLocaleString()} tokens
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
              <div
                className={`h-full rounded-full ${stage === "normal" ? "bg-emerald-500" : stage === "warning" ? "bg-yellow-500" : "bg-orange-500"}`}
                style={{ width: `${Math.max(2, utilization)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-faint">
              <span>normal</span>
              <span>warning</span>
              <span>auto compact</span>
              <span>manual</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md bg-line text-xs">
            <div className="bg-panel px-3 py-2">
              <div className="text-faint">原始片段</div>
              <div className="mt-1 font-semibold text-ink">{rawTokens.toLocaleString()} tokens</div>
            </div>
            <div className="bg-panel px-3 py-2">
              <div className="text-faint">组装后上下文</div>
              <div className="mt-1 font-semibold text-ink">
                {assembledTokens.toLocaleString()} tokens
              </div>
            </div>
            <div className="bg-panel px-3 py-2">
              <div className="text-faint">剩余空间</div>
              <div className="mt-1 font-semibold text-ink">
                {remainingTokens.toLocaleString()} tokens
              </div>
            </div>
          </div>

          <div className="rounded-md border border-stone-200 bg-panel px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink">完整 Prompt 计量</span>
              <span className={providerUsage ? "text-emerald-600" : "text-faint"}>
                {providerUsage ? "供应商实际 usage" : "请求前估算"}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-faint sm:grid-cols-4">
              <span>实际输入：{actualInputTokens.toLocaleString()}</span>
              <span>组装估算：{assembledTokens.toLocaleString()}</span>
              <span>
                近期历史：{contextNumber(promptBreakdown.recent_history).toLocaleString()}
              </span>
              <span>工具 Schema：{toolSchemaTokens.toLocaleString()}</span>
            </div>
            {runtimeSaved > 0 && (
              <div className="mt-1 text-accent">
                轮内工具投影节省约 {runtimeSaved.toLocaleString()}{" "}
                tokens，完整结果仍保存在封存转录。
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
            <span className={exactHistory ? "text-emerald-600" : "text-amber-600"}>
              近期历史：{exactHistory ? "完整原文" : "已裁剪或省略"}
            </span>
            {hasBoundary && <span>更早原文可通过 transcript 工具跨 Boundary 精确回查</span>}
            {contextDiagnostics.reactive_overflow_retry === true && (
              <span className="text-orange-600">本轮执行过一次溢出恢复</span>
            )}
          </div>

          {(microMessages > 0 || microSaved > 0) && (
            <div className="flex items-start justify-between gap-4 border-l-2 border-sage-700 pl-3 text-xs leading-5">
              <div>
                <div className="font-semibold text-ink">Microcompact 轻量压缩</div>
                <div className="text-faint">清理 {microMessages} 条可重新获取的旧工具结果</div>
              </div>
              <div className="shrink-0 font-semibold text-accent">
                节省约 {microSaved.toLocaleString()} tokens
              </div>
            </div>
          )}

          <div className="border-l-2 border-amber-200 pl-3 text-xs leading-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink">正式压缩</span>
              <span className={attempted ? "text-amber-600" : "text-faint"}>
                {attempted ? (compacted ? "已完成" : "已尝试") : "未执行"}
              </span>
            </div>
            <div className="text-faint">原因：{contextReasonLabel(reason)}</div>
            {compacted && (
              <div className="mt-1 text-muted">
                摘要 {contextNumber(progressiveCompaction.messages_summarized)} 条，保留最近{" "}
                {contextNumber(progressiveCompaction.messages_preserved)} 条，压缩后约{" "}
                {contextNumber(
                  progressiveCompaction.post_compact_estimated_tokens,
                ).toLocaleString()}{" "}
                tokens
              </div>
            )}
            {(contextString(progressiveCompaction.boundary_id) || contextString(boundary.id)) && (
              <div className="mt-1 truncate font-mono text-[11px] text-faint">
                boundary:{" "}
                {contextString(progressiveCompaction.boundary_id) || contextString(boundary.id)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export function ChatTraceInline({
  traceItems,
  collapsed,
  responsePending,
  onToggle,
}: {
  traceItems: ChatTraceItem[];
  collapsed: boolean;
  responsePending: boolean;
  onToggle: () => void;
}) {
  if (!traceItems.length) return null;
  const runningCount = traceItems.filter((item) => item.status === "running").length;
  const errorCount = traceItems.filter((item) => item.status === "error").length;
  const toolCount = traceItems.filter(
    (item) => item.kind === "tool" || item.kind === "error",
  ).length;
  const ragPrefetch = traceItems.find((item) => item.kind === "rag_prefetch");
  const statusLabel = responsePending
    ? "回复中"
    : runningCount > 0
      ? "执行中"
      : errorCount > 0
        ? `${errorCount} 个失败`
        : "已完成";
  return (
    <div className="space-y-2 border-l-2 border-sage-700 pl-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-stone-100 px-3 py-2 text-left text-xs text-muted transition hover:border-sage-700 hover:bg-sage-100"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 transition ${collapsed ? "-rotate-90" : ""}`}
          />
          <span className="truncate font-semibold text-ink">工具调用过程</span>
          <span className="shrink-0 text-faint">
            {toolCount} 个工具 ·{" "}
            {ragPrefetch ? `RAG 预检索 ${ragPrefetch.evidenceCount ?? 0} 条 · ` : ""}
            {traceItems.length} 条事件
          </span>
        </span>
        <span
          className={
            errorCount > 0
              ? "shrink-0 text-rose-600"
              : responsePending || runningCount > 0
                ? "shrink-0 text-accent"
                : "shrink-0 text-faint"
          }
        >
          {statusLabel}
        </span>
      </button>
      {!collapsed &&
        traceItems.map((item) => (
          <div
            key={item.id}
            className={`rounded-md px-3 py-2 text-xs leading-5 ${
              item.status === "error"
                ? "bg-rose-50 text-rose-600"
                : item.status === "running"
                  ? "bg-sage-100 text-ink"
                  : item.kind === "rag_prefetch"
                    ? "border border-cyan-200 bg-cyan-50 text-ink"
                    : "bg-stone-100 text-muted"
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">{item.title}</span>
              {item.status === "running" && (
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
              )}
            </div>
            {item.skillTitle && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 border-y border-sage-700 py-1.5 text-[11px] text-accent">
                <BookOpen className="h-3.5 w-3.5" />
                <span className="font-semibold">Skill：{item.skillTitle}</span>
                {item.skillVersion && <span>v{item.skillVersion}</span>}
                {item.skillName && (
                  <span className="font-mono text-accent">{item.skillName}</span>
                )}
                {item.skillActivationMode && <span>· {item.skillActivationMode}</span>}
              </div>
            )}
            {item.kind === "thinking" ? (
              <MarkdownMessage content={item.content} />
            ) : (
              <div className="max-h-32 overflow-auto whitespace-pre-wrap">{item.content}</div>
            )}
            {item.skillSteps && item.skillSteps.length > 0 && (
              <div className="mt-2 border-t border-stone-200 pt-2">
                <div className="mb-1 font-semibold text-muted">Skill 工作流</div>
                <div className="flex flex-wrap gap-1">
                  {item.skillSteps.map((step, index) => (
                    <span
                      key={step}
                      className="rounded bg-panel px-1.5 py-0.5 font-mono text-[10px] text-faint"
                    >
                      {index + 1}. {step}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children, ...props }) => (
            <div className="markdown-table-wrap">
              <table {...props}>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
