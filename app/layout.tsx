import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Logo } from "@/components/ui/logo";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Image Master Canvas",
  description: "低代码商业图片生成工作台",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  userScalable: true,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased bg-warm-bg">
        <header className="sticky top-0 z-50 w-full border-b border-warm-line/10 bg-warm-bg/80 backdrop-blur-md px-6 py-3">
          <div className="mx-auto max-w-6xl flex items-center justify-between">
            <Logo />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1680px] px-4 pb-24 pt-4 sm:px-6 lg:pb-6">
          {children}
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
