"use client";

import { useMemo } from "react";
import { Database, Network, RefreshCw, Search, X } from "lucide-react";

import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphResponse,
  WorkspaceSelection,
} from "../types";
import { type WorkspaceTab } from "../constants";

export function KnowledgeGraphWorkspace({
  graph,
  loading,
  error,
  query,
  selectedNodeKey,
  hiddenNodeTypes,
  hiddenRelations,
  onQueryChange,
  onSelectNode,
  onToggleNodeType,
  onToggleRelation,
  onRefresh,
  onRebuild,
  onFocusNode,
  onOpenNode,
}: {
  graph: KnowledgeGraphResponse | null;
  loading: boolean;
  error: string | null;
  query: string;
  selectedNodeKey: string | null;
  hiddenNodeTypes: Record<string, boolean>;
  hiddenRelations: Record<string, boolean>;
  onQueryChange: (value: string) => void;
  onSelectNode: (value: string) => void;
  onToggleNodeType: (type: string) => void;
  onToggleRelation: (relation: string) => void;
  onRefresh: () => void;
  onRebuild: () => void;
  onFocusNode: (node: KnowledgeGraphNode) => void;
  onOpenNode: (node: KnowledgeGraphNode) => void;
}) {
  const allNodes = graph?.nodes ?? [];
  const allEdges = graph?.edges ?? [];
  const nodeByKey = useMemo(
    () => new Map(allNodes.map((node) => [knowledgeGraphNodeKey(node), node])),
    [allNodes],
  );
  const nodeTypes = useMemo(() => [...new Set(allNodes.map((node) => node.type))], [allNodes]);
  const relations = useMemo(() => [...new Set(allEdges.map((edge) => edge.relation))], [allEdges]);
  const filtered = useMemo(
    () => filterKnowledgeGraph(allNodes, allEdges, query, hiddenNodeTypes, hiddenRelations),
    [allNodes, allEdges, query, hiddenNodeTypes, hiddenRelations],
  );
  const centerKey =
    graph?.center_type && graph.center_id ? `${graph.center_type}:${graph.center_id}` : undefined;
  const positions = useMemo(
    () => layoutKnowledgeGraph(filtered.nodes, filtered.edges, centerKey),
    [filtered.nodes, filtered.edges, centerKey],
  );
  const selectedNode =
    (selectedNodeKey &&
      filtered.nodes.find((node) => knowledgeGraphNodeKey(node) === selectedNodeKey)) ??
    filtered.nodes[0] ??
    null;
  const selectedEdges = selectedNode
    ? filtered.edges.filter(
        (edge) =>
          (edge.from_type === selectedNode.type && edge.from_id === selectedNode.id) ||
          (edge.to_type === selectedNode.type && edge.to_id === selectedNode.id),
      )
    : [];
  const showEdgeLabels = filtered.edges.length <= 8;
  const visibleNodeCount = graphStatNumber(graph, "visible_nodes", allNodes.length);
  const visibleEdgeCount = graphStatNumber(graph, "visible_edges", allEdges.length);
  const totalEdgeCount = graphStatNumber(graph, "total_edges", allEdges.length);

  return (
    <div className="space-y-3">
      <section className="rounded-md border border-line bg-panel p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-ink">项目知识图谱</h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-stone-400">
              把 Issue、PR、CI、成员、文档、记忆和代码文件按可追溯关系串起来。
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title="刷新图谱"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-stone-400 transition hover:bg-panel disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onRebuild}
              disabled={loading}
              title="重建关系边"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-stone-400 transition hover:bg-panel disabled:opacity-50"
            >
              <Database className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-stone-300">
          <div className="rounded-md bg-panel px-3 py-2">节点 {visibleNodeCount}</div>
          <div className="rounded-md bg-panel px-3 py-2">关系 {visibleEdgeCount}</div>
          <div className="rounded-md bg-panel px-3 py-2">总边 {totalEdgeCount}</div>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-panel px-3">
          <Search className="h-4 w-4 shrink-0 text-stone-500" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索节点或关系..."
            className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="text-stone-500 hover:text-stone-300"
              title="清空搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {Boolean(nodeTypes.length) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {nodeTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onToggleNodeType(type)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  hiddenNodeTypes[type]
                    ? "border-line bg-panel text-stone-500"
                    : "border-transparent bg-panel text-stone-200"
                }`}
              >
                {graphNodeTypeLabel(type)}
              </button>
            ))}
          </div>
        )}

        {Boolean(relations.length) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {relations.map((relation) => (
              <button
                key={relation}
                type="button"
                onClick={() => onToggleRelation(relation)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  hiddenRelations[relation]
                    ? "border-line bg-panel text-stone-500"
                    : "border-transparent bg-panel text-stone-200"
                }`}
              >
                {graphRelationLabel(relation)}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-md border border-red-800/60 bg-red-900/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!error && !loading && (!graph || graph.nodes.length === 0) && (
        <div className="rounded-md border border-line bg-panel p-4 text-sm text-stone-400">
          还没有可展示的项目关系。同步 Issue/PR/CI，或添加项目记忆后再重建图谱。
        </div>
      )}

      {loading && !graph && (
        <div className="rounded-md border border-line bg-panel p-4 text-sm text-stone-400">
          正在加载项目知识图谱...
        </div>
      )}

      {graph && filtered.nodes.length === 0 && (
        <div className="rounded-md border border-line bg-panel p-4 text-sm text-stone-400">
          当前搜索或过滤条件下没有匹配节点。
        </div>
      )}

      {graph && filtered.nodes.length > 0 && (
        <section className="rounded-md border border-line bg-panel p-3">
          <div className="overflow-x-auto rounded-md bg-panel">
            <svg
              viewBox="0 0 720 420"
              className="h-[360px] min-w-[680px] w-full"
              role="img"
              aria-label="项目知识图谱"
            >
              {filtered.edges.map((edge) => {
                const from = positions.get(`${edge.from_type}:${edge.from_id}`);
                const to = positions.get(`${edge.to_type}:${edge.to_id}`);
                if (!from || !to) return null;
                const color = graphRelationColor(edge.relation);
                return (
                  <g key={edge.id}>
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={color}
                      strokeWidth={edge.relation === "used_as_evidence" ? 2.8 : 1.6}
                      strokeOpacity="0.58"
                    />
                    {showEdgeLabels && (
                      <text
                        x={(from.x + to.x) / 2}
                        y={(from.y + to.y) / 2 - 5}
                        textAnchor="middle"
                        fontSize="10"
                        fill={color}
                        fontWeight="700"
                      >
                        {graphRelationLabel(edge.relation)}
                      </text>
                    )}
                  </g>
                );
              })}
              {filtered.nodes.map((node) => {
                const pos = positions.get(knowledgeGraphNodeKey(node));
                if (!pos) return null;
                const selected = selectedNode
                  ? knowledgeGraphNodeKey(selectedNode) === knowledgeGraphNodeKey(node)
                  : false;
                const style = graphNodeStyle(node.type);
                return (
                  <g
                    key={knowledgeGraphNodeKey(node)}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectNode(knowledgeGraphNodeKey(node))}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={selected ? 19 : 15}
                      fill={node.highlighted ? "#3a2410" : style.fill}
                      stroke={node.highlighted ? "#fb923c" : selected ? "#060a08" : style.stroke}
                      strokeWidth={node.highlighted || selected ? 2.6 : 1.6}
                    />
                    <text
                      x={pos.x}
                      y={pos.y + 34}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight={selected ? "700" : "600"}
                      fill="#a8d9cb"
                    >
                      {clipGraphLabel(node.title, 18)}
                    </text>
                    <text x={pos.x} y={pos.y + 48} textAnchor="middle" fontSize="9" fill="#7fa89a">
                      {graphNodeTypeLabel(node.type)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {selectedNode && (
            <div className="mt-3 rounded-md border border-line bg-panel p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-accent">
                    {graphNodeTypeLabel(selectedNode.type)}
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm font-semibold text-ink">
                    {selectedNode.title}
                  </div>
                  {selectedNode.subtitle && (
                    <div className="mt-1 text-xs text-stone-400">{selectedNode.subtitle}</div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onFocusNode(selectedNode)}
                    className="rounded-md border border-line px-2 py-1 text-xs text-stone-300 transition hover:bg-panel"
                  >
                    聚焦
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenNode(selectedNode)}
                    className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-[#062a1d] transition hover:bg-sage-400"
                  >
                    打开
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                {selectedEdges.length === 0 && (
                  <div className="text-xs text-stone-400">这个节点暂时没有可见关系。</div>
                )}
                {selectedEdges.slice(0, 8).map((edge) => {
                  const isOutgoing =
                    edge.from_type === selectedNode.type && edge.from_id === selectedNode.id;
                  const other = nodeByKey.get(
                    isOutgoing
                      ? `${edge.to_type}:${edge.to_id}`
                      : `${edge.from_type}:${edge.from_id}`,
                  );
                  return (
                    <div
                      key={edge.id}
                      className="rounded-md bg-panel px-3 py-2 text-xs text-stone-300"
                    >
                      <span className="font-medium text-ink">
                        {isOutgoing ? "→" : "←"} {graphRelationLabel(edge.relation)}
                      </span>
                      <span className="ml-2">{other?.title ?? edge.to_id}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
export function knowledgeGraphNodeKey(node: KnowledgeGraphNode) {
  return `${node.type}:${node.id}`;
}

export function workspaceSelectionToGraphCenter(
  selection: WorkspaceSelection,
): { type: string; id: string } | null {
  if (selection.type === "issue") return { type: "issue", id: selection.id };
  if (selection.type === "pr") return { type: "pull_request", id: selection.id };
  if (selection.type === "ci") return { type: "ci_run", id: selection.id };
  return null;
}

export function openGraphNodeInWorkspace(
  node: KnowledgeGraphNode,
  setWorkspaceTab: (tab: WorkspaceTab) => void,
  setSelectedWorkspaceItem: (item: WorkspaceSelection | null) => void,
  preserveSelectionRef: { current: boolean },
) {
  if (node.type === "issue") {
    preserveSelectionRef.current = true;
    setWorkspaceTab("Issue");
    setSelectedWorkspaceItem({ type: "issue", id: node.id });
    return;
  }
  if (node.type === "pull_request") {
    preserveSelectionRef.current = true;
    setWorkspaceTab("PR");
    setSelectedWorkspaceItem({ type: "pr", id: node.id });
    return;
  }
  if (node.type === "ci_run") {
    preserveSelectionRef.current = true;
    setWorkspaceTab("CI");
    setSelectedWorkspaceItem({ type: "ci", id: node.id });
    return;
  }
  setWorkspaceTab(node.type === "team_member" ? "团队" : "记忆&知识库");
  setSelectedWorkspaceItem(null);
}

export function filterKnowledgeGraph(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  query: string,
  hiddenNodeTypes: Record<string, boolean>,
  hiddenRelations: Record<string, boolean>,
) {
  const normalizedQuery = query.trim().toLowerCase();
  const baseAllowed = new Set(
    nodes.filter((node) => !hiddenNodeTypes[node.type]).map((node) => knowledgeGraphNodeKey(node)),
  );
  const matches = new Set(
    nodes
      .filter((node) => baseAllowed.has(knowledgeGraphNodeKey(node)))
      .filter((node) => !normalizedQuery || graphNodeMatches(node, normalizedQuery))
      .map((node) => knowledgeGraphNodeKey(node)),
  );
  if (normalizedQuery) {
    for (const edge of edges) {
      if (hiddenRelations[edge.relation]) continue;
      const fromKey = `${edge.from_type}:${edge.from_id}`;
      const toKey = `${edge.to_type}:${edge.to_id}`;
      const relationMatches =
        graphRelationLabel(edge.relation).toLowerCase().includes(normalizedQuery) ||
        edge.relation.toLowerCase().includes(normalizedQuery);
      if (relationMatches || matches.has(fromKey) || matches.has(toKey)) {
        if (baseAllowed.has(fromKey)) matches.add(fromKey);
        if (baseAllowed.has(toKey)) matches.add(toKey);
      }
    }
  }
  const allowed = normalizedQuery ? matches : baseAllowed;
  const visibleEdges = edges.filter((edge) => {
    if (hiddenRelations[edge.relation]) return false;
    return (
      allowed.has(`${edge.from_type}:${edge.from_id}`) &&
      allowed.has(`${edge.to_type}:${edge.to_id}`)
    );
  });
  return {
    nodes: nodes.filter((node) => allowed.has(knowledgeGraphNodeKey(node))),
    edges: visibleEdges,
  };
}

export function graphNodeMatches(node: KnowledgeGraphNode, query: string) {
  const metadataText = Object.values(node.metadata ?? {})
    .slice(0, 6)
    .join(" ")
    .toLowerCase();
  return `${node.title} ${node.subtitle ?? ""} ${node.type} ${metadataText}`
    .toLowerCase()
    .includes(query);
}

export function layoutKnowledgeGraph(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  centerKey?: string,
) {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;
  const degrees = new Map<string, number>();
  for (const node of nodes) degrees.set(knowledgeGraphNodeKey(node), 0);
  for (const edge of edges) {
    const fromKey = `${edge.from_type}:${edge.from_id}`;
    const toKey = `${edge.to_type}:${edge.to_id}`;
    degrees.set(fromKey, (degrees.get(fromKey) ?? 0) + 1);
    degrees.set(toKey, (degrees.get(toKey) ?? 0) + 1);
  }
  const requestedCenter = centerKey
    ? nodes.find((node) => knowledgeGraphNodeKey(node) === centerKey)
    : undefined;
  const resolvedCenter =
    requestedCenter ??
    [...nodes].sort(
      (a, b) =>
        (degrees.get(knowledgeGraphNodeKey(b)) ?? 0) - (degrees.get(knowledgeGraphNodeKey(a)) ?? 0),
    )[0];
  const centerNodeKey = knowledgeGraphNodeKey(resolvedCenter);
  positions.set(centerNodeKey, { x: 360, y: 190 });
  const neighborKeys = new Set<string>();
  for (const edge of edges) {
    const fromKey = `${edge.from_type}:${edge.from_id}`;
    const toKey = `${edge.to_type}:${edge.to_id}`;
    if (fromKey === centerNodeKey) neighborKeys.add(toKey);
    if (toKey === centerNodeKey) neighborKeys.add(fromKey);
  }
  const neighbors = nodes.filter((node) => neighborKeys.has(knowledgeGraphNodeKey(node)));
  const remaining = nodes.filter(
    (node) =>
      knowledgeGraphNodeKey(node) !== centerNodeKey &&
      !neighborKeys.has(knowledgeGraphNodeKey(node)),
  );
  placeGraphRing(positions, neighbors, 360, 190, neighbors.length > 10 ? 145 : 122, -Math.PI / 2);
  placeGraphRing(positions, remaining, 360, 190, 184, Math.PI / 9);
  return positions;
}

export function placeGraphRing(
  positions: Map<string, { x: number; y: number }>,
  nodes: KnowledgeGraphNode[],
  cx: number,
  cy: number,
  radius: number,
  start: number,
) {
  if (nodes.length === 0) return;
  nodes.forEach((node, index) => {
    const angle = start + (Math.PI * 2 * index) / nodes.length;
    positions.set(knowledgeGraphNodeKey(node), {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  });
}

export function graphNodeTypeLabel(type: string) {
  const labels: Record<string, string> = {
    issue: "Issue",
    pull_request: "PR",
    ci_run: "CI",
    team_member: "成员",
    memory_note: "记忆",
    document: "文档",
    code_file: "代码",
    session_decision: "决策",
  };
  return labels[type] ?? type;
}

export function graphRelationLabel(relation: string) {
  const labels: Record<string, string> = {
    resolves: "修复",
    mentions: "提及",
    assigned_to: "分配",
    blocked_by: "阻塞",
    failed_in_ci: "CI失败",
    touches_file: "改动",
    documents: "说明",
    cites: "引用",
    produced_from_session: "沉淀",
    used_as_evidence: "召回",
  };
  return labels[relation] ?? relation.replace(/_/g, " ");
}

export function graphNodeStyle(type: string) {
  const styles: Record<string, { fill: string; stroke: string }> = {
    issue: { fill: "#3a2e0a", stroke: "#f59e0b" },
    pull_request: { fill: "#0d2e26", stroke: "#2dd4a7" },
    ci_run: { fill: "#3a1418", stroke: "#f87171" },
    team_member: { fill: "#1a2040", stroke: "#818cf8" },
    memory_note: { fill: "#3a1526", stroke: "#f472b6" },
    document: { fill: "#122238", stroke: "#60a5fa" },
    code_file: { fill: "#12281e", stroke: "#34d399" },
    session_decision: { fill: "#2a1a3a", stroke: "#c084fc" },
  };
  return styles[type] ?? { fill: "#0e1a16", stroke: "#7fa89a" };
}

export function graphRelationColor(relation: string) {
  const colors: Record<string, string> = {
    resolves: "#34d399",
    mentions: "#7fa89a",
    assigned_to: "#818cf8",
    blocked_by: "#f87171",
    failed_in_ci: "#f87171",
    touches_file: "#2dd4a7",
    documents: "#60a5fa",
    cites: "#f472b6",
    produced_from_session: "#c084fc",
    used_as_evidence: "#fb923c",
  };
  return colors[relation] ?? "#7fa89a";
}

export function graphStatNumber(
  graph: KnowledgeGraphResponse | null,
  key: string,
  fallback: number,
) {
  const value = graph?.stats?.[key];
  return typeof value === "number" ? value : fallback;
}

export function clipGraphLabel(text: string, limit: number) {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trim()}…`;
}
