"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";

const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g;

const FOLD_LINE_THRESHOLD = 14;
const PREVIEW_LINES = 8;

function isEmptyValue(value: unknown) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

/** 极简 JSON 着色：键、字符串、数字、布尔分别上色，全部走 React 节点，不拼 HTML。 */
function highlight(line: string) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(line)) !== null) {
    if (match.index > cursor) nodes.push(line.slice(cursor, match.index));
    const [, str, colon, num, literal] = match;
    if (str) {
      nodes.push(
        colon ? (
          <span key={`${match.index}-k`} className="font-medium text-accent">
            {str}
          </span>
        ) : (
          <span key={`${match.index}-s`} className="text-emerald-700">
            {str}
          </span>
        ),
      );
      if (colon) nodes.push(colon);
    } else if (num) {
      nodes.push(
        <span key={`${match.index}-n`} className="text-sky-700">
          {num}
        </span>,
      );
    } else if (literal) {
      nodes.push(
        <span key={`${match.index}-l`} className="text-rose-600">
          {literal}
        </span>,
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes.length ? nodes : "\u00a0";
}

export function JsonBlock({
  label,
  value,
  defaultOpen = false,
  emptyHint = "无内容",
  previewLines = PREVIEW_LINES,
}: {
  label: string;
  value: unknown;
  defaultOpen?: boolean;
  emptyHint?: string;
  previewLines?: number;
}) {
  const text = useMemo(() => {
    try {
      return JSON.stringify(value ?? {}, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  const lines = useMemo(() => text.split("\n"), [text]);
  const empty = isEmptyValue(value);
  const foldable = lines.length > FOLD_LINE_THRESHOLD;
  const [open, setOpen] = useState(defaultOpen || !foldable);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const visible = open ? lines : lines.slice(0, previewLines);
  const showBody = !empty && (open || previewLines > 0);

  return (
    <div className="rounded-md border border-line bg-panel-2">
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => foldable && setOpen((value) => !value)}
          className={`flex min-w-0 items-center gap-1 text-[11px] font-medium text-muted ${
            foldable ? "transition hover:text-ink" : "cursor-default"
          }`}
          aria-expanded={open}
        >
          {foldable ? (
            open ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <span className="truncate font-mono">{label}</span>
        </button>
        <span className="shrink-0 text-[10px] text-faint">
          {empty ? emptyHint : `${lines.length} 行`}
        </span>
        <button
          type="button"
          onClick={copy}
          disabled={empty}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] text-faint transition hover:bg-panel-3 hover:text-ink disabled:opacity-40"
          title="复制 JSON"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      {showBody && (
        <pre className="max-h-[360px] overflow-auto px-2.5 py-2 font-mono text-[11px] leading-5 text-muted">
          {visible.map((line, index) => (
            <div key={index} className="whitespace-pre">
              {highlight(line)}
            </div>
          ))}
          {!open && foldable && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-1 text-[11px] font-medium text-accent transition hover:text-accent-bright"
            >
              展开剩余 {lines.length - previewLines} 行
            </button>
          )}
        </pre>
      )}
    </div>
  );
}
