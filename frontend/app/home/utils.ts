import type {
  ChatStreamToolResult,
  ChatStreamToolUse,
  ChatTraceItem,
  Issue,
  PullRequest,
  RepoSyncResult,
  SyncNotice,
} from "./types";

const DRAFT_CONVERSATION_PREFIX = "draft:";

const SYNC_ERROR_PREVIEW = 3;

function summarizeSyncErrors(result: RepoSyncResult) {
  const errors = result.errors ?? [];
  if (!errors.length) return result.message || undefined;
  const preview = errors.slice(0, SYNC_ERROR_PREVIEW).join("；");
  const suffix = errors.length > SYNC_ERROR_PREVIEW ? ` 等 ${errors.length} 项` : "";
  return `${result.message}${result.message ? " · " : ""}${preview}${suffix}`;
}

/**
 * 把同步响应翻译成一条可见提示：成功不打扰，限流单独说清楚，
 * 失败/不完整把后端 errors 原文带出来，避免出现"点了没反应"。
 */
export function syncNoticeFor(result: RepoSyncResult): SyncNotice | null {
  if (result.status === "failed") {
    return {
      tone: "error",
      title: result.rate_limited ? "GitHub 限流，本次没有取到新数据" : "同步失败",
      // 限流时 message 本身就是完整说明，errors 只是同一句话按数据源重复三遍。
      detail: result.rate_limited ? result.message : summarizeSyncErrors(result),
    };
  }
  if (result.status === "partial") {
    return {
      tone: "warn",
      title: result.rate_limited ? "同步不完整（GitHub 限流）" : "同步不完整",
      detail: result.rate_limited ? result.message : summarizeSyncErrors(result),
    };
  }
  return null;
}

export function makeDraftConversationId(repoId: string) {
  return `${DRAFT_CONVERSATION_PREFIX}${repoId}:${crypto.randomUUID()}`;
}

export function isDraftConversationId(value: string) {
  return value.startsWith(DRAFT_CONVERSATION_PREFIX);
}

export function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function summarizeConversationTitle(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const firstSentence = normalized.split(/[。！？!?.]/)[0]?.trim() || normalized;
  const title = firstSentence || normalized || "新会话";
  return title.length > 24 ? `${title.slice(0, 24)}...` : title;
}

export function compactJson(value: unknown, maxLength = 900) {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function traceContentFromResult(content: unknown) {
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const record = content as Record<string, unknown>;
    if (typeof record.answer_preview === "string" && record.answer_preview.trim()) {
      return record.answer_preview;
    }
  }
  return compactJson(content);
}

export function makeToolUseTrace(data: ChatStreamToolUse, fallbackId: string): ChatTraceItem {
  const toolName = data.tool_name || "tool";
  const args = compactJson(data.arguments, 700);
  return {
    id: data.id || fallbackId,
    kind: "tool",
    title: `调用工具 ${toolName}`,
    content: args ? `参数:\n${args}` : "正在执行...",
    status: "running",
    toolUseId: data.id,
    skillName: data.skill_name,
    skillTitle: data.skill_title,
    skillVersion: data.skill_version,
    skillSteps: data.skill_steps,
    skillActivationMode: data.skill_activation_mode,
    skillActivationReason: data.skill_activation_reason,
    skillInstructionDigest: data.skill_instruction_digest,
  };
}

export function makeToolResultTrace(data: ChatStreamToolResult, fallbackId: string): ChatTraceItem {
  const toolName = data.tool_name || "tool";
  const failed = data.status === "error";
  const content = data.error || traceContentFromResult(data.content) || data.route || "";
  return {
    id: data.tool_use_id || fallbackId,
    kind: failed ? "error" : "tool",
    title: `${failed ? "工具失败" : "工具完成"} ${toolName}`,
    content,
    status: failed ? "error" : "done",
    toolUseId: data.tool_use_id,
    skillName: data.skill_name,
    skillTitle: data.skill_title,
    skillVersion: data.skill_version,
    skillSteps: data.skill_steps,
    skillActivationMode: data.skill_activation_mode,
    skillActivationReason: data.skill_activation_reason,
    skillInstructionDigest: data.skill_instruction_digest,
  };
}

export function traceItemsFromAgentEvents(
  events: Array<Record<string, unknown>> = [],
): ChatTraceItem[] {
  const items: ChatTraceItem[] = [];
  events.forEach((event, index) => {
    const type = String(event.type || "");
    if (type === "skill_activated") {
      const resources = Array.isArray(event.resources)
        ? event.resources.map((value) => contextRecord(value))
        : [];
      items.push({
        id: `history-skill-activated-${index}`,
        kind: "tool",
        title: "Skill 已按需激活",
        content: [
          `方式：${contextString(event.activation_mode) || "unknown"}`,
          contextString(event.activation_reason)
            ? `原因：${contextString(event.activation_reason)}`
            : "",
          contextString(event.entrypoint) ? `入口：${contextString(event.entrypoint)}` : "",
          contextString(event.instruction_digest)
            ? `指令摘要：${contextString(event.instruction_digest)}`
            : "",
          resources.length
            ? `按需资源：${resources
                .map((resource) => contextString(resource.path))
                .filter(Boolean)
                .join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        status: "done",
        skillName: contextString(event.skill_name),
        skillTitle: contextString(event.skill_title),
        skillVersion: contextString(event.skill_version),
        skillSteps: Array.isArray(event.workflow_steps) ? event.workflow_steps.map(String) : [],
        skillActivationMode: contextString(event.activation_mode),
        skillActivationReason: contextString(event.activation_reason),
        skillInstructionDigest: contextString(event.instruction_digest),
      });
      return;
    }
    if (type === "skill_validation") {
      const status = contextString(event.status) || "not_executed";
      const failed = status === "violated" || status === "failed";
      const violations = Array.isArray(event.tool_contract_violations)
        ? event.tool_contract_violations.map(String)
        : [];
      items.push({
        id: `history-skill-validation-${index}`,
        kind: failed ? "error" : "tool",
        title:
          status === "violated"
            ? "Skill 契约校验失败"
            : status === "failed"
              ? "Skill 执行失败"
              : "Skill 运行校验",
        content: [
          `状态：${status}`,
          `完整指令：${event.instructions_loaded === true ? "已加载" : "未加载"}`,
          `步骤验证：${contextString(event.step_verification) || "unknown"}`,
          Array.isArray(event.observed_tools) && event.observed_tools.length
            ? `观察到的工具：${event.observed_tools.map(String).join(", ")}`
            : "",
          violations.length ? `越界工具：${violations.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        status: failed ? "error" : "done",
        skillName: contextString(event.skill_name),
        skillTitle: contextString(event.skill_title),
        skillVersion: contextString(event.skill_version),
        skillSteps: Array.isArray(event.declared_steps) ? event.declared_steps.map(String) : [],
      });
      return;
    }
    if (type === "rag_strategy") {
      const preRetrieval = contextRecord(event.pre_retrieval);
      const reasoningRetrieval = contextRecord(event.reasoning_retrieval);
      const enabled = preRetrieval.enabled === true;
      const evidenceCount = contextNumber(preRetrieval.evidence_count);
      const query = contextString(preRetrieval.query);
      const sourceLines = Array.isArray(preRetrieval.sources)
        ? preRetrieval.sources
            .slice(0, 8)
            .map((value) => contextRecord(value))
            .map((source) => {
              const title = contextString(source.title) || "未命名证据";
              const sourceType = contextString(source.source_type) || "evidence";
              return `- [${sourceType}] ${title}`;
            })
        : [];
      items.push({
        id: `history-rag-strategy-${index}`,
        kind: "rag_prefetch",
        title: "RAG 预检索",
        content: [
          `模式：${contextString(event.mode) === "hybrid_rag" ? "混合 RAG" : "工具调用"}`,
          query ? `查询：${query}` : "",
          `调用前检索：${enabled ? `已启用 · 命中 ${evidenceCount} 条证据` : "未启用"}`,
          sourceLines.length ? `证据来源：\n${sourceLines.join("\n")}` : "",
          `Agent 二次检索：${reasoningRetrieval.enabled === true ? "可用（支持查询改写与多次补查）" : "未启用"}`,
        ]
          .filter(Boolean)
          .join("\n"),
        status: "done",
        evidenceCount,
      });
      return;
    }
    if (type === "thought" && typeof event.content === "string" && event.content.trim()) {
      items.push({
        id: `history-thought-${index}`,
        kind: "thinking",
        title: "公开思路",
        content: event.content,
        status: "done",
      });
      return;
    }
    if (type === "tool_use") {
      items.push(
        makeToolUseTrace(
          {
            id: typeof event.id === "string" ? event.id : `history-tool-${index}`,
            tool_name: typeof event.tool_name === "string" ? event.tool_name : undefined,
            arguments:
              event.arguments && typeof event.arguments === "object"
                ? (event.arguments as Record<string, unknown>)
                : undefined,
            skill_name: typeof event.skill_name === "string" ? event.skill_name : undefined,
            skill_title: typeof event.skill_title === "string" ? event.skill_title : undefined,
            skill_version:
              typeof event.skill_version === "string" ? event.skill_version : undefined,
            skill_steps: Array.isArray(event.skill_steps)
              ? event.skill_steps.map(String)
              : undefined,
            skill_activation_mode:
              typeof event.skill_activation_mode === "string"
                ? event.skill_activation_mode
                : undefined,
            skill_activation_reason:
              typeof event.skill_activation_reason === "string"
                ? event.skill_activation_reason
                : undefined,
            skill_instruction_digest:
              typeof event.skill_instruction_digest === "string"
                ? event.skill_instruction_digest
                : undefined,
          },
          `history-tool-${index}`,
        ),
      );
      return;
    }
    if (type === "tool_result") {
      const result = makeToolResultTrace(
        {
          tool_use_id: typeof event.tool_use_id === "string" ? event.tool_use_id : undefined,
          tool_name: typeof event.tool_name === "string" ? event.tool_name : undefined,
          status: typeof event.status === "string" ? event.status : undefined,
          route: typeof event.route === "string" ? event.route : undefined,
          content: event.content,
          skill_name: typeof event.skill_name === "string" ? event.skill_name : undefined,
          skill_title: typeof event.skill_title === "string" ? event.skill_title : undefined,
          skill_version: typeof event.skill_version === "string" ? event.skill_version : undefined,
          skill_steps: Array.isArray(event.skill_steps) ? event.skill_steps.map(String) : undefined,
          skill_activation_mode:
            typeof event.skill_activation_mode === "string"
              ? event.skill_activation_mode
              : undefined,
          skill_activation_reason:
            typeof event.skill_activation_reason === "string"
              ? event.skill_activation_reason
              : undefined,
          skill_instruction_digest:
            typeof event.skill_instruction_digest === "string"
              ? event.skill_instruction_digest
              : undefined,
        },
        `history-result-${index}`,
      );
      const existingIndex = result.toolUseId
        ? items.findIndex((item) => item.toolUseId === result.toolUseId)
        : -1;
      if (existingIndex >= 0) {
        items[existingIndex] = { ...items[existingIndex], ...result, id: items[existingIndex].id };
      } else {
        items.push(result);
      }
      return;
    }
    if (type === "workflow_replan") {
      const addedTasks = Array.isArray(event.added_tasks)
        ? event.added_tasks.map(String).filter(Boolean)
        : [];
      items.push({
        id: `history-workflow-replan-${index}`,
        kind: "tool",
        title: "Planner 重新规划",
        content: [
          typeof event.reason === "string" ? event.reason : "",
          addedTasks.length ? `新增任务: ${addedTasks.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        status: "done",
      });
      return;
    }
    if (type === "workflow_task_result") {
      const status = typeof event.status === "string" ? event.status : "done";
      const failed = status === "error";
      items.push({
        id: `history-workflow-task-${index}`,
        kind: failed ? "error" : "tool",
        title: `${failed ? "任务失败" : "任务完成"} ${typeof event.task_type === "string" ? event.task_type : "workflow"}`,
        content: typeof event.summary === "string" ? event.summary : "",
        status: failed ? "error" : "done",
        skillName: contextString(event.skill_name),
        skillTitle: contextString(event.skill_title),
        skillVersion: contextString(event.skill_version),
        skillSteps: Array.isArray(event.skill_steps) ? event.skill_steps.map(String) : [],
        skillActivationMode: contextString(event.skill_activation_mode),
        skillActivationReason: contextString(event.skill_activation_reason),
        skillInstructionDigest: contextString(event.skill_instruction_digest),
      });
      return;
    }
    if (type === "workflow_observer_result") {
      const findings = Array.isArray(event.findings) ? event.findings.length : 0;
      items.push({
        id: `history-workflow-observer-${index}`,
        kind: "thinking",
        title: "Observer 检查",
        content: `confidence=${event.overall_confidence ?? "-"}, findings=${findings}`,
        status: "done",
      });
    }
  });
  return items;
}

export function finalizedTraceItems(
  events: Array<Record<string, unknown>> | undefined,
  fallback: ChatTraceItem[] | undefined,
) {
  const finalized = traceItemsFromAgentEvents(events ?? []);
  return finalized.length > 0 ? finalized : (fallback ?? []);
}

export function formatRelativeTime(value?: string | null) {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "刚刚";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时`;
  return `${Math.floor(diffMs / day)} 天`;
}
export function contextRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function contextNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function contextString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function contextStageLabel(stage: string): string {
  if (stage === "warning") return "接近阈值";
  if (stage === "auto_compact") return "自动压缩";
  if (stage === "aggressive") return "强压缩";
  if (stage === "manual_path") return "正式压缩";
  return "正常";
}

export function contextReasonLabel(reason: string): string {
  if (reason === "microcompact_sufficient") return "轻量压缩后已经恢复安全余量";
  if (reason === "normal") return "当前上下文仍在安全区";
  if (reason === "warning") return "已经接近阈值，但暂时不需要正式压缩";
  if (reason === "not_enough_messages") return "历史消息不足，无法生成压缩摘要";
  if (reason === "nothing_to_summarize") return "没有需要继续摘要的旧消息";
  if (reason === "compacted") return "原始片段超过阈值，已生成摘要边界";
  return reason;
}
export function numberFromUnknown(value: unknown) {
  return typeof value === "number" ? value : Number(value || 0) || 0;
}

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function formatDateTime(value?: string | null) {
  if (!value) return "暂无时间";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return time.toLocaleString();
}

export function memoryCandidateKindLabel(kind: string) {
  const labels: Record<string, string> = {
    decision: "决策",
    fact: "事实",
    task: "任务",
    preference: "偏好",
    repo_context: "项目上下文",
  };
  return labels[kind] ?? kind;
}
export function knowledgeTypeLabel(sourceType: string) {
  if (sourceType === "knowledge_file") return "上传文件";
  if (sourceType === "weekly_report") return "周报";
  if (sourceType === "project_overview") return "项目概况";
  if (sourceType === "project_doc") return "项目文档";
  if (sourceType === "project_manifest") return "项目清单";
  if (sourceType === "memory_note") return "记忆";
  if (sourceType === "team_member") return "团队成员";
  return sourceType;
}
export function classifyIssue(issue: Issue) {
  const labels = (issue.labels ?? []).map((label) => label.toLowerCase());
  const text = `${issue.title} ${issue.body ?? ""}`.toLowerCase();
  if (
    labels.some((label) => ["rejected", "wontfix", "invalid", "duplicate"].includes(label)) ||
    text.includes("reject")
  )
    return "rejected";
  if (labels.some((label) => ["accepted", "resolved", "done", "fixed"].includes(label)))
    return "accepted";
  if (issue.state === "closed") return "closed";
  if (labels.some((label) => ["decision", "needs-decision", "rfc", "proposal"].includes(label)))
    return "decision";
  if ((issue.assignees?.length ?? 0) === 0 && !issue.body) return "unanswered";
  if (labels.length === 0 && (issue.assignees?.length ?? 0) === 0) return "unanswered";
  return "discussing";
}

export function classifyPr(pr: PullRequest) {
  const text =
    `${pr.title} ${pr.body ?? ""} ${(pr.files ?? []).map((file) => file.patch ?? file.filename).join(" ")}`.toLowerCase();
  if (pr.state === "closed" && !pr.merged_at) return "rejected";
  if (text.includes("conflict")) return "conflict";
  if (pr.merged_at) return "done";
  if (!pr.author) return "needsOwner";
  return "reviewing";
}

export function matchesQuery(query: string, values: Array<string | null | undefined>) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

export function matchesStatus(filter: string, value?: string | null) {
  if (filter === "all") return true;
  return value === filter;
}

export function matchesOwner(filter: string, people: string[]) {
  const normalizedPeople = people.filter(Boolean);
  if (filter === "all") return true;
  if (filter === "unassigned") return normalizedPeople.length === 0;
  return normalizedPeople.includes(filter);
}

export function matchesTime(filter: string, value?: string | null) {
  if (filter === "all" || !value) return true;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return true;
  const days = filter === "7d" ? 7 : 30;
  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
}

export function formatDate(value?: string | null) {
  if (!value) return "无";
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parseRepositoryInput(value: string): { owner: string; repo: string } | null {
  const input = value.trim();
  if (!input) return null;

  let path = input;
  const sshMatch = input.match(/^git@[^:]+:(.+)$/);
  if (sshMatch) {
    path = sshMatch[1];
  } else {
    try {
      const url = new URL(input);
      path = url.pathname;
    } catch {
      path = input;
    }
  }

  const parts = path
    .replace(/^\/+/, "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function getFriendlyError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw === "Failed to fetch") {
    return "无法访问后端 API。请确认后端服务已启动，并且 CORS 允许当前前端端口。";
  }
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; message?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // 下面回退到原始错误消息。
  }
  return raw || "未知错误";
}
