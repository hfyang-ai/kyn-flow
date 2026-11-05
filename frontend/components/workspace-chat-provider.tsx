"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { apiDelete, apiGet, apiPost, apiPostStream } from "@/lib/api";
import type { Repository } from "@/lib/types";
import type { ChatFeedbackRecord } from "@/components/feedback-controls";

import type {
  ChatHistoryMessage,
  ChatMessage,
  ChatPlanResponse,
  ChatStreamDelta,
  ChatStreamFinal,
  ChatStreamToolResult,
  ChatStreamToolUse,
  ChatTraceItem,
  ConversationDeleteResult,
  MemoryNote,
  ProjectConversation,
  TeamMember,
} from "@/app/home/types";
import {
  finalizedTraceItems,
  getFriendlyError,
  isDraftConversationId,
  makeDraftConversationId,
  makeToolResultTrace,
  makeToolUseTrace,
  summarizeConversationTitle,
  traceItemsFromAgentEvents,
} from "@/app/home/utils";

/**
 * 跨路由依赖注入：page 层每次渲染时同步最新值，供流式回调读取。
 * 使用 ref 而非 state，避免 page 层状态变化反向触发 provider 重渲染。
 */
type WorkspaceChatDeps = {
  teamMembers: TeamMember[];
  memoryNotes: MemoryNote[];
  onWeeklyReport?: (repoId: string) => void | Promise<void>;
};

type WorkspaceChatContextValue = {
  // 会话域状态
  repos: Repository[];
  selectedRepoId: string;
  conversationMap: Record<string, ProjectConversation[]>;
  selectedConversationId: string;
  expandedRepoIds: Record<string, boolean>;
  messages: ChatMessage[];
  loading: boolean;
  // 派生值
  selectedRepo: Repository | undefined;
  selectedRepoConversations: ProjectConversation[];
  selectedConversation: ProjectConversation | undefined;
  isDraftConversation: boolean;
  // setter（供 page 层 connectProject / removeRepo / FeedbackControls 等更新会话域）
  setRepos: Dispatch<SetStateAction<Repository[]>>;
  setSelectedRepoId: Dispatch<SetStateAction<string>>;
  setConversationMap: Dispatch<SetStateAction<Record<string, ProjectConversation[]>>>;
  setSelectedConversationId: Dispatch<SetStateAction<string>>;
  setExpandedRepoIds: Dispatch<SetStateAction<Record<string, boolean>>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  // 方法
  loadRepos: () => Promise<void>;
  loadRepoConversations: (repoId: string) => Promise<ProjectConversation[]>;
  loadChatHistory: (repo: Repository, conversation: ProjectConversation) => Promise<void>;
  selectProject: (repo: Repository) => Promise<void>;
  selectConversation: (repo: Repository, conversation: ProjectConversation) => Promise<void>;
  addConversation: (repo: Repository) => Promise<void>;
  removeConversation: (repo: Repository, conversation: ProjectConversation) => Promise<void>;
  askAgent: (text: string) => Promise<void>;
  createWorkflowPlan: (text: string) => Promise<void>;
  executeWorkflowPlan: (messageId: string) => Promise<void>;
  stopAgentResponse: () => void;
  // 依赖注入
  registerDeps: (deps: WorkspaceChatDeps) => void;
};

const WorkspaceChatContext = createContext<WorkspaceChatContextValue | null>(null);

export function useWorkspaceChat(): WorkspaceChatContextValue {
  const ctx = useContext(WorkspaceChatContext);
  if (!ctx) {
    throw new Error("useWorkspaceChat must be used within WorkspaceChatProvider");
  }
  return ctx;
}

export function WorkspaceChatProvider({ children }: { children: ReactNode }) {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [conversationMap, setConversationMap] = useState<Record<string, ProjectConversation[]>>({});
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [expandedRepoIds, setExpandedRepoIds] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const streamAbortRef = useRef<AbortController | null>(null);
  const skipHistoryLoadRef = useRef(false);
  const depsRef = useRef<WorkspaceChatDeps>({ teamMembers: [], memoryNotes: [] });

  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? repos[0];
  const selectedRepoConversations = selectedRepo ? (conversationMap[selectedRepo.id] ?? []) : [];
  const isDraftConversation = isDraftConversationId(selectedConversationId);
  const selectedConversation = isDraftConversation
    ? undefined
    : (selectedRepoConversations.find((item) => item.id === selectedConversationId) ??
      selectedRepoConversations[0]);

  function registerDeps(deps: WorkspaceChatDeps) {
    depsRef.current = deps;
  }

  function welcomeMessage(repo: Repository, conversation?: ProjectConversation): ChatMessage {
    return {
      id: `welcome-${repo.id}-${conversation?.id ?? "default"}`,
      role: "assistant",
      content: `已切换到仓库 ${repo.full_name}${conversation ? ` / ${conversation.title}` : ""}。你可以直接问我 Issue、PR、CI 或周报相关问题。`,
    };
  }

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

  function recentChatHistory() {
    return messages
      .filter((item) => !item.id.startsWith("welcome-") && item.content.trim())
      .slice(-8)
      .map((item) => ({ role: item.role, content: item.content }));
  }

  function chatRequestContext(chatHistory: Array<{ role: string; content: string }>) {
    const { teamMembers, memoryNotes } = depsRef.current;
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
        const lastTool = [...traceItems]
          .reverse()
          .find((trace) => trace.kind === "tool" && trace.toolUseId === result.toolUseId);
        if (lastTool) {
          return {
            ...item,
            traceItems: traceItems.map((trace) =>
              trace.id === lastTool.id ? { ...trace, ...result } : trace,
            ),
          };
        }
        return {
          ...item,
          traceItems: [...traceItems, result],
          traceCollapsed: false,
          responsePending: true,
        };
      }),
    );
  }

  async function askAgent(text: string) {
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
              const onWeeklyReport = depsRef.current.onWeeklyReport;
              if (onWeeklyReport) void onWeeklyReport(selectedRepo.id);
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

  async function createWorkflowPlan(text: string) {
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

  async function selectProject(repo: Repository) {
    setSelectedRepoId(repo.id);
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

  // 挂载即加载仓库与会话列表（跨路由持久，只加载一次）。
  useEffect(() => {
    loadRepos().catch(() => setRepos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 会话选择纠偏：conversationMap 为空时补拉，selectedConversationId 失效时回退。
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo?.id, conversationMap, selectedConversationId, isDraftConversation]);

  // 加载当前会话历史。依赖稳定，切回工作台时不会重新触发，避免覆盖进行中的流式消息。
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo?.id, selectedConversation?.id, isDraftConversation]);

  const value: WorkspaceChatContextValue = {
    repos,
    selectedRepoId,
    conversationMap,
    selectedConversationId,
    expandedRepoIds,
    messages,
    loading,
    selectedRepo,
    selectedRepoConversations,
    selectedConversation,
    isDraftConversation,
    setRepos,
    setSelectedRepoId,
    setConversationMap,
    setSelectedConversationId,
    setExpandedRepoIds,
    setMessages,
    loadRepos,
    loadRepoConversations,
    loadChatHistory,
    selectProject,
    selectConversation,
    addConversation,
    removeConversation,
    askAgent,
    createWorkflowPlan,
    executeWorkflowPlan,
    stopAgentResponse,
    registerDeps,
  };

  return <WorkspaceChatContext.Provider value={value}>{children}</WorkspaceChatContext.Provider>;
}
