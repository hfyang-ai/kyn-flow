import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceChatProvider } from "@/components/workspace-chat-provider";

export const metadata: Metadata = {
  title: "Kynflow",
  description: "PR / Issue intelligent collaboration agent for engineering teams",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <WorkspaceChatProvider>
          <AppShell>{children}</AppShell>
        </WorkspaceChatProvider>
      </body>
    </html>
  );
}
