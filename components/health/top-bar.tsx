import Link from "next/link";

import { SearchTrigger } from "@/components/health/search-trigger";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "dashboard", label: "Dashboard", href: "/" },
  { id: "reports", label: "Reports", href: "/reports" },
  { id: "compare", label: "Compare", href: "/compare" },
  { id: "interventions", label: "Interventions", href: "/interventions" },
  { id: "uploads", label: "Upload", href: "/uploads" },
  { id: "settings", label: "Settings", href: "/settings" },
];

export function TopBar({ current }: { current?: string }) {
  return (
    <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-6">
      <div className="grid h-7 w-7 place-items-center rounded bg-primary text-[11px] font-semibold text-primary-foreground">
        H
      </div>
      <nav className="flex gap-1 text-[13px]">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            className={cn(
              "flex h-8 items-center rounded-md px-3 font-medium transition-colors",
              current === t.id
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <SearchTrigger variant="compact" />
      </div>
    </div>
  );
}
