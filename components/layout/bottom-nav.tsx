"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, ImageIcon, Images, Settings } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const NAV_ITEMS = [
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/canvas", label: "画布", icon: ImageIcon },
  { href: "/result", label: "成片", icon: Images },
  { href: "/settings", label: "设置", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-warm-line bg-warm-paper/90 backdrop-blur-lg lg:hidden">
      <div className="mx-auto flex max-w-lg items-center justify-around h-13">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-4 py-1.5 text-xs transition-colors",
                isActive
                  ? "text-warm-ink"
                  : "text-warm-muted/50 hover:text-warm-muted"
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
