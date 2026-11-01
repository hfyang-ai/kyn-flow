"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, Folder, Home, Loader2, X } from "lucide-react";

import { apiGet } from "@/lib/api";
import type { AddProjectSource, AddProjectStatus } from "../types";
import { parseRepositoryInput } from "../utils";

export type LocalDirEntry = { name: string; path: string };

export type LocalDirsResponse = {
  current: string;
  parent: string | null;
  home: string;
  root: string;
  separator: string;
  dirs: LocalDirEntry[];
};

export function DirectoryPicker({
  onSelect,
  onClose
}: {
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<LocalDirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(path: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<LocalDirsResponse>(`/api/repos/local-dirs?path=${encodeURIComponent(path)}`);
      setCurrent(data.current);
      setParent(data.parent);
      setDirs(data.dirs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取目录");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("");
  }, []);

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-stone-950/50 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="选择本地目录"
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-[#134e4a] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-4 border-b border-sage-800 px-4 py-3">
          <div className="text-sm font-semibold text-ink">选择本地目录</div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel text-stone-300 transition hover:bg-sage-900"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <button
            onClick={() => load(parent ?? "")}
            disabled={!parent || loading}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-stone-300 transition hover:bg-sage-900 disabled:opacity-40"
            title="返回上级"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => load("")}
            disabled={loading}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-stone-300 transition hover:bg-sage-900 disabled:opacity-40"
            title="主目录"
          >
            <Home className="h-4 w-4" />
          </button>
          <div
            className="min-w-0 flex-1 truncate rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-xs text-stone-300"
            title={current}
          >
            {current || "…"}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-stone-400">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : error ? (
            <div className="px-3 py-8 text-center text-sm text-rose-300">{error}</div>
          ) : dirs.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-stone-400">该目录下没有子目录</div>
          ) : (
            <div className="space-y-0.5">
              {dirs.map((dir) => (
                <button
                  key={dir.path}
                  onClick={() => load(dir.path)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-stone-200 transition hover:bg-sage-900"
                >
                  <Folder className="h-4 w-4 shrink-0 text-sage-300" />
                  <span className="truncate">{dir.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-md border border-line bg-panel px-4 text-sm font-medium text-stone-200 transition hover:bg-panel"
          >
            取消
          </button>
          <button
            onClick={() => onSelect(current)}
            disabled={!current || loading}
            className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-[#062a1d] transition hover:bg-sage-400 disabled:opacity-60"
          >
            选择此目录
          </button>
        </div>
      </div>
    </div>
  );
}

export function AddProjectOverlay({
  source,
  repoUrl,
  localPath,
  cloneParentDir,
  provider,
  apiBaseUrl,
  token,
  loading,
  status,
  onSourceChange,
  onRepoUrlChange,
  onLocalPathChange,
  onCloneParentDirChange,
  onProviderChange,
  onApiBaseUrlChange,
  onTokenChange,
  onConnect,
  onClose
}: {
  source: AddProjectSource;
  repoUrl: string;
  localPath: string;
  cloneParentDir: string;
  provider: string;
  apiBaseUrl: string;
  token: string;
  loading: boolean;
  status: AddProjectStatus | null;
  onSourceChange: (value: AddProjectSource) => void;
  onRepoUrlChange: (value: string) => void;
  onLocalPathChange: (value: string) => void;
  onCloneParentDirChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onApiBaseUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onConnect: () => void;
  onClose: () => void;
}) {
  const parsed = source === "remote" ? parseRepositoryInput(repoUrl) : null;
  const canConnect = source === "local" ? Boolean(localPath.trim()) : Boolean(repoUrl.trim());
  const [isDirPickerOpen, setDirPickerOpen] = useState(false);
  const [isWindows, setIsWindows] = useState(false);

  useEffect(() => {
    setIsWindows(/Windows/i.test(navigator.userAgent));
  }, []);

  const localPathPlaceholder = isWindows ? "例如 D:\\code\\my-repo" : "例如 ~/code/my-repo";
  const cloneParentPlaceholder = isWindows ? "例如 D:\\code\\repos，留空则使用默认缓存目录" : "例如 ~/code/repos，留空则使用默认缓存目录";

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-stone-950/35 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
        className="flex max-h-[calc(100%-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-line bg-[#134e4a] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-sage-800 bg-[#134e4a] px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Add Project</div>
            <h2 id="add-project-title" className="mt-1 text-xl font-semibold text-ink">
              添加项目
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-stone-300 transition hover:bg-sage-900 disabled:opacity-60"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
            <section className="rounded-md border border-line bg-panel p-4 shadow-sm">
              <div className="grid gap-4">
                <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-stone-900 p-1">
                  <button
                    type="button"
                    onClick={() => onSourceChange("remote")}
                    className={`h-9 rounded px-3 text-sm font-medium transition ${source === "remote" ? "bg-panel text-ink shadow-sm" : "text-stone-300 hover:text-ink"
                      }`}
                  >
                    GitHub 地址
                  </button>
                  <button
                    type="button"
                    onClick={() => onSourceChange("local")}
                    className={`h-9 rounded px-3 text-sm font-medium transition ${source === "local" ? "bg-panel text-ink shadow-sm" : "text-stone-300 hover:text-ink"
                      }`}
                  >
                    本地仓库
                  </button>
                </div>

                {source === "remote" ? (
                  <div className="grid gap-4">
                    <label className="text-sm font-medium text-stone-200">
                      GitHub 地址
                      <input
                        value={repoUrl}
                        onChange={(event) => onRepoUrlChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onConnect();
                          }
                        }}
                        placeholder="https://github.com/owner/repository 或 owner/repository"
                        className="mt-2 h-11 w-full rounded-md border border-line bg-panel px-3 text-sm outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-100"
                      />
                    </label>

                    <label className="text-sm font-medium text-stone-200">
                      下载到
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          value={cloneParentDir}
                          onChange={(event) => onCloneParentDirChange(event.target.value)}
                          placeholder={cloneParentPlaceholder}
                          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-panel px-3 text-sm outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-100"
                        />
                        <button
                          type="button"
                          onClick={() => setDirPickerOpen(true)}
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-stone-400 transition hover:bg-sage-900 hover:text-ink"
                          title="选择目录"
                        >
                          <Folder className="h-4 w-4" />
                        </button>
                      </div>
                    </label>
                  </div>
                ) : (
                  <label className="text-sm font-medium text-stone-200">
                    本地仓库路径
                    <div className="mt-2 flex gap-2">
                      <input
                        value={localPath}
                        onChange={(event) => onLocalPathChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onConnect();
                          }
                        }}
                        placeholder={localPathPlaceholder}
                        className="h-11 min-w-0 flex-1 rounded-md border border-line bg-panel px-3 text-sm outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-100"
                      />
                      <button
                        type="button"
                        onClick={() => setDirPickerOpen(true)}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-stone-400 transition hover:bg-sage-900 hover:text-ink"
                        title="选择目录"
                      >
                        <Folder className="h-4 w-4" />
                      </button>
                    </div>
                  </label>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm font-medium text-stone-200">
                    托管平台
                    <select
                      value={provider}
                      onChange={(event) => onProviderChange(event.target.value)}
                      className="mt-2 h-10 w-full rounded-md border border-line bg-panel px-3 text-sm outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-100"
                    >
                      <option value="github">GitHub</option>
                      <option value="github_compatible">GitHub-compatible API</option>
                    </select>
                  </label>

                  <label className="text-sm font-medium text-stone-200">
                    API Base URL
                    <input
                      value={apiBaseUrl}
                      disabled={provider === "github"}
                      onChange={(event) => onApiBaseUrlChange(event.target.value)}
                      className="mt-2 h-10 w-full rounded-md border border-line bg-panel px-3 text-sm outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-100 disabled:bg-stone-800 disabled:text-stone-400"
                    />
                  </label>
                </div>

                <label className="text-sm font-medium text-stone-200">
                  Access Token
                  <input
                    type="password"
                    value={token}
                    onChange={(event) => onTokenChange(event.target.value)}
                    placeholder="public repo 可留空，私有仓库需要 token"
                    className="mt-2 h-10 w-full rounded-md border border-line bg-panel px-3 text-sm outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-100"
                  />
                </label>

                {status && (
                  <div
                    className={`rounded-md border px-3 py-2 text-sm leading-6 ${status.type === "success" ? "border-emerald-800/60 bg-emerald-900/40 text-emerald-200" : "border-rose-800/60 bg-rose-900/40 text-rose-200"
                      }`}
                  >
                    <div className="font-semibold">{status.title}</div>
                    {status.detail && <div className="mt-1 break-words">{status.detail}</div>}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={onConnect}
                    disabled={loading || !canConnect}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-[#062a1d] transition hover:bg-sage-400 disabled:opacity-60"
                  >
                    {loading ? "连接并同步中..." : "连接并同步"}
                  </button>
                  <button
                    onClick={onClose}
                    disabled={loading}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-panel px-4 text-sm font-medium text-stone-200 transition hover:bg-panel disabled:opacity-60"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-md border border-line bg-panel p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-ink">识别结果</h3>
              <div className="mt-3 rounded-md bg-[#0e1a16] p-3 text-sm leading-7 text-stone-300">
                {source === "remote" ? (
                  <>
                    <div>
                      Owner: <span className="font-medium text-ink">{parsed?.owner || "待识别"}</span>
                    </div>
                    <div>
                      Repository: <span className="font-medium text-ink">{parsed?.repo || "待识别"}</span>
                    </div>
                    <div>
                      下载到: <span className="break-all font-medium text-ink">{cloneParentDir.trim() || "默认缓存目录"}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      本地路径: <span className="break-all font-medium text-ink">{localPath.trim() || "待选择"}</span>
                    </div>
                    <div>
                      远程仓库: <span className="font-medium text-ink">提交后从 origin 识别</span>
                    </div>
                  </>
                )}
              </div>
              <div className="mt-4 space-y-2 text-xs leading-6 text-stone-400">
                {source === "remote" ? (
                  <div>支持 `https://github.com/owner/repo`、`git@github.com:owner/repo.git`、`owner/repo`。</div>
                ) : (
                  <div>本地仓库需要已配置 `origin` 远程地址。</div>
                )}
                <div>连接成功后会同步 GitHub 数据，并在后台索引代码用于代码 RAG 和风险分析。</div>
                <div>如果连接失败，会直接显示后端返回的原因，不再展开原始 JSON。</div>
              </div>
            </section>
          </div>
        </div>
      </div>
      {isDirPickerOpen && (
        <DirectoryPicker
          onSelect={(path) => {
            if (source === "remote") {
              onCloneParentDirChange(path);
            } else {
              onLocalPathChange(path);
            }
            setDirPickerOpen(false);
          }}
          onClose={() => setDirPickerOpen(false)}
        />
      )}
    </div>
  );
}
