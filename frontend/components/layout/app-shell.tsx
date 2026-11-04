"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/home", label: "工作台" },
  { href: "/knowledge", label: "项目知识" },
  { href: "/rag", label: "RAG 工作室" },
  { href: "/repos", label: "Repos" },
  { href: "/action-drafts", label: "Drafts" },
  { href: "/workflow-runs", label: "Runs" },
  { href: "/workspaces", label: "团队工作区" },
  { href: "/reports", label: "研发周报" },
  { href: "/code-graph", label: "Code Graph" },
  { href: "/evals", label: "Evals" },
  { href: "/logs", label: "日志" },
];

function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#166534" />
      <path d="M7.5 12h9" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7.5" cy="12" r="2.2" fill="#ffffff" />
      <circle cx="16.5" cy="12" r="2.2" fill="#ffffff" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto flex h-[53px] max-w-[1500px] items-center gap-1 px-4 sm:px-6">
          <Link
            href="/home"
            className="mr-4 flex shrink-0 items-center gap-2.5"
            aria-label="Kynflow 首页"
          >
            <BrandMark />
            <span className="text-[15px] font-semibold tracking-tight text-ink">kynflow</span>
          </Link>

          <nav
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
            aria-label="主导航"
          >
            {navItems.map((item) => {
              const active =
                item.href === "/home" ? pathname === "/home" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative shrink-0 whitespace-nowrap px-3 py-3 text-sm transition-colors ${
                    active ? "font-medium text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                  <span
                    className={`absolute inset-x-3 bottom-0 h-[2px] rounded-full ${
                      active ? "bg-accent" : "bg-transparent"
                    }`}
                  />
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="w-full p-3">{children}</main>
    </div>
  );
}
