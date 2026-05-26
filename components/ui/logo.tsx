import { cn } from "@/lib/utils/cn";
import Link from "next/link";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5 hover:opacity-80 transition-opacity", className)}>
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-warm-primary text-warm-paper font-serif font-bold text-base shadow-lg shadow-warm-primary/20">
        M
      </div>
      <div className="flex flex-col -space-y-1">
        <span className="text-base font-serif font-medium tracking-tight text-warm-ink">
          Image Master
        </span>
        <span className="text-[8px] text-warm-muted uppercase tracking-[0.2em] opacity-40 font-medium">
          AI Marketing
        </span>
      </div>
    </Link>
  );
}
