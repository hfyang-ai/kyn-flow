import type { LogTab, LogSummary } from "./types";

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDuration(ms?: number | null) {
  if (ms === null || ms === undefined) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function shortId(value?: string | null) {
  if (!value) return "—";
  return value.slice(0, 8);
}

const STATUS_TONES: Record<string, "success" | "danger" | "warn" | "neutral" | "accent"> = {
  success: "success",
  completed: "success",
  executed: "success",
  ok: "success",
  failed: "danger",
  error: "danger",
  partial: "warn",
  pending: "warn",
  pending_confirmation: "warn",
  running: "warn",
  skipped: "neutral",
  cancelled: "neutral",
};

export function statusTone(status?: string | null) {
  return STATUS_TONES[(status ?? "").toLowerCase()] ?? "neutral";
}

export function todayInput() {
  return toInputDate(new Date());
}

export function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function daysAgoInput(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toInputDate(date);
}

/**
 * `<input type="date">` 给的是本地日期，直接发给后端会被当成 UTC 日界，
 * 对东八区用户相当于整体偏移 8 小时。这里显式换算成本地 00:00 / 23:59:59.999 的绝对时刻。
 */
export function dayStartIso(value: string) {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((item) => Number.isNaN(item))) return "";
  const [year, month, day] = parts;
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

export function dayEndIso(value: string) {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((item) => Number.isNaN(item))) return "";
  const [year, month, day] = parts;
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

export type DateRangePreset = "today" | "7d" | "30d" | "all";

export function rangeForPreset(preset: DateRangePreset): { start: string; end: string } {
  if (preset === "all") return { start: "", end: "" };
  if (preset === "today") return { start: todayInput(), end: todayInput() };
  return { start: daysAgoInput(preset === "7d" ? 6 : 29), end: todayInput() };
}

export const logTabs: Array<{
  key: LogTab;
  label: string;
  description: string;
  summaryKey: keyof LogSummary;
}> = [
  {
    key: "agent-runs",
    label: "问答全链路",
    description: "问了什么 / 走了哪条路由 / 调了哪些工具 / 答了什么",
    summaryKey: "agent_runs",
  },
  {
    key: "chat-messages",
    label: "对话消息",
    description: "单条消息的 tokens、上下文诊断与压缩统计",
    summaryKey: "chat_messages",
  },
  {
    key: "audit-logs",
    label: "操作审计",
    description: "谁做了什么操作，请求与结果快照",
    summaryKey: "audit_logs",
  },
  {
    key: "workflows",
    label: "多 Agent 轨迹",
    description: "工作流与子任务两级执行记录",
    summaryKey: "workflows",
  },
];
