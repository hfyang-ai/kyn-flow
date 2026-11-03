"use client";

import { BookOpen, Cable, RefreshCw, ShieldCheck } from "lucide-react";

import type { McpRuntime, SkillResponse } from "../types";

export function SkillMcpWorkspace({
  runtime,
  skills,
  selectedSkillName,
  loading,
  error,
  onSelectSkill,
  onRefresh,
}: {
  runtime: McpRuntime | null;
  skills: SkillResponse[];
  selectedSkillName: string;
  loading: boolean;
  error: string | null;
  onSelectSkill: (name: string) => void;
  onRefresh: () => void;
}) {
  const selectedSkill =
    skills.find((item) => item.manifest.name === selectedSkillName) ?? skills[0];

  return (
    <div className="space-y-5">
      <section aria-label="MCP Server 验证">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Cable className="h-4 w-4 text-accent" />
              MCP Server 验证
            </div>
            <p className="mt-1 text-xs leading-5 text-faint">
              页面会真实执行 initialize、initialized 与 tools/list。
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-xs font-medium text-ink transition hover:bg-sage-100 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            重新验证
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-600">
            {error}
          </div>
        )}
        {!runtime && !error && (
          <div className="mt-3 rounded-md border border-dashed border-line bg-panel p-4 text-center text-xs text-faint">
            {loading ? "正在启动 stdio 子进程并执行 MCP 握手..." : "等待验证 MCP Server"}
          </div>
        )}
        {runtime && (
          <>
            <div className="mt-3 border-y border-line bg-panel py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">
                    {runtime.server_name}
                  </div>
                  <div className="mt-1 text-xs text-faint">
                    Server v{runtime.server_version}
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  握手成功
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-faint">Protocol</dt>
                  <dd className="mt-0.5 font-medium text-ink">{runtime.protocol_version}</dd>
                </div>
                <div>
                  <dt className="text-faint">Transport</dt>
                  <dd className="mt-0.5 font-medium text-ink">{runtime.transport}</dd>
                </div>
              </dl>
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink">tools/list 返回结果</span>
                <span className="text-faint">{runtime.tools.length} 个只读工具</span>
              </div>
              <div className="mt-2 divide-y divide-line border-y border-line bg-panel">
                {runtime.tools.map((tool) => (
                  <div key={tool.name} className="py-3">
                    <div className="break-all font-mono text-xs font-semibold text-accent">
                      {tool.name}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted">{tool.description}</p>
                    <div className="mt-1 text-[11px] text-faint">
                      必填参数：{tool.input_schema.required?.join("、") || "无"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <section aria-label="Skill Registry 验证" className="border-t border-line pt-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <BookOpen className="h-4 w-4 text-accent" />
          Skill Registry 验证
        </div>
        <label className="mt-3 block text-xs font-medium text-muted" htmlFor="skill-selector">
          选择已加载 Skill
        </label>
        <select
          id="skill-selector"
          value={selectedSkill?.manifest.name ?? ""}
          onChange={(event) => onSelectSkill(event.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-line bg-panel px-2 text-xs text-ink outline-none focus:border-sage-500"
        >
          {skills.map((item) => (
            <option key={item.manifest.name} value={item.manifest.name}>
              {item.manifest.title}
            </option>
          ))}
        </select>

        {selectedSkill && (
          <div className="mt-3 border-y border-line bg-panel py-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-ink">{selectedSkill.manifest.title}</div>
                <div className="mt-1 font-mono text-[11px] text-faint">
                  {selectedSkill.manifest.name}
                </div>
              </div>
              <span className="rounded-full bg-sage-100 px-2 py-1 font-semibold text-accent">
                v{selectedSkill.manifest.version}
              </span>
            </div>
            <p className="mt-3 leading-5 text-muted">{selectedSkill.manifest.description}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <dt className="text-faint">Entrypoint</dt>
                <dd className="mt-0.5 break-all font-mono text-[11px] font-medium text-ink">
                  {selectedSkill.manifest.entrypoint}
                </dd>
              </div>
              <div>
                <dt className="text-faint">Safety</dt>
                <dd className="mt-0.5 inline-flex items-center gap-1 font-medium text-emerald-600">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {selectedSkill.manifest.safety_level}
                </dd>
              </div>
            </dl>
            <div className="mt-4 font-semibold text-ink">自动触发条件</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedSkill.manifest.triggers.map((trigger) => (
                <span
                  key={trigger}
                  className="rounded bg-sage-100 px-2 py-1 text-[10px] text-accent"
                >
                  {trigger}
                </span>
              ))}
            </div>
            <div className="mt-4 font-semibold text-ink">工作流步骤</div>
            <ol className="mt-2 space-y-2">
              {selectedSkill.manifest.workflow_steps.map((step, index) => (
                <li key={step} className="flex items-start gap-2 text-muted">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[10px] font-semibold text-muted">
                    {index + 1}
                  </span>
                  <span className="break-all font-mono text-[11px] leading-5">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4 font-semibold text-ink">绑定工具</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedSkill.manifest.tools.map((tool) => (
                <span
                  key={tool}
                  className="rounded bg-stone-100 px-2 py-1 font-mono text-[10px] text-muted"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
