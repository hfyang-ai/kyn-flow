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
  { key: "unanswered", label: "未回复", color: "text-[#f87171]" },
  { key: "discussing", label: "讨论中", color: "text-[#2dd4a7]" },
  { key: "decision", label: "待决策", color: "text-[#f59e0b]" },
  { key: "accepted", label: "已处理", color: "text-[#34d399]" },
  { key: "rejected", label: "已拒绝", color: "text-[#5e8376]" },
  { key: "closed", label: "已关闭", color: "text-[#7fa89a]" },
] as const;

export const prCategoryMeta = [
  { key: "reviewing", label: "审核中", color: "text-[#2dd4a7]" },
  { key: "needsOwner", label: "需主审", color: "text-[#f59e0b]" },
  { key: "conflict", label: "有冲突", color: "text-[#f87171]" },
  { key: "done", label: "已完成", color: "text-[#34d399]" },
  { key: "rejected", label: "已拒绝", color: "text-[#5e8376]" },
] as const;
