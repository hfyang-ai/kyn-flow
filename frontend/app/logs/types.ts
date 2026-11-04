export type LogTab = "agent-runs" | "chat-messages" | "audit-logs" | "workflows";

export type LogPageResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  start?: string | null;
  end?: string | null;
};

export type LogSummary = {
  agent_runs: number;
  chat_messages: number;
  audit_logs: number;
  workflows: number;
  start?: string | null;
  end?: string | null;
};

export type AgentRunLog = {
  id: string;
  repo_id?: string | null;
  repo_name?: string | null;
  conversation_id?: string | null;
  user_message: string;
  route: string;
  status: string;
  tool_call_count: number;
  tool_calls: Array<Record<string, unknown>>;
  final_answer: string;
  created_at: string;
};

export type ChatMessageLog = {
  id: string;
  repo_id?: string | null;
  repo_name?: string | null;
  conversation_id?: string | null;
  role: string;
  route?: string | null;
  content: string;
  content_length: number;
  content_truncated: boolean;
  tool_call_count: number;
  meta: Record<string, unknown>;
  created_at: string;
};

export type AuditLogEntry = {
  id: string;
  user_id?: string | null;
  repo_id?: string | null;
  repo_name?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  status: string;
  request_json: Record<string, unknown>;
  result_json: Record<string, unknown>;
  created_at: string;
};

export type WorkflowTaskLog = {
  id: string;
  task_id: string;
  agent_name: string;
  task_type: string;
  status: string;
  error?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  claim: Record<string, unknown>;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type WorkflowRunLog = {
  id: string;
  repo_id?: string | null;
  repo_name?: string | null;
  conversation_id?: string | null;
  goal: string;
  status: string;
  spec: Record<string, unknown>;
  observation: Record<string, unknown>;
  metrics: Record<string, unknown>;
  final_answer: string;
  created_at: string;
  completed_at?: string | null;
  duration_ms?: number | null;
  tasks: WorkflowTaskLog[];
};

export type LogEntry = AgentRunLog | ChatMessageLog | AuditLogEntry | WorkflowRunLog;
