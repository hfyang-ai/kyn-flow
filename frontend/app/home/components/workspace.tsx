"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  GitPullRequest,
  ListTodo,
  Search,
  type LucideIcon,
} from "lucide-react";

import type {
  Issue,
  PullRequest,
  TeamMember,
  TeamMemberDraft,
  WorkspaceItem,
  WorkflowRun,
} from "../types";
import { type WorkspaceTab } from "../constants";
import { formatDate } from "../utils";

export function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 text-xs font-medium text-faint">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular-nums">
        {value}
      </div>
    </div>
  );
}

export function WorkspaceControls({
  query,
  status,
  owner,
  time,
  owners,
  activeTab,
  onQueryChange,
  onStatusChange,
  onOwnerChange,
  onTimeChange,
}: {
  query: string;
  status: string;
  owner: string;
  time: string;
  owners: string[];
  activeTab: WorkspaceTab;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onOwnerChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="关键词搜索标题、正文、标签"
          className="h-10 w-full rounded-md border border-line bg-panel pl-9 pr-3 text-sm outline-none transition focus:border-sage-600 focus:ring-2 focus:ring-sage-100"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SelectFilter value={status} onChange={onStatusChange} label="状态">
          <option value="all">全部状态</option>
          <option value="open">open</option>
          <option value="closed">closed</option>
          {activeTab === "PR" && <option value="merged">merged</option>}
          {activeTab === "CI" && <option value="failure">failure</option>}
          {activeTab === "CI" && <option value="success">success</option>}
        </SelectFilter>
        <SelectFilter
          value={owner}
          onChange={onOwnerChange}
          label="负责人"
          disabled={activeTab === "CI"}
        >
          <option value="all">全部负责人</option>
          <option value="unassigned">未分配</option>
          {owners.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter value={time} onChange={onTimeChange} label="时间">
          <option value="all">全部时间</option>
          <option value="7d">近 7 天</option>
          <option value="30d">近 30 天</option>
        </SelectFilter>
      </div>
    </div>
  );
}

export function SelectFilter({
  value,
  label,
  disabled,
  children,
  onChange,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full appearance-none rounded-md border border-line bg-panel px-2 pr-7 text-xs text-ink outline-none transition focus:border-sage-600 focus:ring-2 focus:ring-sage-100 disabled:bg-stone-100 disabled:text-faint"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
    </label>
  );
}

export function CategoryGroup({
  label,
  color,
  count,
  items,
  isCollapsed,
  onToggle,
}: {
  label: string;
  color: string;
  count: number;
  items: WorkspaceItem[];
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        className="flex h-7 w-full items-center justify-between"
      >
        <div className={`flex items-center gap-2 text-sm font-semibold ${color}`}>
          <span>{label}</span>
          <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs font-medium text-faint">
            {count}
          </span>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-faint transition ${isCollapsed ? "-rotate-90" : ""}`}
        />
      </button>
      {!isCollapsed && items.length > 0 && (
        <div className="mt-2 space-y-2">
          {items.map((item) => (
            <WorkspaceItemButton key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

export function WorkspaceItemButton({ item }: { item: WorkspaceItem }) {
  return (
    <button
      onClick={item.onClick}
      className={`w-full rounded-md border bg-panel p-3 text-left transition ${
        item.selected
          ? "border-sage-600 ring-2 ring-sage-500"
          : "border-line hover:border-sage-700 hover:bg-sage-100"
      }`}
    >
      <div className="line-clamp-2 text-sm font-medium text-ink">{item.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-faint">
        <span>{item.meta}</span>
        {item.badges?.slice(0, 3).map((badge) => (
          <span key={badge} className="rounded-full bg-panel px-2 py-0.5">
            {badge}
          </span>
        ))}
      </div>
      {item.detail && (
        <div className="mt-2 line-clamp-2 text-xs leading-5 text-faint">{item.detail}</div>
      )}
    </button>
  );
}

export function WorkspaceDetail({
  issue,
  pr,
  run,
  analyzingIssue,
  analyzingPr,
  analyzingRun,
  onAnalyzeIssue,
  onAnalyzePr,
  onAnalyzeRun,
  onClose,
}: {
  issue?: Issue;
  pr?: PullRequest;
  run?: WorkflowRun;
  analyzingIssue?: boolean;
  analyzingPr?: boolean;
  analyzingRun?: boolean;
  onAnalyzeIssue?: () => void;
  onAnalyzePr?: () => void;
  onAnalyzeRun?: () => void;
  onClose: () => void;
}) {
  const title = issue
    ? `#${issue.number} ${issue.title}`
    : pr
      ? `#${pr.number} ${pr.title}`
      : (run?.name ?? "");
  const body = issue?.body ?? pr?.body ?? run?.logs_text ?? "暂无详情内容";
  const status =
    issue?.state ?? (pr?.merged_at ? "merged" : pr?.state) ?? run?.conclusion ?? run?.status ?? "";
  const owner = issue?.assignees?.join(", ") || issue?.author || pr?.author || "未分配";
  const updatedAt =
    issue?.updated_at ??
    issue?.created_at ??
    pr?.updated_at ??
    pr?.created_at ??
    run?.updated_at ??
    run?.created_at;

  return (
    <div className="mb-4 rounded-md border border-sage-700 bg-panel p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            详情
          </div>
          <h3 className="mt-1 text-sm font-semibold leading-6 text-ink">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {issue && (
            <button
              onClick={onAnalyzeIssue}
              disabled={!onAnalyzeIssue || analyzingIssue}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink transition hover:bg-accent-bright disabled:opacity-60"
            >
              <ListTodo className="h-3.5 w-3.5" />
              {analyzingIssue ? "分析中..." : "分析当前 Issue"}
            </button>
          )}
          {pr && (
            <button
              onClick={onAnalyzePr}
              disabled={!onAnalyzePr || analyzingPr}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink transition hover:bg-accent-bright disabled:opacity-60"
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              {analyzingPr ? "分析中..." : "分析当前 PR"}
            </button>
          )}
          {run && (
            <button
              onClick={onAnalyzeRun}
              disabled={!onAnalyzeRun || analyzingRun}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink transition hover:bg-accent-bright disabled:opacity-60"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {analyzingRun ? "排查中..." : "分析当前 CI"}
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-md border border-line px-2 py-1 text-xs text-faint transition hover:bg-panel"
          >
            关闭
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <MetaPill label="状态" value={status} />
        <MetaPill label="负责人" value={owner} />
        <MetaPill label="更新时间" value={formatDate(updatedAt)} />
      </div>
      {(issue?.labels?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {issue?.labels?.map((label) => (
            <span
              key={label}
              className="rounded-full bg-sage-100 px-2 py-0.5 text-xs text-accent"
            >
              {label}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 whitespace-pre-wrap rounded-md bg-panel-2 p-3 text-xs leading-6 text-ink">
        {body}
      </div>
      {pr?.files && pr.files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {pr.files.map((file) => (
            <div
              key={file.id}
              className="rounded-md border border-line bg-panel px-2 py-1.5 text-xs text-muted"
            >
              <span className="font-medium text-ink">{file.filename}</span>
              <span className="ml-2 text-emerald-600">+{file.additions}</span>
              <span className="ml-1 text-rose-600">-{file.deletions}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full bg-panel px-2.5 py-1 text-xs text-muted">
      {label}: {value}
    </span>
  );
}

export function EmptyWorkspaceState({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-line bg-panel p-4 text-sm text-faint">{label}</div>
  );
}

export function TeamWorkspace({
  members,
  draft,
  onDraftChange,
  onAddMember,
  onRemoveMember,
}: {
  members: TeamMember[];
  draft: TeamMemberDraft;
  onDraftChange: (value: TeamMemberDraft) => void;
  onAddMember: () => void;
  onRemoveMember: (memberId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-md border border-line bg-panel p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">人员管理</h3>
            <p className="mt-1 text-xs leading-5 text-faint">
              配置项目工作者，Agent 会在分配 Issue 时参考职位、擅长方向和技术栈。
            </p>
          </div>
          <span className="rounded-full bg-panel px-2 py-0.5 text-xs text-faint">
            {members.length} 人
          </span>
        </div>

        <div className="mt-4 grid gap-2">
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            placeholder="姓名，例如 Alice"
            className="h-9 rounded-md border border-line bg-panel px-3 text-sm outline-none focus:border-sage-600 focus:ring-2 focus:ring-sage-100"
          />
          <input
            value={draft.role}
            onChange={(event) => onDraftChange({ ...draft, role: event.target.value })}
            placeholder="职位，例如 后端工程师 / 前端工程师 / Tech Lead"
            className="h-9 rounded-md border border-line bg-panel px-3 text-sm outline-none focus:border-sage-600 focus:ring-2 focus:ring-sage-100"
          />
          <textarea
            value={draft.strengths}
            onChange={(event) => onDraftChange({ ...draft, strengths: event.target.value })}
            placeholder="擅长，例如 鉴权、API 设计、CI 排查"
            className="min-h-16 resize-none rounded-md border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-sage-600 focus:ring-2 focus:ring-sage-100"
          />
          <input
            value={draft.techStack}
            onChange={(event) => onDraftChange({ ...draft, techStack: event.target.value })}
            placeholder="技术栈，例如 Python, FastAPI, PostgreSQL"
            className="h-9 rounded-md border border-line bg-panel px-3 text-sm outline-none focus:border-sage-600 focus:ring-2 focus:ring-sage-100"
          />
          <button
            onClick={onAddMember}
            disabled={!draft.name.trim()}
            className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition hover:bg-accent-bright disabled:opacity-60"
          >
            添加成员
          </button>
        </div>
      </section>

      <section className="rounded-md border border-line bg-panel p-4">
        <h3 className="text-sm font-semibold text-ink">团队成员</h3>
        <div className="mt-3 space-y-2">
          {members.length === 0 && (
            <div className="rounded-md bg-panel p-3 text-sm text-faint">
              还没有成员。先添加一个项目工作者。
            </div>
          )}
          {members.map((member) => (
            <div key={member.id} className="rounded-md border border-line bg-panel p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{member.name}</div>
                  <div className="mt-1 text-xs text-faint">{member.role || "未配置职位"}</div>
                </div>
                <button
                  onClick={() => onRemoveMember(member.id)}
                  className="rounded-md border border-line px-2 py-1 text-xs text-faint hover:bg-panel"
                >
                  移除
                </button>
              </div>
              <div className="mt-3 space-y-1 text-xs leading-5 text-muted">
                <div>擅长：{member.strengths || "未配置"}</div>
                <div>技术栈：{member.techStack || "未配置"}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-line bg-panel p-4 text-sm leading-7 text-muted">
        <div className="font-medium text-ink">报告管理</div>
        <p className="mt-2">
          可在中间对话框输入“生成本周研发周报”，或进入周报页面查看 Markdown 预览。
        </p>
        <Link
          href="/reports"
          className="mt-3 inline-flex rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink"
        >
          打开周报页
        </Link>
      </section>
    </div>
  );
}
