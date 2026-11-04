"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Folder,
  GitPullRequest,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Send,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";

import { apiDelete, apiGet, apiPost, apiPostStream, apiUpload } from "@/lib/api";
import type { Repository } from "@/lib/types";
import { FeedbackControls, type ChatFeedbackRecord } from "@/components/feedback-controls";

import type {
  AddProjectSource,
  AddProjectStatus,
  ChatHistoryMessage,
  ChatMessage,
  ChatPlanResponse,
  ChatStreamDelta,
  ChatStreamFinal,
  ChatStreamToolResult,
  ChatStreamToolUse,
  ChatTraceItem,
  ConversationDeleteResult,
  Issue,
  IssueAnalysisResponse,
  IssueAnalysisTraceItem,
  KnowledgeGraphResponse,
  KnowledgeItem,
  McpRuntime,
  MemoryNote,
  MemoryNoteDraft,
  PRAnalysisResponse,
  CIAnalysisResponse,
  ProjectConversation,
  ProjectIndexState,
  PromptRecommendationsResponse,
  PromptSuggestionState,
  PullRequest,
  RepoConnectResult,
  RepoSyncResult,
  SkillResponse,
  SyncNotice,
  TeamMember,
  TeamMemberDraft,
  WorkspaceSelection,
  WorkflowRun,
} from "./types";
import { issueCategoryMeta, prCategoryMeta, workspaceTabs, type WorkspaceTab } from "./constants";
import {
  classifyIssue,
  classifyPr,
  finalizedTraceItems,
  formatRelativeTime,
  getFriendlyError,
  isDraftConversationId,
  makeDraftConversationId,
  makeToolResultTrace,
  makeToolUseTrace,
  matchesOwner,
  matchesQuery,
  matchesStatus,
  matchesTime,
  parseRepositoryInput,
  summarizeConversationTitle,
  syncNoticeFor,
  traceItemsFromAgentEvents,
  wait,
} from "./utils";

import {
  ChatTraceInline,
  ContextDiagnostics,
  MarkdownMessage,
  WorkflowPlanCard,
} from "./components/chat";
import { SkillMcpWorkspace } from "./components/skill-mcp";
import { CIAnalysisOverlay, IssueAnalysisOverlay, PRAnalysisOverlay } from "./components/analysis";
import { AddProjectOverlay } from "./components/add-project";
import {
  CategoryGroup,
  EmptyWorkspaceState,
  MetricCard,
  TeamWorkspace,
  WorkspaceControls,
  WorkspaceDetail,
  WorkspaceItemButton,
} from "./components/workspace";
import { MemoryHubWorkspace, MemoryIndexPromptCard } from "./components/memory";
import {
  KnowledgeGraphWorkspace,
  knowledgeGraphNodeKey,
  openGraphNodeInWorkspace,
  workspaceSelectionToGraphCenter,
} from "./components/knowledge-graph";

export default function DashboardPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [conversationMap, setConversationMap] = useState<Record<string, ProjectConversation[]>>({});
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [expandedRepoIds, setExpandedRepoIds] = useState<Record<string, boolean>>({});
  const [issues, setIssues] = useState<Issue[]>([]);
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("Issue");
  const [workspaceWidth, setWorkspaceWidth] = useState(420);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("all");
  const [workspaceOwner, setWorkspaceOwner] = useState("all");
  const [workspaceTime, setWorkspaceTime] = useState("all");
  const [selectedWorkspaceItem, setSelectedWorkspaceItem] = useState<WorkspaceSelection | null>(
    null,
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [memberDraft, setMemberDraft] = useState<TeamMemberDraft>({
    name: "",
    role: "",
    strengths: "",
    techStack: "",
  });
  const [memoryNotes, setMemoryNotes] = useState<MemoryNote[]>([]);
  const [memoryDraft, setMemoryDraft] = useState<MemoryNoteDraft>({ title: "", content: "" });
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [uploadingKnowledge, setUploadingKnowledge] = useState(false);
  const [mcpRuntime, setMcpRuntime] = useState<McpRuntime | null>(null);
  const [skills, setSkills] = useState<SkillResponse[]>([]);
  const [selectedSkillName, setSelectedSkillName] = useState("project-investigation");
  const [skillRuntimeLoading, setSkillRuntimeLoading] = useState(false);
  const [skillRuntimeError, setSkillRuntimeError] = useState<string | null>(null);
  const [projectIndexByRepo, setProjectIndexByRepo] = useState<Record<string, ProjectIndexState>>(
    {},
  );
  const [indexScanningRepoId, setIndexScanningRepoId] = useState<string | null>(null);
  const [indexActionError, setIndexActionError] = useState<string | null>(null);
  const [knowledgeGraphByRepo, setKnowledgeGraphByRepo] = useState<
    Record<string, KnowledgeGraphResponse | null>
  >({});
  const [graphLoadingRepoId, setGraphLoadingRepoId] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphQuery, setGraphQuery] = useState("");
  const [selectedGraphNodeKey, setSelectedGraphNodeKey] = useState<string | null>(null);
  const [hiddenGraphNodeTypes, setHiddenGraphNodeTypes] = useState<Record<string, boolean>>({});
  const [hiddenGraphRelations, setHiddenGraphRelations] = useState<Record<string, boolean>>({});
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [projectSource, setProjectSource] = useState<AddProjectSource>("remote");
  const [projectUrl, setProjectUrl] = useState("");
  const [projectLocalPath, setProjectLocalPath] = useState("");
  const [projectCloneParentDir, setProjectCloneParentDir] = useState("");
  const [projectProvider, setProjectProvider] = useState("github");
  const [projectApiBaseUrl, setProjectApiBaseUrl] = useState("https://api.github.com");
  const [projectToken, setProjectToken] = useState("");
  const [addProjectStatus, setAddProjectStatus] = useState<AddProjectStatus | null>(null);
  const [connectingProject, setConnectingProject] = useState(false);
  const [loading, setLoading] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [promptStateByRepo, setPromptStateByRepo] = useState<Record<string, PromptSuggestionState>>(
    {},
  );
  const [loadingPromptRepoId, setLoadingPromptRepoId] = useState<string | null>(null);
  const [promptLoadingDots, setPromptLoadingDots] = useState(".");
  const [issueAnalysisById, setIssueAnalysisById] = useState<Record<string, IssueAnalysisResponse>>(
    {},
  );
  const [issueAnalysisTraceById, setIssueAnalysisTraceById] = useState<
    Record<string, IssueAnalysisTraceItem[]>
  >({});
  const [analysisModalIssueId, setAnalysisModalIssueId] = useState<string | null>(null);
  const [analyzingIssueId, setAnalyzingIssueId] = useState<string | null>(null);
  const [issueAnalysisError, setIssueAnalysisError] = useState<string | null>(null);
  const [prAnalysisById, setPrAnalysisById] = useState<Record<string, PRAnalysisResponse>>({});
  const [prAnalysisTraceById, setPrAnalysisTraceById] = useState<
    Record<string, IssueAnalysisTraceItem[]>
  >({});
  const [analysisModalPrId, setAnalysisModalPrId] = useState<string | null>(null);
  const [analyzingPrId, setAnalyzingPrId] = useState<string | null>(null);
  const [prAnalysisError, setPrAnalysisError] = useState<string | null>(null);
  const [ciAnalysisById, setCiAnalysisById] = useState<Record<string, CIAnalysisResponse>>({});
  const [ciAnalysisTraceById, setCiAnalysisTraceById] = useState<
    Record<string, IssueAnalysisTraceItem[]>
  >({});
  const [analysisModalRunId, setAnalysisModalRunId] = useState<string | null>(null);
  const [analyzingRunId, setAnalyzingRunId] = useState<string | null>(null);
  const [ciAnalysisError, setCiAnalysisError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<SyncNotice | null>(null);
  const skipHistoryLoadRef = useRef(false);
  const preserveWorkspaceSelectionRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const promptRowRef = useRef<HTMLDivElement>(null);
  const promptMeasureRef = useRef<HTMLDivElement>(null);
  const [visiblePromptCount, setVisiblePromptCount] = useState(5);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.id === selectedRepoId) ?? repos[0],
    [repos, selectedRepoId],
  );
  const selectedRepoConversations = selectedRepo ? (conversationMap[selectedRepo.id] ?? []) : [];
  const isDraftConversation = isDraftConversationId(selectedConversationId);
  const selectedConversation = isDraftConversation
    ? undefined
    : (selectedRepoConversations.find((item) => item.id === selectedConversationId) ??
      selectedRepoConversations[0]);
  const selectedPromptState = selectedRepo ? promptStateByRepo[selectedRepo.id] : undefined;
  const selectedProjectIndexState = selectedRepo ? projectIndexByRepo[selectedRepo.id] : undefined;
  const selectedKnowledgeGraph = selectedRepo ? knowledgeGraphByRepo[selectedRepo.id] : null;
  const promptSuggestions = selectedPromptState?.suggestions ?? [];
  const promptExclude = selectedPromptState?.exclude ?? [];
  const loadingPrompts = Boolean(selectedRepo?.id && loadingPromptRepoId === selectedRepo.id);

  async function loadRepos() {
    const items = await apiGet<Repository[]>("/api/repos");
    setRepos(items);
    const pairs = await Promise.all(
      items.map(
        async (repo) =>
          [
            repo.id,
            await apiGet<ProjectConversation[]>(`/api/repos/${repo.id}/conversations`).catch(
              () => [],
            ),
          ] as const,
      ),
    );
    const nextMap = Object.fromEntries(pairs);
    setConversationMap(nextMap);
    setExpandedRepoIds((current) => {
      const firstRepoId = items[0]?.id;
      return firstRepoId && Object.keys(current).length === 0 ? { [firstRepoId]: true } : current;
    });
    setSelectedRepoId((current) => current || items[0]?.id || "");
    setSelectedConversationId(
      (current) => current || (items[0] ? (nextMap[items[0].id]?.[0]?.id ?? "") : ""),
    );
  }

  async function loadRepoConversations(repoId: string) {
    const conversations = await apiGet<ProjectConversation[]>(
      `/api/repos/${repoId}/conversations`,
    ).catch(() => []);
    setConversationMap((items) => ({ ...items, [repoId]: conversations }));
    return conversations;
  }

  async function loadRepoData(repoId: string) {
    const [issueItems, prItems, runItems] = await Promise.all([
      apiGet<Issue[]>(`/api/repos/${repoId}/issues`).catch(() => []),
      apiGet<PullRequest[]>(`/api/repos/${repoId}/pull-requests`).catch(() => []),
      apiGet<WorkflowRun[]>(`/api/repos/${repoId}/workflow-runs`).catch(() => []),
    ]);
    setIssues(issueItems);
    setPrs(prItems);
    setRuns(runItems);
  }

  async function loadSkillRuntime() {
    setSkillRuntimeLoading(true);
    setSkillRuntimeError(null);
    try {
      const [skillList, runtime] = await Promise.all([
        apiGet<{ skills: SkillResponse[] }>("/api/skills"),
        apiGet<McpRuntime>("/api/skills/mcp-status"),
      ]);
      setSkills(skillList.skills);
      setMcpRuntime(runtime);
      setSelectedSkillName((current) =>
        skillList.skills.some((item) => item.manifest.name === current)
          ? current
          : (skillList.skills[0]?.manifest.name ?? ""),
      );
    } catch (error) {
      setSkillRuntimeError(getFriendlyError(error));
    } finally {
      setSkillRuntimeLoading(false);
    }
  }

  async function loadPromptSuggestions(repoId: string, exclude: string[] = []) {
    setLoadingPromptRepoId(repoId);
    try {
      const result = await apiPost<PromptRecommendationsResponse>("/api/chat/recommendations", {
        repo_id: repoId,
        exclude,
        limit: 5,
      });
      const nextSuggestions = result.suggestions;
      setPromptStateByRepo((items) => {
        const current = items[repoId] ?? { suggestions: [], exclude: [] };
        return {
          ...items,
          [repoId]: {
            ...current,
            suggestions: nextSuggestions.length ? nextSuggestions : current.suggestions,
            exclude: nextSuggestions.length ? [...exclude, ...nextSuggestions] : [],
          },
        };
      });
    } catch {
      setPromptStateByRepo((items) => {
        const current = items[repoId] ?? { suggestions: [], exclude: [] };
        return {
          ...items,
          [repoId]: {
            ...current,
            exclude,
          },
        };
      });
    } finally {
      setLoadingPromptRepoId((current) => (current === repoId ? null : current));
    }
  }

  async function analyzeIssue(issue: Issue) {
    setAnalysisModalIssueId(issue.id);
    setIssueAnalysisError(null);
    setIssueAnalysisById((items) => {
      const next = { ...items };
      delete next[issue.id];
      return next;
    });
    setIssueAnalysisTraceById((items) => ({
      ...items,
      [issue.id]: [
        {
          id: `${Date.now()}-start`,
          kind: "step",
          title: "准备分析",
          content: `准备分析 Issue #${issue.number}，将流式展示可见的分析过程。`,
          status: "running",
        },
      ],
    }));
    setAnalyzingIssueId(issue.id);
    try {
      const conversationQuery =
        selectedConversation?.id && !isDraftConversation
          ? `?conversation_id=${selectedConversation.id}`
          : "";
      await apiPostStream(
        `/api/issues/${issue.id}/analyze/stream${conversationQuery}`,
        {},
        (event, data) => {
          if (event === "trace") {
            const payload = data as Omit<IssueAnalysisTraceItem, "id">;
            const item: IssueAnalysisTraceItem = {
              id: `${Date.now()}-${Math.random()}`,
              ...payload,
            };
            setIssueAnalysisTraceById((items) => ({
              ...items,
              [issue.id]: [...(items[issue.id] ?? []), item],
            }));
            return;
          }
          if (event === "thinking_delta") {
            const payload = data as { content?: string };
            const content = payload.content ?? "";
            if (!content) return;
            setIssueAnalysisTraceById((items) => {
              const current = items[issue.id] ?? [];
              const last = current[current.length - 1];
              if (last?.kind === "thinking" && last.status === "running") {
                return {
                  ...items,
                  [issue.id]: [
                    ...current.slice(0, -1),
                    { ...last, content: `${last.content}${content}` },
                  ],
                };
              }
              return {
                ...items,
                [issue.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-${Math.random()}`,
                    kind: "thinking",
                    title: "LLM 公开分析过程",
                    content,
                    status: "running",
                  },
                ],
              };
            });
            return;
          }
          if (event === "final") {
            const result = data as IssueAnalysisResponse;
            setIssueAnalysisById((items) => ({ ...items, [issue.id]: result }));
            setIssueAnalysisTraceById((items) => {
              const current = (items[issue.id] ?? []).map((item) =>
                item.kind === "thinking" ? { ...item, status: "done" } : item,
              );
              return {
                ...items,
                [issue.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-final`,
                    kind: "result",
                    title: "分析完成",
                    content: `已生成结构化结论：${result.result.conclusion}，优先级 ${result.result.priority}，复杂度 ${result.result.complexity}。`,
                    status: "done",
                  },
                ],
              };
            });
            return;
          }
          if (event === "error") {
            const payload = data as { message?: string };
            const message = payload.message || "分析失败";
            setIssueAnalysisError(message);
            setIssueAnalysisTraceById((items) => ({
              ...items,
              [issue.id]: [
                ...(items[issue.id] ?? []),
                {
                  id: `${Date.now()}-error`,
                  kind: "error",
                  title: "分析失败",
                  content: message,
                  status: "error",
                },
              ],
            }));
          }
        },
      );
    } catch (error) {
      setIssueAnalysisError(getFriendlyError(error));
      setIssueAnalysisTraceById((items) => ({
        ...items,
        [issue.id]: [
          ...(items[issue.id] ?? []),
          {
            id: `${Date.now()}-error`,
            kind: "error",
            title: "请求失败",
            content: getFriendlyError(error),
            status: "error",
          },
        ],
      }));
    } finally {
      setAnalyzingIssueId((current) => (current === issue.id ? null : current));
    }
  }

  async function analyzePr(pr: PullRequest) {
    setAnalysisModalPrId(pr.id);
    setPrAnalysisError(null);
    setPrAnalysisById((items) => {
      const next = { ...items };
      delete next[pr.id];
      return next;
    });
    setPrAnalysisTraceById((items) => ({
      ...items,
      [pr.id]: [
        {
          id: `${Date.now()}-start`,
          kind: "step",
          title: "准备分析",
          content: `准备分析 PR #${pr.number}，将按 plan-and-execute 方式展示 Review 计划、执行过程和合入建议。`,
          status: "running",
        },
      ],
    }));
    setAnalyzingPrId(pr.id);
    try {
      const conversationQuery =
        selectedConversation?.id && !isDraftConversation
          ? `?conversation_id=${selectedConversation.id}`
          : "";
      await apiPostStream(
        `/api/pull-requests/${pr.id}/analyze/stream${conversationQuery}`,
        {},
        (event, data) => {
          if (event === "trace") {
            const payload = data as Omit<IssueAnalysisTraceItem, "id">;
            const item: IssueAnalysisTraceItem = {
              id: `${Date.now()}-${Math.random()}`,
              ...payload,
            };
            setPrAnalysisTraceById((items) => ({
              ...items,
              [pr.id]: [...(items[pr.id] ?? []), item],
            }));
            return;
          }
          if (event === "thinking_delta") {
            const payload = data as { content?: string };
            const content = payload.content ?? "";
            if (!content) return;
            setPrAnalysisTraceById((items) => {
              const current = items[pr.id] ?? [];
              const last = current[current.length - 1];
              if (last?.kind === "thinking" && last.status === "running") {
                return {
                  ...items,
                  [pr.id]: [
                    ...current.slice(0, -1),
                    { ...last, content: `${last.content}${content}` },
                  ],
                };
              }
              return {
                ...items,
                [pr.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-${Math.random()}`,
                    kind: "thinking",
                    title: "LLM 公开执行过程",
                    content,
                    status: "running",
                  },
                ],
              };
            });
            return;
          }
          if (event === "final") {
            const result = data as PRAnalysisResponse;
            setPrAnalysisById((items) => ({ ...items, [pr.id]: result }));
            setPrAnalysisTraceById((items) => {
              const current = (items[pr.id] ?? []).map((item) =>
                item.kind === "thinking" ? { ...item, status: "done" } : item,
              );
              return {
                ...items,
                [pr.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-final`,
                    kind: "result",
                    title: "分析完成",
                    content: `已生成 PR 合入建议：${result.result.merge_recommendation}，风险点 ${(result.result.risk_points ?? []).length} 个，阻塞项 ${(result.result.blocking_issues ?? []).length} 个。`,
                    status: "done",
                  },
                ],
              };
            });
            return;
          }
          if (event === "error") {
            const payload = data as { message?: string };
            const message = payload.message || "分析失败";
            setPrAnalysisError(message);
            setPrAnalysisTraceById((items) => ({
              ...items,
              [pr.id]: [
                ...(items[pr.id] ?? []),
                {
                  id: `${Date.now()}-error`,
                  kind: "error",
                  title: "分析失败",
                  content: message,
                  status: "error",
                },
              ],
            }));
          }
        },
      );
    } catch (error) {
      setPrAnalysisError(getFriendlyError(error));
      setPrAnalysisTraceById((items) => ({
        ...items,
        [pr.id]: [
          ...(items[pr.id] ?? []),
          {
            id: `${Date.now()}-error`,
            kind: "error",
            title: "请求失败",
            content: getFriendlyError(error),
            status: "error",
          },
        ],
      }));
    } finally {
      setAnalyzingPrId((current) => (current === pr.id ? null : current));
    }
  }

  async function analyzeCi(run: WorkflowRun) {
    setAnalysisModalRunId(run.id);
    setCiAnalysisError(null);
    setCiAnalysisById((items) => {
      const next = { ...items };
      delete next[run.id];
      return next;
    });
    setCiAnalysisTraceById((items) => ({
      ...items,
      [run.id]: [
        {
          id: `${Date.now()}-start`,
          kind: "step",
          title: "准备排查",
          content: `准备排查 CI「${run.name}」，将按 plan-and-execute 方式展示排查计划、执行过程、根因和阻塞判断。`,
          status: "running",
        },
      ],
    }));
    setAnalyzingRunId(run.id);
    try {
      const conversationQuery =
        selectedConversation?.id && !isDraftConversation
          ? `?conversation_id=${selectedConversation.id}`
          : "";
      await apiPostStream(
        `/api/workflow-runs/${run.id}/analyze/stream${conversationQuery}`,
        {},
        (event, data) => {
          if (event === "trace") {
            const payload = data as Omit<IssueAnalysisTraceItem, "id">;
            const item: IssueAnalysisTraceItem = {
              id: `${Date.now()}-${Math.random()}`,
              ...payload,
            };
            setCiAnalysisTraceById((items) => ({
              ...items,
              [run.id]: [...(items[run.id] ?? []), item],
            }));
            return;
          }
          if (event === "thinking_delta") {
            const payload = data as { content?: string };
            const content = payload.content ?? "";
            if (!content) return;
            setCiAnalysisTraceById((items) => {
              const current = items[run.id] ?? [];
              const last = current[current.length - 1];
              if (last?.kind === "thinking" && last.status === "running") {
                return {
                  ...items,
                  [run.id]: [
                    ...current.slice(0, -1),
                    { ...last, content: `${last.content}${content}` },
                  ],
                };
              }
              return {
                ...items,
                [run.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-${Math.random()}`,
                    kind: "thinking",
                    title: "LLM 公开排查过程",
                    content,
                    status: "running",
                  },
                ],
              };
            });
            return;
          }
          if (event === "final") {
            const result = data as CIAnalysisResponse;
            setCiAnalysisById((items) => ({ ...items, [run.id]: result }));
            setCiAnalysisTraceById((items) => {
              const current = (items[run.id] ?? []).map((item) =>
                item.kind === "thinking" ? { ...item, status: "done" } : item,
              );
              return {
                ...items,
                [run.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-final`,
                    kind: "result",
                    title: "排查完成",
                    content: `已生成 CI 根因判断：${result.result.failure_type}；${result.result.is_merge_blocking ? "阻塞合并" : "不阻塞合并"}。`,
                    status: "done",
                  },
                ],
              };
            });
            return;
          }
          if (event === "error") {
            const payload = data as { message?: string };
            const message = payload.message || "分析失败";
            setCiAnalysisError(message);
            setCiAnalysisTraceById((items) => ({
              ...items,
              [run.id]: [
                ...(items[run.id] ?? []),
                {
                  id: `${Date.now()}-error`,
                  kind: "error",
                  title: "排查失败",
                  content: message,
                  status: "error",
                },
              ],
            }));
          }
        },
      );
    } catch (error) {
      setCiAnalysisError(getFriendlyError(error));
      setCiAnalysisTraceById((items) => ({
        ...items,
        [run.id]: [
          ...(items[run.id] ?? []),
          {
            id: `${Date.now()}-error`,
            kind: "error",
            title: "请求失败",
            content: getFriendlyError(error),
            status: "error",
          },
        ],
      }));
    } finally {
      setAnalyzingRunId((current) => (current === run.id ? null : current));
    }
  }

  async function loadProjectKnowledge(repoId: string) {
    const [members, knowledge] = await Promise.all([
      apiGet<TeamMember[]>(`/api/repos/${repoId}/team-members`).catch(() => []),
      apiGet<KnowledgeItem[]>(`/api/repos/${repoId}/knowledge`).catch(() => []),
    ]);
    setTeamMembers(members);
    setKnowledgeItems(knowledge);
    setMemoryNotes(
      knowledge
        .filter((item) => item.source_type === "memory_note")
        .map((item) => ({
          id: item.id,
          title: item.title,
          content: item.content_preview,
        })),
    );
  }

  async function loadProjectIndexState(repoId: string) {
    const state = await apiGet<ProjectIndexState>(`/api/repos/${repoId}/memory-index/state`).catch(
      () => null,
    );
    if (state) {
      setProjectIndexByRepo((items) => ({ ...items, [repoId]: state }));
    }
    return state;
  }

  async function loadKnowledgeGraph(repoId: string, center?: { type: string; id: string }) {
    setGraphLoadingRepoId(repoId);
    setGraphError(null);
    try {
      const params = new URLSearchParams({ depth: "1" });
      if (center?.type && center.id) {
        params.set("center_type", center.type);
        params.set("center_id", center.id);
      }
      const graph = await apiGet<KnowledgeGraphResponse>(
        `/api/repos/${repoId}/knowledge/graph?${params.toString()}`,
      );
      setKnowledgeGraphByRepo((items) => ({ ...items, [repoId]: graph }));
      const preferred = center
        ? graph.nodes.find((node) => node.type === center.type && node.id === center.id)
        : graph.nodes[0];
      setSelectedGraphNodeKey(preferred ? knowledgeGraphNodeKey(preferred) : null);
      return graph;
    } catch (error) {
      setGraphError(getFriendlyError(error));
      setKnowledgeGraphByRepo((items) => ({ ...items, [repoId]: null }));
      return null;
    } finally {
      setGraphLoadingRepoId((current) => (current === repoId ? null : current));
    }
  }

  async function rebuildSelectedKnowledgeGraph() {
    if (!selectedRepo) return;
    setGraphLoadingRepoId(selectedRepo.id);
    setGraphError(null);
    try {
      await apiPost(`/api/repos/${selectedRepo.id}/knowledge/graph/rebuild`, {});
      await loadKnowledgeGraph(selectedRepo.id);
    } catch (error) {
      setGraphError(getFriendlyError(error));
    } finally {
      setGraphLoadingRepoId((current) => (current === selectedRepo.id ? null : current));
    }
  }

  async function startProjectIndexScan() {
    if (!selectedRepo) return;
    const repoId = selectedRepo.id;
    setIndexActionError(null);
    setIndexScanningRepoId(repoId);
    setProjectIndexByRepo((items) => ({
      ...items,
      [repoId]: {
        repo_id: repoId,
        status: "building",
        fingerprint: items[repoId]?.fingerprint ?? "",
        docs_indexed: items[repoId]?.docs_indexed ?? 0,
        docs_total: items[repoId]?.docs_total ?? 0,
        error_message: null,
        summary_json: items[repoId]?.summary_json ?? null,
        snoozed_until: null,
        last_scan_at: items[repoId]?.last_scan_at ?? null,
      },
    }));
    try {
      await apiPost(`/api/repos/${repoId}/memory-index/scan`, {});
      let latest: ProjectIndexState | null = null;
      for (let attempt = 0; attempt < 45; attempt += 1) {
        await wait(1200);
        latest = await loadProjectIndexState(repoId);
        if (!latest || latest.status !== "building") break;
      }
      if (latest?.status === "ready") {
        await loadProjectKnowledge(repoId);
        await loadKnowledgeGraph(repoId);
      }
      if (latest?.status === "failed") {
        setIndexActionError(latest.error_message || "记忆索引扫描失败");
      }
    } catch (error) {
      setIndexActionError(getFriendlyError(error));
      await loadProjectIndexState(repoId);
    } finally {
      setIndexScanningRepoId((current) => (current === repoId ? null : current));
    }
  }

  async function snoozeProjectIndexPrompt() {
    if (!selectedRepo) return;
    const repoId = selectedRepo.id;
    try {
      await apiPost(`/api/repos/${repoId}/memory-index/snooze`, { days: 7 });
      await loadProjectIndexState(repoId);
    } catch (error) {
      setIndexActionError(getFriendlyError(error));
    }
  }

  function welcomeMessage(repo: Repository, conversation?: ProjectConversation): ChatMessage {
    return {
      id: `welcome-${repo.id}-${conversation?.id ?? "default"}`,
      role: "assistant",
      content: `已切换到仓库 ${repo.full_name}${conversation ? ` / ${conversation.title}` : ""}。你可以直接问我 Issue、PR、CI 或周报相关问题。`,
    };
  }

  async function loadChatHistory(repo: Repository, conversation: ProjectConversation) {
    async function loadCompleteHistory() {
      const pageSize = 500;
      const history: ChatHistoryMessage[] = [];
      let beforeMessageId: string | undefined;
      while (true) {
        const cursor = beforeMessageId ? `&before_message_id=${beforeMessageId}` : "";
        const page = await apiGet<ChatHistoryMessage[]>(
          `/api/chat/history?repo_id=${repo.id}&conversation_id=${conversation.id}&limit=${pageSize}${cursor}`,
        );
        history.unshift(...page);
        if (page.length < pageSize) break;
        const nextCursor = page[0]?.id;
        if (!nextCursor || nextCursor === beforeMessageId) break;
        beforeMessageId = nextCursor;
      }
      return history;
    }

    const [history, feedbackRows] = await Promise.all([
      loadCompleteHistory(),
      apiGet<ChatFeedbackRecord[]>(
        `/api/chat/feedback?repo_id=${repo.id}&conversation_id=${conversation.id}&limit=200`,
      ),
    ]);
    if (!history.length) {
      setMessages([welcomeMessage(repo, conversation)]);
      return;
    }
    const feedbackByMessage = new Map(
      feedbackRows.map((item) => [item.assistant_message_id, item]),
    );
    setMessages(
      history
        .filter((item) => item.role === "user" || item.role === "assistant")
        .map((item) => ({
          id: item.id,
          messageId: item.id,
          role: item.role,
          content: item.content,
          route: item.route ?? undefined,
          toolCalls: item.tool_calls ?? [],
          traceItems: traceItemsFromAgentEvents(item.agent_events ?? []),
          traceCollapsed: true,
          compressionStats: item.compression_stats,
          progressiveCompaction: item.progressive_compaction,
          modelUsage: item.model_usage,
          contextDiagnostics: item.context_diagnostics,
          contextCollapsed: true,
          responsePending: false,
          feedback: feedbackByMessage.get(item.id),
        })),
    );
  }

  useEffect(() => {
    loadRepos().catch(() => setRepos([]));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (workspaceTab === "技能&MCP" && !mcpRuntime && !skillRuntimeLoading) {
      void loadSkillRuntime();
    }
  }, [workspaceTab]);

  useEffect(() => {
    if (selectedRepo?.id) {
      loadRepoData(selectedRepo.id);
      loadProjectKnowledge(selectedRepo.id);
      loadProjectIndexState(selectedRepo.id);
      loadKnowledgeGraph(selectedRepo.id);
      if (!promptStateByRepo[selectedRepo.id]) {
        loadPromptSuggestions(selectedRepo.id).catch(() => undefined);
      }
    } else {
      setTeamMembers([]);
      setMemoryNotes([]);
      setKnowledgeItems([]);
      setKnowledgeGraphByRepo({});
      setSelectedGraphNodeKey(null);
      setMessages([]);
    }
  }, [selectedRepo?.id]);

  useEffect(() => {
    if (!loadingPrompts) {
      setPromptLoadingDots(".");
      return;
    }
    const timer = window.setInterval(() => {
      setPromptLoadingDots((current) => (current.length >= 3 ? "." : `${current}.`));
    }, 360);
    return () => window.clearInterval(timer);
  }, [loadingPrompts]);

  useEffect(() => {
    if (!selectedRepo?.id) return;
    if (isDraftConversation) return;
    const conversations = conversationMap[selectedRepo.id] ?? [];
    if (conversations.length === 0) {
      loadRepoConversations(selectedRepo.id).then((items) => {
        setSelectedConversationId((current) =>
          items.some((item) => item.id === current) ? current : items[0]?.id || "",
        );
      });
      return;
    }
    if (!conversations.some((item) => item.id === selectedConversationId)) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [selectedRepo?.id, conversationMap, selectedConversationId, isDraftConversation]);

  useEffect(() => {
    if (isDraftConversation) return;
    if (skipHistoryLoadRef.current) {
      skipHistoryLoadRef.current = false;
      return;
    }
    if (selectedRepo?.id && selectedConversation?.id) {
      loadChatHistory(selectedRepo, selectedConversation).catch(() =>
        setMessages([welcomeMessage(selectedRepo, selectedConversation)]),
      );
    }
  }, [selectedRepo?.id, selectedConversation?.id, isDraftConversation]);

  useEffect(() => {
    setWorkspaceQuery("");
    setWorkspaceStatus("all");
    setWorkspaceOwner("all");
    setWorkspaceTime("all");
    if (preserveWorkspaceSelectionRef.current) {
      preserveWorkspaceSelectionRef.current = false;
    } else {
      setSelectedWorkspaceItem(null);
    }
    setGraphQuery("");
    setHiddenGraphNodeTypes({});
    setHiddenGraphRelations({});
    setAnalysisModalIssueId(null);
    setIssueAnalysisError(null);
    setAnalysisModalPrId(null);
    setPrAnalysisError(null);
    setAnalysisModalRunId(null);
    setCiAnalysisError(null);
    setCollapsedGroups({});
  }, [selectedRepo?.id, workspaceTab]);

  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: loading ? "smooth" : "auto" });
  }, [messages, loading]);

  useEffect(() => {
    if (promptSuggestions.length === 0) {
      setVisiblePromptCount(5);
      return;
    }

    function updateVisiblePromptCount() {
      const row = promptRowRef.current;
      const measure = promptMeasureRef.current;
      if (!row || !measure) return;
      const rowWidth = row.clientWidth;
      const chips = Array.from(
        measure.querySelectorAll<HTMLButtonElement>("[data-prompt-chip-measure]"),
      );
      if (!rowWidth || chips.length === 0) return;

      const gap = 8;
      let usedWidth = 0;
      let nextCount = 0;
      for (const chip of chips) {
        const chipWidth = Math.ceil(chip.getBoundingClientRect().width);
        const widthWithGap = chipWidth + (nextCount > 0 ? gap : 0);
        if (nextCount === 0 || usedWidth + widthWithGap <= rowWidth) {
          usedWidth += widthWithGap;
          nextCount += 1;
          continue;
        }
        break;
      }
      setVisiblePromptCount(Math.min(promptSuggestions.length, Math.max(1, nextCount)));
    }

    const frame = window.requestAnimationFrame(updateVisiblePromptCount);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && promptRowRef.current) {
      observer = new ResizeObserver(updateVisiblePromptCount);
      observer.observe(promptRowRef.current);
    }
    window.addEventListener("resize", updateVisiblePromptCount);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updateVisiblePromptCount);
    };
  }, [promptSuggestions, loadingPrompts]);

  function startResize(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = workspaceWidth;

    function onMove(moveEvent: globalThis.MouseEvent) {
      const delta = startX - moveEvent.clientX;
      setWorkspaceWidth(Math.min(640, Math.max(360, startWidth + delta)));
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function toggleCategory(key: string) {
    setCollapsedGroups((items) => ({ ...items, [key]: !items[key] }));
  }

  async function selectProject(repo: Repository) {
    setSelectedRepoId(repo.id);
    setSyncNotice(null);
    setExpandedRepoIds((items) => ({ ...items, [repo.id]: !items[repo.id] }));
    const conversations = conversationMap[repo.id]?.length
      ? conversationMap[repo.id]
      : await loadRepoConversations(repo.id);
    setSelectedConversationId((current) =>
      conversations.some((item) => item.id === current) ? current : conversations[0]?.id || "",
    );
  }

  async function selectConversation(repo: Repository, conversation: ProjectConversation) {
    setSelectedRepoId(repo.id);
    setExpandedRepoIds((items) => ({ ...items, [repo.id]: true }));
    setSelectedConversationId(conversation.id);
    await apiPost(`/api/repos/${repo.id}/select`, {});
  }

  async function addConversation(repo: Repository) {
    setExpandedRepoIds((items) => ({ ...items, [repo.id]: true }));
    setSelectedRepoId(repo.id);
    setSelectedConversationId(makeDraftConversationId(repo.id));
    setMessages([]);
    setMessage("");
  }

  async function removeConversation(repo: Repository, conversation: ProjectConversation) {
    const confirmed = window.confirm(
      `确定删除会话“${conversation.title}”吗？\n\n只会删除这个会话的聊天上下文，不会删除项目知识库。`,
    );
    if (!confirmed) return;
    const result = await apiDelete<ConversationDeleteResult>(
      `/api/repos/${repo.id}/conversations/${conversation.id}`,
    );
    setConversationMap((items) => ({ ...items, [repo.id]: result.conversations }));
    if (selectedConversationId === conversation.id) {
      setSelectedRepoId(repo.id);
      setSelectedConversationId(result.active_conversation_id);
    }
  }

  async function addTeamMember() {
    if (!selectedRepo || !memberDraft.name.trim()) return;
    const created = await apiPost<TeamMember>(`/api/repos/${selectedRepo.id}/team-members`, {
      name: memberDraft.name.trim(),
      role: memberDraft.role.trim(),
      strengths: memberDraft.strengths.trim(),
      techStack: memberDraft.techStack.trim(),
    });
    setTeamMembers((items) => [...items.filter((item) => item.id !== created.id), created]);
    setMemberDraft({ name: "", role: "", strengths: "", techStack: "" });
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function removeTeamMember(memberId: string) {
    if (!selectedRepo) return;
    await apiDelete(`/api/repos/${selectedRepo.id}/team-members/${memberId}`);
    setTeamMembers((items) => items.filter((item) => item.id !== memberId));
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function addMemoryNote() {
    if (!selectedRepo || (!memoryDraft.title.trim() && !memoryDraft.content.trim())) return;
    await apiPost<KnowledgeItem>(`/api/repos/${selectedRepo.id}/knowledge/notes`, {
      title: memoryDraft.title.trim(),
      content: memoryDraft.content.trim(),
    });
    setMemoryDraft({ title: "", content: "" });
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function removeMemoryNote(noteId: string) {
    if (!selectedRepo) return;
    await apiDelete(`/api/repos/${selectedRepo.id}/knowledge/${noteId}?source_type=memory_note`);
    setMemoryNotes((items) => items.filter((item) => item.id !== noteId));
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function uploadKnowledgeFile(file: File) {
    if (!selectedRepo) return;
    setUploadingKnowledge(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await apiUpload(`/api/repos/${selectedRepo.id}/knowledge/upload`, formData);
      await loadProjectKnowledge(selectedRepo.id);
      await loadKnowledgeGraph(selectedRepo.id);
    } finally {
      setUploadingKnowledge(false);
    }
  }

  async function removeKnowledgeItem(item: KnowledgeItem) {
    if (!selectedRepo) return;
    await apiDelete(
      `/api/repos/${selectedRepo.id}/knowledge/${item.id}?source_type=${encodeURIComponent(item.source_type)}`,
    );
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function refreshSelectedRepo() {
    if (!selectedRepo) return;
    setSyncing(true);
    setSyncNotice(null);
    try {
      const result = await apiPost<RepoSyncResult>(`/api/repos/${selectedRepo.id}/sync`, {
        sync_issues: true,
        sync_pull_requests: true,
        sync_workflow_runs: true,
        limit: 50,
      });
      setSyncNotice(syncNoticeFor(result));
    } catch (error) {
      // 限流回 429，其它失败回 200 + status；网络错误/5xx 走到这里，不能静默吞掉。
      setSyncNotice({ tone: "error", title: "同步请求失败", detail: getFriendlyError(error) });
    }
    try {
      await Promise.all([
        loadRepos(),
        loadRepoData(selectedRepo.id),
        loadProjectKnowledge(selectedRepo.id),
        loadProjectIndexState(selectedRepo.id),
        loadKnowledgeGraph(selectedRepo.id),
        loadRepoConversations(selectedRepo.id),
      ]);
      setPromptStateByRepo((items) => {
        const next = { ...items };
        delete next[selectedRepo.id];
        return next;
      });
      await loadPromptSuggestions(selectedRepo.id);
    } finally {
      setSyncing(false);
    }
  }

  function openAddProject() {
    setIsAddProjectOpen(true);
    setAddProjectStatus(null);
  }

  function closeAddProject() {
    if (connectingProject) return;
    setIsAddProjectOpen(false);
  }

  async function connectProject() {
    const isLocalSource = projectSource === "local";
    const parsed = isLocalSource ? null : parseRepositoryInput(projectUrl);
    if (!isLocalSource && !parsed) {
      setAddProjectStatus({
        type: "error",
        title: "连接失败",
        detail:
          "请输入 GitHub 仓库地址，或 owner/repo 格式，例如 https://github.com/openai/codex。",
      });
      return;
    }
    if (isLocalSource && !projectLocalPath.trim()) {
      setAddProjectStatus({
        type: "error",
        title: "连接失败",
        detail: "请输入本地 Git 仓库路径。",
      });
      return;
    }

    setConnectingProject(true);
    setAddProjectStatus(null);
    try {
      const connected = await apiPost<RepoConnectResult>("/api/repos/connect", {
        owner: parsed?.owner,
        repo: parsed?.repo,
        local_path: isLocalSource ? projectLocalPath.trim() : undefined,
        clone_parent_dir:
          !isLocalSource && projectCloneParentDir.trim() ? projectCloneParentDir.trim() : undefined,
        provider: projectProvider,
        api_base_url: projectProvider === "github" ? undefined : projectApiBaseUrl.trim(),
        token: projectToken.trim() || undefined,
        demo_mode: false,
      });
      await Promise.all([
        loadRepos(),
        loadRepoData(connected.repo_id),
        loadProjectKnowledge(connected.repo_id),
        loadProjectIndexState(connected.repo_id),
      ]);
      const conversations = await loadRepoConversations(connected.repo_id);
      setSelectedRepoId(connected.repo_id);
      setSelectedConversationId(conversations[0]?.id || "");
      setExpandedRepoIds((items) => ({ ...items, [connected.repo_id]: true }));
      setProjectUrl("");
      setProjectLocalPath("");
      setProjectCloneParentDir("");
      setProjectToken("");
      const synced = connected.synced ?? {};
      const syncDetail =
        connected.sync_status === "completed"
          ? `已同步 ${synced.issues ?? 0} 个 Issue、${synced.pull_requests ?? 0} 个 PR、${synced.workflow_runs ?? 0} 条 CI 记录`
          : connected.sync_status === "fallback"
            ? `已使用本地缓存模式连接。${connected.message}`
            : connected.sync_status === "empty"
              ? "同步请求成功，但没有 Issue、PR、CI 数据，暂无法评估仓库健康"
              : connected.sync_status === "partial"
                ? "初次同步范围有限或部分请求失败，请在仓库页执行完整同步后再评估"
                : connected.sync_status === "failed"
                  ? `仓库已连接，但业务数据同步失败。${connected.message}`
                  : "已连接仓库，业务数据尚未同步";
      const codePathDetail = connected.local_path
        ? `代码路径：${connected.local_path}`
        : "代码同步和代码图分析已在后台启动";
      setAddProjectStatus({
        type: "success",
        title: "连接成功",
        detail: `${connected.full_name} 已添加为当前项目，${syncDetail}。${codePathDetail}。`,
      });
    } catch (error) {
      setAddProjectStatus({
        type: "error",
        title: "连接失败",
        detail: getFriendlyError(error),
      });
    } finally {
      setConnectingProject(false);
    }
  }

  async function removeRepo(repo: Repository) {
    const confirmed = window.confirm(
      `确定移除项目「${repo.full_name}」吗？\n\n这会删除本地保存的项目、Issue、PR、CI、分析结果和对话记录。`,
    );
    if (!confirmed) return;

    try {
      await apiDelete(`/api/repos/${repo.id}`);
    } catch (error) {
      window.alert(`删除项目失败：${getFriendlyError(error)}`);
      return;
    }

    const remainingRepos = repos.filter((item) => item.id !== repo.id);
    setRepos(remainingRepos);
    setConversationMap((items) => {
      const next = { ...items };
      delete next[repo.id];
      return next;
    });
    setExpandedRepoIds((items) => {
      const next = { ...items };
      delete next[repo.id];
      return next;
    });
    setPromptStateByRepo((items) => {
      const next = { ...items };
      delete next[repo.id];
      return next;
    });
    if (selectedRepoId === repo.id) {
      setSelectedRepoId(remainingRepos[0]?.id || "");
      setSelectedConversationId(
        remainingRepos[0] ? conversationMap[remainingRepos[0].id]?.[0]?.id || "" : "",
      );
      setIssues([]);
      setPrs([]);
      setRuns([]);
      setMessages([]);
    }
  }

  async function refreshPromptSuggestions() {
    if (!selectedRepo || loadingPrompts) return;
    const exclude = promptExclude;
    await loadPromptSuggestions(selectedRepo.id, exclude);
  }

  function stopAgentResponse() {
    streamAbortRef.current?.abort();
  }

  function markAssistantStopped(assistantId: string) {
    setMessages((items) =>
      items.map((item) => {
        if (item.id !== assistantId) return item;
        const content = item.content.trim()
          ? `${item.content.trim()}\n\n已停止响应。`
          : "已停止响应。";
        return { ...item, content, responsePending: false, traceCollapsed: true };
      }),
    );
  }

  function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
  }

  function appendAssistantTrace(assistantId: string, traceItem: ChatTraceItem) {
    setMessages((items) =>
      items.map((item) =>
        item.id === assistantId
          ? {
              ...item,
              traceItems: [...(item.traceItems ?? []), traceItem],
              traceCollapsed: false,
              responsePending: true,
            }
          : item,
      ),
    );
  }

  function updateAssistantToolTrace(assistantId: string, result: ChatTraceItem) {
    setMessages((items) =>
      items.map((item) => {
        if (item.id !== assistantId) return item;
        const traceItems = item.traceItems ?? [];
        const existingIndex = result.toolUseId
          ? traceItems.findIndex((trace) => trace.toolUseId === result.toolUseId)
          : -1;
        if (existingIndex < 0) {
          return {
            ...item,
            traceItems: [...traceItems, result],
            traceCollapsed: false,
            responsePending: true,
          };
        }
        return {
          ...item,
          traceCollapsed: false,
          responsePending: true,
          traceItems: traceItems.map((trace, index) =>
            index === existingIndex ? { ...trace, ...result, id: trace.id } : trace,
          ),
        };
      }),
    );
  }

  function toggleAssistantTrace(messageId: string) {
    setMessages((items) =>
      items.map((item) =>
        item.id === messageId ? { ...item, traceCollapsed: !item.traceCollapsed } : item,
      ),
    );
  }

  function toggleContextDiagnostics(messageId: string) {
    setMessages((items) =>
      items.map((item) =>
        item.id === messageId ? { ...item, contextCollapsed: !item.contextCollapsed } : item,
      ),
    );
  }

  function recentChatHistory() {
    return messages
      .filter((item) => !item.id.startsWith("welcome-") && item.content.trim())
      .slice(-8)
      .map((item) => ({ role: item.role, content: item.content }));
  }

  function chatRequestContext(chatHistory: Array<{ role: string; content: string }>) {
    return {
      time_range: "7d",
      messages: chatHistory,
      team_members: teamMembers.map(({ name, role, strengths, techStack }) => ({
        name,
        role,
        strengths,
        techStack,
      })),
      project_memory: memoryNotes.map(({ title, content }) => ({ title, content })),
    };
  }

  async function ensureActiveConversation(initialMessage: string) {
    if (!selectedRepo) return null;
    let activeConversation = selectedConversation;
    if (!activeConversation) {
      activeConversation = await apiPost<ProjectConversation>(
        `/api/repos/${selectedRepo.id}/conversations`,
        {
          title: summarizeConversationTitle(initialMessage),
        },
      );
      skipHistoryLoadRef.current = true;
      setConversationMap((items) => {
        const existing = items[selectedRepo.id] ?? [];
        return {
          ...items,
          [selectedRepo.id]: [
            activeConversation!,
            ...existing.filter((item) => item.id !== activeConversation!.id),
          ],
        };
      });
      setExpandedRepoIds((items) => ({ ...items, [selectedRepo.id]: true }));
      setSelectedConversationId(activeConversation.id);
    }
    return activeConversation;
  }

  async function askAgent(text = message) {
    const trimmedText = text.trim();
    if (!selectedRepo || !trimmedText) return;
    const activeConversation = await ensureActiveConversation(trimmedText);
    if (!activeConversation) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedText,
    };
    const assistantId = crypto.randomUUID();
    const chatHistory = recentChatHistory();
    setMessages((items) => [...items, userMessage]);
    setMessage("");
    setLoading(true);
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    try {
      setMessages((items) => [
        ...items,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          traceCollapsed: false,
          responsePending: true,
        },
      ]);
      await apiPostStream(
        "/api/chat/stream",
        {
          repo_id: selectedRepo.id,
          conversation_id: activeConversation.id,
          message: trimmedText,
          context: chatRequestContext(chatHistory),
        },
        (event, rawData) => {
          if (event === "thought") {
            const data = rawData as { content?: string };
            if (data.content?.trim()) {
              appendAssistantTrace(assistantId, {
                id: crypto.randomUUID(),
                kind: "thinking",
                title: "公开思路",
                content: data.content,
                status: "done",
              });
            }
            return;
          }
          if (event === "tool_use") {
            appendAssistantTrace(
              assistantId,
              makeToolUseTrace(rawData as ChatStreamToolUse, crypto.randomUUID()),
            );
            return;
          }
          if (event === "tool_result") {
            updateAssistantToolTrace(
              assistantId,
              makeToolResultTrace(rawData as ChatStreamToolResult, crypto.randomUUID()),
            );
            return;
          }
          if (event === "delta") {
            const data = rawData as ChatStreamDelta;
            if (!data.content) return;
            setMessages((items) =>
              items.map((item) =>
                item.id === assistantId
                  ? { ...item, content: item.content + data.content, responsePending: true }
                  : item,
              ),
            );
            return;
          }
          if (event === "final") {
            const data = rawData as ChatStreamFinal;
            setMessages((items) =>
              items.map((item) =>
                item.id === assistantId
                  ? {
                      ...item,
                      content: data.answer,
                      route: data.route,
                      toolCalls: data.tool_calls,
                      traceItems: finalizedTraceItems(data.agent_events, item.traceItems),
                      compressionStats: data.compression_stats,
                      progressiveCompaction: data.progressive_compaction,
                      modelUsage: data.model_usage,
                      contextDiagnostics: data.context_diagnostics,
                      messageId: data.message_id,
                      contextCollapsed: true,
                      traceCollapsed: true,
                      responsePending: false,
                    }
                  : item,
              ),
            );
            if (data.route === "weekly_report") {
              void loadProjectKnowledge(selectedRepo.id);
            }
            void loadRepoConversations(selectedRepo.id);
          }
        },
        { signal: abortController.signal },
      );
    } catch (error) {
      if (isAbortError(error)) {
        markAssistantStopped(assistantId);
        return;
      }
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: `请求失败：${getFriendlyError(error)}`,
                responsePending: false,
                traceCollapsed: true,
              }
            : item,
        ),
      );
    } finally {
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId
            ? { ...item, traceCollapsed: true, responsePending: false }
            : item,
        ),
      );
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      setLoading(false);
    }
  }

  async function createWorkflowPlan(text = message) {
    const trimmedText = text.trim();
    if (!selectedRepo || !trimmedText) return;
    const activeConversation = await ensureActiveConversation(trimmedText);
    if (!activeConversation) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedText,
    };
    const assistantId = crypto.randomUUID();
    const chatHistory = recentChatHistory();
    setMessages((items) => [
      ...items,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "正在创建执行计划...",
        route: "engineering_plan",
        traceCollapsed: false,
        responsePending: true,
      },
    ]);
    setMessage("");
    setLoading(true);
    try {
      const data = await apiPost<ChatPlanResponse>("/api/chat/plan", {
        repo_id: selectedRepo.id,
        conversation_id: activeConversation.id,
        message: trimmedText,
        context: chatRequestContext(chatHistory),
      });
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: data.answer,
                route: data.route,
                toolCalls: data.tool_calls,
                traceItems: traceItemsFromAgentEvents(data.agent_events ?? []),
                workflowPlan: data.plan,
                planSourceMessage: trimmedText,
                planStatus: "ready",
                traceCollapsed: true,
                responsePending: false,
              }
            : item,
        ),
      );
      void loadRepoConversations(selectedRepo.id);
    } catch (error) {
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: `创建计划失败：${getFriendlyError(error)}`,
                planStatus: "error",
                responsePending: false,
                traceCollapsed: true,
              }
            : item,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function executeWorkflowPlan(messageId: string) {
    if (!selectedRepo || loading) return;
    const planMessage = messages.find((item) => item.id === messageId);
    const workflowPlan = planMessage?.workflowPlan;
    const sourceMessage = planMessage?.planSourceMessage;
    if (!workflowPlan || !sourceMessage) return;
    const activeConversation = await ensureActiveConversation(sourceMessage);
    if (!activeConversation) return;

    const chatHistory = recentChatHistory();
    setLoading(true);
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    setMessages((items) =>
      items.map((item) =>
        item.id === messageId
          ? {
              ...item,
              content: "",
              route: "engineering_workflow",
              traceItems: [],
              traceCollapsed: false,
              responsePending: true,
              planStatus: "executing",
            }
          : item,
      ),
    );
    try {
      await apiPostStream(
        "/api/chat/plan/execute/stream",
        {
          repo_id: selectedRepo.id,
          conversation_id: activeConversation.id,
          message: sourceMessage,
          workflow_spec: workflowPlan,
          context: chatRequestContext(chatHistory),
        },
        (event, rawData) => {
          if (event === "tool_use") {
            appendAssistantTrace(
              messageId,
              makeToolUseTrace(rawData as ChatStreamToolUse, crypto.randomUUID()),
            );
            return;
          }
          if (event === "tool_result") {
            updateAssistantToolTrace(
              messageId,
              makeToolResultTrace(rawData as ChatStreamToolResult, crypto.randomUUID()),
            );
            return;
          }
          if (event === "delta") {
            const data = rawData as ChatStreamDelta;
            if (!data.content) return;
            setMessages((items) =>
              items.map((item) =>
                item.id === messageId
                  ? { ...item, content: item.content + data.content, responsePending: true }
                  : item,
              ),
            );
            return;
          }
          if (event === "final") {
            const data = rawData as ChatStreamFinal;
            setMessages((items) =>
              items.map((item) =>
                item.id === messageId
                  ? {
                      ...item,
                      content: data.answer,
                      route: data.route,
                      toolCalls: data.tool_calls,
                      traceItems: finalizedTraceItems(data.agent_events, item.traceItems),
                      messageId: data.message_id,
                      traceCollapsed: true,
                      responsePending: false,
                      planStatus: data.route === "error" ? "error" : "done",
                    }
                  : item,
              ),
            );
            void loadRepoConversations(selectedRepo.id);
          }
        },
        { signal: abortController.signal },
      );
    } catch (error) {
      if (isAbortError(error)) {
        markAssistantStopped(messageId);
        return;
      }
      setMessages((items) =>
        items.map((item) =>
          item.id === messageId
            ? {
                ...item,
                content: `执行计划失败：${getFriendlyError(error)}`,
                planStatus: "error",
                responsePending: false,
                traceCollapsed: true,
              }
            : item,
        ),
      );
    } finally {
      setMessages((items) =>
        items.map((item) =>
          item.id === messageId ? { ...item, traceCollapsed: true, responsePending: false } : item,
        ),
      );
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      setLoading(false);
    }
  }

  const ownerOptions = useMemo(() => {
    const people = new Set<string>();
    issues.forEach((issue) => {
      issue.assignees?.forEach((assignee) => people.add(assignee));
      if (issue.author) people.add(issue.author);
    });
    prs.forEach((pr) => {
      if (pr.author) people.add(pr.author);
    });
    return Array.from(people).sort((a, b) => a.localeCompare(b));
  }, [issues, prs]);

  const filteredIssues = useMemo(
    () =>
      issues.filter((issue) => {
        const people = [...(issue.assignees ?? []), issue.author ?? ""];
        return (
          matchesQuery(workspaceQuery, [
            issue.title,
            issue.body,
            issue.state,
            ...(issue.labels ?? []),
          ]) &&
          matchesStatus(workspaceStatus, issue.state) &&
          matchesOwner(workspaceOwner, people) &&
          matchesTime(workspaceTime, issue.updated_at ?? issue.created_at)
        );
      }),
    [issues, workspaceOwner, workspaceQuery, workspaceStatus, workspaceTime],
  );

  const filteredPrs = useMemo(
    () =>
      prs.filter((pr) => {
        const derivedStatus = pr.merged_at ? "merged" : pr.state;
        const fileNames = pr.files?.map((file) => file.filename) ?? [];
        return (
          matchesQuery(workspaceQuery, [
            pr.title,
            pr.body,
            derivedStatus,
            pr.author,
            pr.base_branch,
            pr.head_branch,
            ...fileNames,
          ]) &&
          matchesStatus(workspaceStatus, derivedStatus) &&
          matchesOwner(workspaceOwner, [pr.author ?? ""]) &&
          matchesTime(workspaceTime, pr.updated_at ?? pr.created_at ?? pr.merged_at)
        );
      }),
    [prs, workspaceOwner, workspaceQuery, workspaceStatus, workspaceTime],
  );

  const filteredRuns = useMemo(
    () =>
      runs.filter((run) => {
        const derivedStatus = run.conclusion ?? run.status;
        return (
          matchesQuery(workspaceQuery, [run.name, run.status, run.conclusion, run.logs_text]) &&
          matchesStatus(workspaceStatus, derivedStatus) &&
          matchesTime(workspaceTime, run.updated_at ?? run.created_at)
        );
      }),
    [runs, workspaceQuery, workspaceStatus, workspaceTime],
  );

  const openIssues = issues.filter((item) => item.state === "open");
  const openPrs = prs.filter((item) => item.state === "open");
  const failedRuns = runs.filter((item) => item.conclusion === "failure");
  const mergedPrs = prs.filter((item) => item.merged_at);
  const rejectedIssues = issues.filter((item) => classifyIssue(item) === "rejected");
  const handledIssues = issues.filter((item) =>
    ["accepted", "closed"].includes(classifyIssue(item)),
  );
  const selectedIssue =
    selectedWorkspaceItem?.type === "issue"
      ? issues.find((item) => item.id === selectedWorkspaceItem.id)
      : undefined;
  const selectedPr =
    selectedWorkspaceItem?.type === "pr"
      ? prs.find((item) => item.id === selectedWorkspaceItem.id)
      : undefined;
  const selectedRun =
    selectedWorkspaceItem?.type === "ci"
      ? runs.find((item) => item.id === selectedWorkspaceItem.id)
      : undefined;
  const hasWorkspaceDetail = Boolean(selectedIssue || selectedPr || selectedRun);
  const analysisModalIssue = analysisModalIssueId
    ? issues.find((item) => item.id === analysisModalIssueId)
    : undefined;
  const analysisModalPr = analysisModalPrId
    ? prs.find((item) => item.id === analysisModalPrId)
    : undefined;
  const analysisModalRun = analysisModalRunId
    ? runs.find((item) => item.id === analysisModalRunId)
    : undefined;
  const isEmptyConversation =
    messages.length === 0 || (messages.length === 1 && messages[0]?.id.startsWith("welcome-"));
  const indexSnoozed = Boolean(
    selectedProjectIndexState?.snoozed_until &&
    new Date(selectedProjectIndexState.snoozed_until).getTime() > Date.now(),
  );

  return (
    <div
      className="relative grid h-[calc(100vh-77px)] min-h-0 overflow-hidden rounded-lg border border-line bg-panel"
      style={{
        gridTemplateColumns: isMobileViewport
          ? "minmax(0,1fr)"
          : `${isSidebarCollapsed ? "56px" : "300px"} minmax(0,1fr)`,
        transition: "grid-template-columns 260ms ease",
      }}
    >
      <aside
        className={`${isMobileViewport ? "hidden" : "flex"} min-h-0 min-w-0 flex-col overflow-hidden border-r border-line bg-panel-2 transition-all duration-300`}
      >
        <div className={`border-b border-line ${isSidebarCollapsed ? "p-2" : "p-4"}`}>
          <div className={`flex items-center ${isSidebarCollapsed ? "flex-col gap-3" : "gap-3"}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-ink">
              DF
            </div>
            {!isSidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink">Kynflow</div>
                <div className="truncate text-xs text-faint">
                  研发团队 PR / Issue 智能协作 Agent
                </div>
              </div>
            )}
            <button
              onClick={() => setIsSidebarCollapsed((value) => !value)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-muted transition hover:bg-sage-100"
              title={isSidebarCollapsed ? "展开项目侧边栏" : "隐藏项目侧边栏"}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>

          {isSidebarCollapsed ? (
            <div className="mt-4 flex flex-col items-center gap-3">
              <button
                onClick={openAddProject}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink transition hover:bg-panel"
                title="添加项目"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={refreshSelectedRepo}
                disabled={!selectedRepo || syncing}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink transition hover:bg-panel disabled:opacity-50"
                title="刷新当前项目"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              </button>
            </div>
          ) : (
            <div className="mt-5 flex items-center justify-between">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
                  Projects
                </div>
                <h2 className="mt-1 text-lg font-semibold text-ink">项目</h2>
              </div>
              <button
                onClick={openAddProject}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink"
              >
                <Plus className="h-3.5 w-3.5" />
                添加项目
              </button>
            </div>
          )}
        </div>

        <div
          className={`min-h-0 flex-1 overflow-y-auto ${isSidebarCollapsed ? "p-2" : "px-3 py-2"}`}
        >
          {repos.length === 0 && !isSidebarCollapsed && (
            <div className="rounded-md bg-panel p-3 text-sm leading-6 text-muted">
              还没有项目。请先添加一个项目。
            </div>
          )}
          {!isSidebarCollapsed && repos.length > 0 && (
            <div className="mb-2 px-1 text-xs text-faint">项目</div>
          )}
          {repos.map((repo) => {
            const conversations = conversationMap[repo.id] ?? [];
            const isExpanded = expandedRepoIds[repo.id] ?? selectedRepo?.id === repo.id;
            const isSelectedRepo = selectedRepo?.id === repo.id;
            return isSidebarCollapsed ? (
              <button
                key={repo.id}
                onClick={() => selectProject(repo).catch(() => undefined)}
                className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-md transition ${
                  isSelectedRepo ? "bg-panel text-ink shadow-sm" : "text-muted hover:bg-panel"
                }`}
                title={repo.full_name}
              >
                <Folder className="h-4 w-4" />
              </button>
            ) : (
              <div key={repo.id} className="mb-1">
                <div
                  className={`group flex h-9 items-center gap-1 rounded-md px-1 transition ${isSelectedRepo ? "bg-panel-3" : "hover:bg-panel-3"}`}
                >
                  <button
                    onClick={() => selectProject(repo).catch(() => undefined)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-panel"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition ${isExpanded ? "" : "-rotate-90"}`}
                    />
                  </button>
                  <button
                    onClick={() => selectProject(repo).catch(() => undefined)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-faint" />
                    <span className="truncate text-sm text-ink" title={repo.full_name}>
                      {repo.name || repo.full_name}
                    </span>
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      addConversation(repo).catch(() => undefined);
                    }}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint opacity-0 transition hover:bg-panel hover:text-ink group-hover:opacity-100"
                    title="添加会话"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      removeRepo(repo).catch(() => undefined);
                    }}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                    title="移除项目"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="ml-7 mt-1 space-y-0.5">
                    {conversations.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-faint">暂无会话</div>
                    )}
                    {conversations.map((conversation) => (
                      <div
                        key={conversation.id}
                        className="group/conversation flex items-center gap-1"
                      >
                        <button
                          onClick={() =>
                            selectConversation(repo, conversation).catch(() => undefined)
                          }
                          className={`flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left text-sm transition ${
                            selectedConversationId === conversation.id
                              ? "bg-panel text-ink shadow-sm"
                              : "text-muted hover:bg-panel"
                          }`}
                          title={conversation.title}
                        >
                          <span className="truncate">{conversation.title}</span>
                          <span className="shrink-0 text-xs text-faint">
                            {formatRelativeTime(conversation.updated_at)}
                          </span>
                        </button>
                        <button
                          onClick={() =>
                            removeConversation(repo, conversation).catch(() => undefined)
                          }
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover/conversation:opacity-100"
                          title="删除会话"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!isSidebarCollapsed && (
          <div className="border-t border-line p-3">
            <button
              onClick={refreshSelectedRepo}
              disabled={!selectedRepo || syncing}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm font-medium text-ink transition hover:bg-sage-100 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "刷新中..." : "刷新当前项目"}
            </button>
          </div>
        )}
      </aside>

      <section
        className="grid min-h-0 min-w-0 bg-panel"
        style={{
          gridTemplateColumns: isMobileViewport
            ? "minmax(0,1fr)"
            : `minmax(460px,1fr) 8px ${workspaceWidth}px`,
          gridTemplateRows: "auto minmax(0,1fr)",
        }}
      >
        <section className="col-start-1 row-start-1 shrink-0 border-b border-line bg-panel/90 px-4 py-2">
          {isMobileViewport && repos.length > 0 && (
            <div className="mb-2 flex items-center gap-2">
              <select
                value={selectedRepoId}
                onChange={(event) => {
                  const repo = repos.find((item) => item.id === event.target.value);
                  if (repo) selectProject(repo).catch(() => undefined);
                }}
                className="h-9 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-sm text-ink outline-none"
                aria-label="切换项目"
              >
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.full_name}
                  </option>
                ))}
              </select>
              <button
                onClick={openAddProject}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-ink transition hover:bg-sage-100"
                aria-label="添加项目"
                title="添加项目"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-semibold text-ink">总览</h2>
                <span className="text-xs text-faint">当前代码仓</span>
                <span className="truncate text-sm font-semibold text-ink">
                  {selectedRepo?.full_name || "未选择仓库"}
                </span>
                {selectedConversation && (
                  <span className="rounded-full bg-panel px-2 py-0.5 text-xs text-muted">
                    会话：{selectedConversation.title}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="rounded-full border border-sage-700 bg-sage-100 px-3 py-1 text-xs font-medium text-accent">
                Production Workspace
              </div>
              <button onClick={openAddProject} className="text-xs text-accent hover:underline">
                管理项目
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3">
            <MetricCard icon={ListTodo} label="待处理 Issue" value={openIssues.length} />
            <MetricCard icon={GitPullRequest} label="待 Review PR" value={openPrs.length} />
            <MetricCard icon={CheckCircle2} label="已处理 Issue" value={handledIssues.length} />
            <MetricCard icon={XCircle} label="已拒绝 Issue" value={rejectedIssues.length} />
            <MetricCard icon={AlertTriangle} label="失败 CI" value={failedRuns.length} />
            <MetricCard icon={CheckCircle2} label="已合并 PR" value={mergedPrs.length} />
          </div>
        </section>

        <div
          className={`${isMobileViewport ? "hidden" : ""} col-start-2 row-span-2 row-start-1 cursor-col-resize border-x border-line bg-stone-100 transition hover:bg-sage-100`}
          onMouseDown={startResize}
          title="拖拽调整 Workspace 宽度"
        />

        <aside
          className={`${isMobileViewport ? "hidden" : "flex"} col-start-3 row-span-2 row-start-1 min-h-0 min-w-0 flex-col bg-panel`}
        >
          <div className="border-b border-line bg-panel/80 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-ink">Workspace</h2>
              <div className="flex shrink-0 items-center gap-2">
                <div className="text-[11px] text-faint">
                  Issues: {filteredIssues.length} · PRs: {filteredPrs.length}
                </div>
                <button
                  onClick={refreshSelectedRepo}
                  disabled={!selectedRepo || syncing}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-2 text-xs font-medium text-ink transition hover:bg-sage-100 disabled:opacity-60"
                  title="刷新 Issue/PR/CI"
                  aria-label="刷新 Issue/PR/CI"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "刷新中" : "刷新"}
                </button>
              </div>
            </div>
            {syncNotice && (
              <div
                className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5 ${
                  syncNotice.tone === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-600"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
                role="status"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{syncNotice.title}</div>
                  {syncNotice.detail && (
                    <div className="mt-0.5 break-words">{syncNotice.detail}</div>
                  )}
                </div>
                <button
                  onClick={() => setSyncNotice(null)}
                  className="shrink-0 opacity-60 transition hover:opacity-100"
                  aria-label="关闭同步提示"
                  title="关闭"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="mt-3 flex gap-1 overflow-x-auto">
              {workspaceTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    if (tab === "图谱" && selectedRepo && selectedWorkspaceItem) {
                      const center = workspaceSelectionToGraphCenter(selectedWorkspaceItem);
                      if (center) void loadKnowledgeGraph(selectedRepo.id, center);
                    }
                    setWorkspaceTab(tab);
                  }}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    workspaceTab === tab
                      ? "bg-accent text-accent-ink"
                      : "bg-panel text-muted hover:bg-sage-100"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!hasWorkspaceDetail &&
              (workspaceTab === "Issue" || workspaceTab === "PR" || workspaceTab === "CI") && (
                <WorkspaceControls
                  query={workspaceQuery}
                  status={workspaceStatus}
                  owner={workspaceOwner}
                  time={workspaceTime}
                  owners={ownerOptions}
                  activeTab={workspaceTab}
                  onQueryChange={(value) => {
                    setWorkspaceQuery(value);
                    setSelectedWorkspaceItem(null);
                  }}
                  onStatusChange={(value) => {
                    setWorkspaceStatus(value);
                    setSelectedWorkspaceItem(null);
                  }}
                  onOwnerChange={(value) => {
                    setWorkspaceOwner(value);
                    setSelectedWorkspaceItem(null);
                  }}
                  onTimeChange={(value) => {
                    setWorkspaceTime(value);
                    setSelectedWorkspaceItem(null);
                  }}
                />
              )}

            {hasWorkspaceDetail && (
              <WorkspaceDetail
                issue={selectedIssue}
                pr={selectedPr}
                run={selectedRun}
                analyzingIssue={Boolean(selectedIssue && analyzingIssueId === selectedIssue.id)}
                analyzingPr={Boolean(selectedPr && analyzingPrId === selectedPr.id)}
                analyzingRun={Boolean(selectedRun && analyzingRunId === selectedRun.id)}
                onAnalyzeIssue={selectedIssue ? () => analyzeIssue(selectedIssue) : undefined}
                onAnalyzePr={selectedPr ? () => analyzePr(selectedPr) : undefined}
                onAnalyzeRun={selectedRun ? () => analyzeCi(selectedRun) : undefined}
                onClose={() => setSelectedWorkspaceItem(null)}
              />
            )}

            {!hasWorkspaceDetail && workspaceTab === "Issue" && (
              <div className="mt-4 space-y-3">
                {issueCategoryMeta.map((category) => {
                  const items = filteredIssues.filter(
                    (item) => classifyIssue(item) === category.key,
                  );
                  const groupKey = `issue-${category.key}`;
                  return (
                    <CategoryGroup
                      key={category.key}
                      label={category.label}
                      color={category.color}
                      count={items.length}
                      isCollapsed={collapsedGroups[groupKey] ?? false}
                      onToggle={() => toggleCategory(groupKey)}
                      items={items.map((item) => ({
                        id: item.id,
                        title: `#${item.number} ${item.title}`,
                        meta: item.state,
                        detail: item.body,
                        badges: item.labels,
                        selected:
                          selectedWorkspaceItem?.type === "issue" &&
                          selectedWorkspaceItem.id === item.id,
                        onClick: () => setSelectedWorkspaceItem({ type: "issue", id: item.id }),
                      }))}
                    />
                  );
                })}
              </div>
            )}

            {!hasWorkspaceDetail && workspaceTab === "PR" && (
              <div className="mt-4 space-y-3">
                {prCategoryMeta.map((category) => {
                  const items = filteredPrs.filter((item) => classifyPr(item) === category.key);
                  const groupKey = `pr-${category.key}`;
                  return (
                    <CategoryGroup
                      key={category.key}
                      label={category.label}
                      color={category.color}
                      count={items.length}
                      isCollapsed={collapsedGroups[groupKey] ?? false}
                      onToggle={() => toggleCategory(groupKey)}
                      items={items.map((item) => ({
                        id: item.id,
                        title: `#${item.number} ${item.title}`,
                        meta: item.merged_at ? "merged" : item.state,
                        detail: item.body,
                        badges: [item.author, item.head_branch].filter(Boolean) as string[],
                        selected:
                          selectedWorkspaceItem?.type === "pr" &&
                          selectedWorkspaceItem.id === item.id,
                        onClick: () => setSelectedWorkspaceItem({ type: "pr", id: item.id }),
                      }))}
                    />
                  );
                })}
              </div>
            )}

            {!hasWorkspaceDetail && workspaceTab === "CI" && (
              <div className="mt-4 space-y-2">
                {filteredRuns.length === 0 && <EmptyWorkspaceState label="暂无 Workflow Run" />}
                {filteredRuns.map((item) => (
                  <WorkspaceItemButton
                    key={item.id}
                    item={{
                      id: item.id,
                      title: item.name,
                      meta: item.conclusion || item.status,
                      detail: item.logs_text,
                      selected:
                        selectedWorkspaceItem?.type === "ci" &&
                        selectedWorkspaceItem.id === item.id,
                      onClick: () => setSelectedWorkspaceItem({ type: "ci", id: item.id }),
                    }}
                  />
                ))}
              </div>
            )}

            {!hasWorkspaceDetail && workspaceTab === "团队" && (
              <TeamWorkspace
                members={teamMembers}
                draft={memberDraft}
                onDraftChange={setMemberDraft}
                onAddMember={addTeamMember}
                onRemoveMember={removeTeamMember}
              />
            )}

            {!hasWorkspaceDetail && workspaceTab === "记忆&知识库" && (
              <MemoryHubWorkspace
                repoId={selectedRepo?.id}
                notes={memoryNotes}
                draft={memoryDraft}
                knowledgeItems={knowledgeItems}
                uploading={uploadingKnowledge}
                onDraftChange={setMemoryDraft}
                onAddNote={addMemoryNote}
                onRemoveNote={removeMemoryNote}
                onUploadFile={uploadKnowledgeFile}
                onRemoveKnowledgeItem={removeKnowledgeItem}
                onRefreshKnowledge={() => selectedRepo && loadProjectKnowledge(selectedRepo.id)}
              />
            )}

            {!hasWorkspaceDetail && workspaceTab === "技能&MCP" && (
              <SkillMcpWorkspace
                runtime={mcpRuntime}
                skills={skills}
                selectedSkillName={selectedSkillName}
                loading={skillRuntimeLoading}
                error={skillRuntimeError}
                onSelectSkill={setSelectedSkillName}
                onRefresh={loadSkillRuntime}
              />
            )}

            {!hasWorkspaceDetail && workspaceTab === "图谱" && (
              <KnowledgeGraphWorkspace
                graph={selectedKnowledgeGraph ?? null}
                loading={graphLoadingRepoId === selectedRepo?.id}
                error={graphError}
                query={graphQuery}
                selectedNodeKey={selectedGraphNodeKey}
                hiddenNodeTypes={hiddenGraphNodeTypes}
                hiddenRelations={hiddenGraphRelations}
                onQueryChange={setGraphQuery}
                onSelectNode={setSelectedGraphNodeKey}
                onToggleNodeType={(type) =>
                  setHiddenGraphNodeTypes((items) => ({ ...items, [type]: !items[type] }))
                }
                onToggleRelation={(relation) =>
                  setHiddenGraphRelations((items) => ({ ...items, [relation]: !items[relation] }))
                }
                onRefresh={() => selectedRepo && loadKnowledgeGraph(selectedRepo.id)}
                onRebuild={rebuildSelectedKnowledgeGraph}
                onFocusNode={(node) =>
                  selectedRepo &&
                  loadKnowledgeGraph(selectedRepo.id, { type: node.type, id: node.id })
                }
                onOpenNode={(node) =>
                  openGraphNodeInWorkspace(
                    node,
                    setWorkspaceTab,
                    setSelectedWorkspaceItem,
                    preserveWorkspaceSelectionRef,
                  )
                }
              />
            )}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col bg-panel">
          <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="flex w-full flex-col gap-4">
              {messages.map((item) => {
                const isWelcome = item.id.startsWith("welcome-");
                const traceItems = item.traceItems ?? [];
                const failedTools = (item.toolCalls ?? []).filter(
                  (call) => call.status === "error",
                );
                const failedToolTitle = failedTools
                  .map((call) => `${call.tool_name}: ${call.error ?? "failed"}`)
                  .join("\n");
                return (
                  <div
                    key={item.id}
                    className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`${isWelcome ? "w-full max-w-none rounded-md" : "max-w-[80%] rounded-xl"} px-4 py-3 text-sm leading-7 ${
                        item.role === "user"
                          ? "bg-accent text-accent-ink"
                          : "border border-line bg-panel text-ink"
                      }`}
                    >
                      {item.role === "assistant" ? (
                        <>
                          {item.workflowPlan && (
                            <WorkflowPlanCard
                              plan={item.workflowPlan}
                              status={item.planStatus ?? "ready"}
                              disabled={
                                loading ||
                                Boolean(item.responsePending) ||
                                item.planStatus === "done"
                              }
                              onExecute={() => executeWorkflowPlan(item.id)}
                            />
                          )}
                          {item.content.trim() ? (
                            <div className={item.workflowPlan ? "mt-3" : ""}>
                              <MarkdownMessage content={item.content} />
                            </div>
                          ) : traceItems.length === 0 ? (
                            <div className="text-faint">Agent 正在分析...</div>
                          ) : null}
                        </>
                      ) : (
                        <div className="whitespace-pre-wrap">{item.content}</div>
                      )}
                      {item.route && (
                        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-2 text-xs text-faint">
                          <span>route: {item.route}</span>
                          <span>tools: {item.toolCalls?.length ?? 0}</span>
                          {failedTools.length > 0 && (
                            <span className="text-rose-600" title={failedToolTitle}>
                              failed: {failedTools.length}
                            </span>
                          )}
                        </div>
                      )}
                      {item.role === "assistant" &&
                        item.compressionStats &&
                        Object.keys(item.compressionStats).length > 0 && (
                          <ContextDiagnostics
                            compressionStats={item.compressionStats}
                            progressiveCompaction={item.progressiveCompaction ?? {}}
                            modelUsage={item.modelUsage ?? []}
                            contextDiagnostics={item.contextDiagnostics ?? {}}
                            collapsed={item.contextCollapsed !== false}
                            onToggle={() => toggleContextDiagnostics(item.id)}
                          />
                        )}
                      {item.role === "assistant" && traceItems.length > 0 && (
                        <div className="mt-3">
                          <ChatTraceInline
                            traceItems={traceItems}
                            collapsed={item.responsePending ? false : Boolean(item.traceCollapsed)}
                            responsePending={Boolean(item.responsePending)}
                            onToggle={() => toggleAssistantTrace(item.id)}
                          />
                        </div>
                      )}
                      {item.role === "assistant" &&
                        item.responsePending &&
                        (traceItems.length > 0 || item.content.trim()) && (
                          <div className="mt-3 flex items-center gap-2 rounded-md border border-sage-700 bg-sage-100 px-3 py-2 text-xs text-muted">
                            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
                            <span>Agent 正在回复，工具结果已收集，正在整理最终回答...</span>
                          </div>
                        )}
                      {item.role === "assistant" &&
                        item.messageId &&
                        !item.responsePending &&
                        selectedRepo &&
                        selectedConversation && (
                          <FeedbackControls
                            repoId={selectedRepo.id}
                            conversationId={selectedConversation.id}
                            messageId={item.messageId}
                            initialFeedback={item.feedback}
                            onSaved={(feedback) =>
                              setMessages((current) =>
                                current.map((message) =>
                                  message.id === item.id ? { ...message, feedback } : message,
                                ),
                              )
                            }
                          />
                        )}
                    </div>
                  </div>
                );
              })}
              {selectedRepo &&
                isEmptyConversation &&
                selectedProjectIndexState &&
                !indexSnoozed &&
                selectedProjectIndexState.status !== "ready" && (
                  <MemoryIndexPromptCard
                    repo={selectedRepo}
                    state={selectedProjectIndexState}
                    scanning={
                      indexScanningRepoId === selectedRepo.id ||
                      selectedProjectIndexState.status === "building"
                    }
                    error={indexActionError}
                    onStartScan={startProjectIndexScan}
                    onSnooze={snoozeProjectIndexPrompt}
                  />
                )}
            </div>
          </div>

          <div className="border-t border-line bg-panel/90 p-4">
            <div className="w-full">
              {(promptSuggestions.length > 0 || loadingPrompts) && (
                <div className="mb-3 flex items-center gap-2">
                  <div ref={promptRowRef} className="relative min-w-0 flex-1 overflow-hidden">
                    <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
                      {loadingPrompts && promptSuggestions.length === 0 && (
                        <span className="shrink-0 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-faint">
                          推荐生成中{promptLoadingDots}
                        </span>
                      )}
                      {promptSuggestions.slice(0, visiblePromptCount).map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => askAgent(prompt)}
                          disabled={!selectedRepo || loading || loadingPrompts}
                          className="max-w-full shrink-0 truncate rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted transition hover:border-sage-700 hover:bg-sage-100 disabled:opacity-60"
                          title={prompt}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                    <div
                      ref={promptMeasureRef}
                      className="pointer-events-none invisible absolute -left-[9999px] top-0 flex items-center gap-2 whitespace-nowrap"
                      aria-hidden="true"
                    >
                      {promptSuggestions.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          data-prompt-chip-measure
                          className="shrink-0 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-muted"
                          tabIndex={-1}
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                  {promptSuggestions.length > 0 && (
                    <button
                      onClick={refreshPromptSuggestions}
                      disabled={!selectedRepo || loading || loadingPrompts}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-faint transition hover:border-sage-700 hover:bg-sage-100 disabled:cursor-not-allowed disabled:opacity-50"
                      title="刷新推荐提示语"
                      aria-label="刷新推荐提示语"
                    >
                      <RefreshCw className={`h-4 w-4 ${loadingPrompts ? "animate-spin" : ""}`} />
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-stretch gap-3">
                <textarea
                  className={`max-h-40 min-h-[5.5rem] flex-1 resize-none rounded-md border bg-panel px-3 py-3 text-sm leading-6 outline-none transition focus:border-sage-600 focus:ring-2 focus:ring-sage-100 ${
                    planMode ? "border-sage-700" : "border-line"
                  }`}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="输入消息，询问当前代码仓..."
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (!loading) {
                        planMode ? createWorkflowPlan() : askAgent();
                      }
                    }
                  }}
                />
                <div className="flex w-12 shrink-0 flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setPlanMode((value) => !value)}
                    disabled={loading}
                    aria-pressed={planMode}
                    className={`inline-flex h-8 w-12 items-center justify-center rounded-md border transition disabled:opacity-60 ${
                      planMode
                        ? "border-sage-600 bg-accent text-accent-ink shadow-sm"
                        : "border-line bg-panel text-faint hover:border-sage-700 hover:bg-sage-100"
                    }`}
                    title={planMode ? "切换到对话模式" : "切换到计划模式"}
                  >
                    <ListTodo className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() =>
                      loading ? stopAgentResponse() : planMode ? createWorkflowPlan() : askAgent()
                    }
                    disabled={!selectedRepo || (!loading && !message.trim())}
                    className="inline-flex min-h-12 flex-1 items-center justify-center rounded-md bg-accent text-accent-ink transition hover:bg-accent-bright disabled:opacity-60"
                    title={loading ? "停止响应" : "发送"}
                  >
                    {loading ? (
                      <Square className="h-4 w-4 fill-current" />
                    ) : (
                      <Send className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </section>
      {isAddProjectOpen && (
        <AddProjectOverlay
          source={projectSource}
          repoUrl={projectUrl}
          localPath={projectLocalPath}
          cloneParentDir={projectCloneParentDir}
          provider={projectProvider}
          apiBaseUrl={projectApiBaseUrl}
          token={projectToken}
          loading={connectingProject}
          status={addProjectStatus}
          onSourceChange={setProjectSource}
          onRepoUrlChange={setProjectUrl}
          onLocalPathChange={setProjectLocalPath}
          onCloneParentDirChange={setProjectCloneParentDir}
          onProviderChange={(value) => {
            setProjectProvider(value);
            if (value === "github") setProjectApiBaseUrl("https://api.github.com");
            if (value === "github_compatible") setProjectApiBaseUrl("https://api.example.com");
          }}
          onApiBaseUrlChange={setProjectApiBaseUrl}
          onTokenChange={setProjectToken}
          onConnect={connectProject}
          onClose={closeAddProject}
        />
      )}
      {analysisModalIssue && (
        <IssueAnalysisOverlay
          issue={analysisModalIssue}
          analysis={issueAnalysisById[analysisModalIssue.id]?.result}
          traceItems={issueAnalysisTraceById[analysisModalIssue.id] ?? []}
          loading={analyzingIssueId === analysisModalIssue.id}
          error={issueAnalysisError}
          onRetry={() => analyzeIssue(analysisModalIssue)}
          onClose={() => {
            setAnalysisModalIssueId(null);
            setIssueAnalysisError(null);
          }}
        />
      )}
      {analysisModalPr && (
        <PRAnalysisOverlay
          pr={analysisModalPr}
          analysis={prAnalysisById[analysisModalPr.id]?.result}
          traceItems={prAnalysisTraceById[analysisModalPr.id] ?? []}
          loading={analyzingPrId === analysisModalPr.id}
          error={prAnalysisError}
          onRetry={() => analyzePr(analysisModalPr)}
          onClose={() => {
            setAnalysisModalPrId(null);
            setPrAnalysisError(null);
          }}
        />
      )}
      {analysisModalRun && (
        <CIAnalysisOverlay
          run={analysisModalRun}
          analysis={ciAnalysisById[analysisModalRun.id]?.result}
          traceItems={ciAnalysisTraceById[analysisModalRun.id] ?? []}
          loading={analyzingRunId === analysisModalRun.id}
          error={ciAnalysisError}
          onRetry={() => analyzeCi(analysisModalRun)}
          onClose={() => {
            setAnalysisModalRunId(null);
            setCiAnalysisError(null);
          }}
        />
      )}
    </div>
  );
}
