"use client";

import { useState } from "react";
import { Clock3, GitBranch, User } from "lucide-react";

import { Badge } from "@/components/ui/card";
import { JsonBlock } from "./json-view";
import { formatDateTime, formatDuration, shortId, statusTone } from "../utils";
import type {
  AgentRunLog,
  AuditLogEntry,
  ChatMessageLog,
  WorkflowRunLog,
} from "../types";

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <article className="rounded-md border border-line bg-panel p-3.5 transition hover:border-line-strong">
      {children}
    </article>
  );
}

function CardHeader({
  time,
  title,
  badges,
}: {
  time: string;
  title: string;
  badges: React.ReactNode;
}) {
  return (
    <>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
        <span className="inline-flex items-center gap-1 font-mono">
          <Clock3 className="h-3 w-3" />
          {time}
        </span>
        {badges}
      </header>
      <h3 className="mt-2 break-words text-sm font-semibold leading-6 text-ink">{title}</h3>
    </>
  );
}

function ExpandableText({
  text,
  emptyHint = "（空）",
}: {
  text?: string | null;
  emptyHint?: string;
}) {
  const [open, setOpen] = useState(false);
  // 防御：不同 tab 的记录字段并不一致，宁可显示占位也不能让 .length 抛错。
  const body = typeof text === "string" ? text : "";
  const long = body.length > 240;
  if (!body.trim()) {
    return <p className="text-xs text-faint">{emptyHint}</p>;
  }
  return (
    <div>
      <p
        className={`whitespace-pre-wrap break-words text-sm leading-6 text-ink ${
          long && !open ? "line-clamp-4" : ""
        }`}
      >
        {body}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-1 text-[11px] font-medium text-accent transition hover:text-accent-bright"
        >
          {open ? "收起" : `展开全文（${body.length} 字）`}
        </button>
      )}
    </div>
  );
}

function RepoBadge({ name }: { name?: string | null }) {
  if (!name) return <Badge tone="neutral">无仓库</Badge>;
  return <Badge tone="neutral">{name}</Badge>;
}

export function AgentRunList({ items }: { items: AgentRunLog[] }) {
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <CardShell key={item.id}>
          <CardHeader
            time={formatDateTime(item.created_at)}
            title={item.user_message}
            badges={
              <>
                <RepoBadge name={item.repo_name} />
                <Badge tone="info">{item.route}</Badge>
                <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                <span className="font-mono text-[10px] text-faint">#{shortId(item.id)}</span>
              </>
            }
          />
          <div className="mt-2.5 space-y-2.5 border-t border-line pt-2.5">
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted">最终回答</div>
              <ExpandableText text={item.final_answer} emptyHint="未记录最终回答" />
            </div>
            <JsonBlock
              label={`tool_calls (${item.tool_call_count})`}
              value={item.tool_calls}
              emptyHint="本次未调用工具"
              previewLines={0}
            />
          </div>
        </CardShell>
      ))}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  user: "用户",
  assistant: "助手",
  system: "系统",
  tool: "工具",
};

export function ChatMessageList({ items }: { items: ChatMessageLog[] }) {
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <CardShell key={item.id}>
          <CardHeader
            time={formatDateTime(item.created_at)}
            title={`${ROLE_LABEL[item.role] || item.role}消息`}
            badges={
              <>
                <RepoBadge name={item.repo_name} />
                {item.route && <Badge tone="accent">{item.route}</Badge>}
                {item.tool_call_count > 0 && (
                  <Badge tone="info">{item.tool_call_count} 次工具调用</Badge>
                )}
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  <span className="font-mono text-[10px]">{shortId(item.conversation_id)}</span>
                </span>
              </>
            }
          />
          <div className="mt-2.5 space-y-2.5 border-t border-line pt-2.5">
            <ExpandableText text={item.content} emptyHint="（空消息）" />
            {item.content_truncated && (
              <p className="text-[11px] text-warn">
                正文共 {item.content_length} 字，日志页只展示前 {(item.content ?? "").length} 字（完整内容见会话记录）。
              </p>
            )}
            <JsonBlock
              label="meta（tokens / 上下文诊断 / 压缩统计）"
              value={item.meta}
              emptyHint="该消息没有 meta"
              defaultOpen
            />
          </div>
        </CardShell>
      ))}
    </div>
  );
}

export function AuditLogList({ items }: { items: AuditLogEntry[] }) {
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <CardShell key={item.id}>
          <CardHeader
            time={formatDateTime(item.created_at)}
            title={item.action}
            badges={
              <>
                <RepoBadge name={item.repo_name} />
                <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                {item.target_type && (
                  <Badge tone="info">
                    {item.target_type}
                    {item.target_id ? ` #${item.target_id}` : ""}
                  </Badge>
                )}
                <span className="font-mono text-[10px] text-faint">
                  user {shortId(item.user_id)}
                </span>
              </>
            }
          />
          <div className="mt-2.5 grid gap-2 border-t border-line pt-2.5 md:grid-cols-2">
            <JsonBlock label="request_json" value={item.request_json} previewLines={0} />
            <JsonBlock label="result_json" value={item.result_json} previewLines={0} />
          </div>
        </CardShell>
      ))}
    </div>
  );
}

function WorkflowTaskRow({ task }: { task: WorkflowRunLog["tasks"][number] }) {
  const [open, setOpen] = useState(false);
  const duration = formatDuration(task.duration_ms);
  return (
    <div className="rounded-md border border-line bg-panel-2 p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-ink transition hover:text-accent"
        >
          <GitBranch className="h-3 w-3" />
          {task.task_id}
        </button>
        <span className="text-muted">{task.agent_name}</span>
        <Badge tone="neutral">{task.task_type}</Badge>
        <Badge tone={statusTone(task.status)}>{task.status}</Badge>
        {duration && <span className="text-faint">{duration}</span>}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="ml-auto text-[11px] font-medium text-accent transition hover:text-accent-bright"
        >
          {open ? "收起" : "查看 JSON"}
        </button>
      </div>
      {task.error && (
        <p className="mt-1.5 break-words text-[11px] leading-5 text-rose-600">{task.error}</p>
      )}
      {open && (
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <JsonBlock label="claim" value={task.claim} previewLines={0} />
          <JsonBlock label="input" value={task.input} previewLines={0} />
          <JsonBlock label="result" value={task.result} previewLines={0} />
        </div>
      )}
    </div>
  );
}

export function WorkflowLogList({ items }: { items: WorkflowRunLog[] }) {
  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const duration = formatDuration(item.duration_ms);
        const tasks = item.tasks ?? [];
        return (
          <CardShell key={item.id}>
            <CardHeader
              time={formatDateTime(item.created_at)}
              title={item.goal}
              badges={
                <>
                  <RepoBadge name={item.repo_name} />
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  <Badge tone="info">{tasks.length} 个子任务</Badge>
                  {duration && <span className="text-faint">耗时 {duration}</span>}
                  <span className="font-mono text-[10px] text-faint">#{shortId(item.id)}</span>
                </>
              }
            />
            <div className="mt-2.5 space-y-2.5 border-t border-line pt-2.5">
              <div>
                <div className="mb-1 text-[11px] font-medium text-muted">最终结论</div>
                <ExpandableText text={item.final_answer} emptyHint="未记录最终结论" />
              </div>
              <div className="space-y-2">
                {tasks.map((task) => (
                  <WorkflowTaskRow key={task.id} task={task} />
                ))}
                {tasks.length === 0 && (
                  <p className="text-xs text-faint">该工作流没有子任务记录。</p>
                )}
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <JsonBlock label="metrics" value={item.metrics} defaultOpen />
                <JsonBlock label="spec" value={item.spec} previewLines={0} />
                <JsonBlock label="observation" value={item.observation} previewLines={0} />
              </div>
            </div>
          </CardShell>
        );
      })}
    </div>
  );
}
