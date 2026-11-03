export const workspaceTabs = [
  "Issue",
  "PR",
  "CI",
  "团队",
  "记忆&知识库",
  "技能&MCP",
  "图谱",
] as const;
export type WorkspaceTab = (typeof workspaceTabs)[number];
export const issueCategoryMeta = [
  { key: "unanswered", label: "未回复", color: "text-red-600" },
  { key: "discussing", label: "讨论中", color: "text-emerald-600" },
  { key: "decision", label: "待决策", color: "text-amber-600" },
  { key: "accepted", label: "已处理", color: "text-emerald-600" },
  { key: "rejected", label: "已拒绝", color: "text-faint" },
  { key: "closed", label: "已关闭", color: "text-faint" },
] as const;

export const prCategoryMeta = [
  { key: "reviewing", label: "审核中", color: "text-emerald-600" },
  { key: "needsOwner", label: "需主审", color: "text-amber-600" },
  { key: "conflict", label: "有冲突", color: "text-red-600" },
  { key: "done", label: "已完成", color: "text-emerald-600" },
  { key: "rejected", label: "已拒绝", color: "text-faint" },
] as const;
