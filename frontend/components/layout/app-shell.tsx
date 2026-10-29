"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "工作台" },
  { href: "/knowledge", label: "项目知识" },
  { href: "/rag", label: "RAG 工作室" },
  { href: "/repos", label: "Repos" },
  { href: "/action-drafts", label: "Drafts" },
  { href: "/workflow-runs", label: "Runs" },
  { href: "/workspaces", label: "团队工作区" },
  { href: "/reports", label: "研发周报" },
  { href: "/code-graph", label: "Code Graph" },
  { href: "/evals", label: "Evals" }
];

function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <rect width="24" height="24" rx="4" fill="#2dd4a7" />
      <path d="M7.5 12h9" stroke="#062a1d" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7.5" cy="12" r="2.2" fill="#062a1d" />
      <circle cx="16.5" cy="12" r="2.2" fill="#062a1d" />
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
            href="/"
            className="mr-4 flex shrink-0 items-center gap-2.5"
            aria-label="Kynflow 首页"
          >
            <BrandMark />
            <span className="font-mono text-[15px] font-semibold tracking-tight text-ink">
              <span className="text-accent">~$</span> kynflow
            </span>
          </Link>

          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="主导航">
            {navItems.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative shrink-0 whitespace-nowrap px-3 py-3 font-mono text-sm transition-colors ${
                    active ? "font-medium text-accent" : "text-stone-400 hover:text-ink"
                  }`}
                >
                  {item.label}
                  <span
                    className={`absolute inset-x-3 bottom-0 h-[2px] ${
                      active ? "bg-accent shadow-[0_0_6px_rgba(45,212,167,0.6)]" : "bg-transparent"
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
