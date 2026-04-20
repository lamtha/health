"use client";

import { openSearchDialog } from "@/components/health/search-portal";
import { cn } from "@/lib/utils";

// Two visual variants: the compact chip in the top-bar, and the
// full-width pseudo-input that replaces the placeholder search field
// on the dashboard.
export function SearchTrigger({
  variant,
  className,
}: {
  variant: "compact" | "full";
  className?: string;
}) {
  const commonProps = {
    type: "button" as const,
    onClick: openSearchDialog,
    "aria-label": "Open search",
  };

  if (variant === "compact") {
    return (
      <button
        {...commonProps}
        className={cn(
          "flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-[12px] text-muted-foreground transition-colors hover:bg-muted/40",
          className,
        )}
      >
        <span>Search metrics, reports…</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px]">
          ⌘K
        </span>
      </button>
    );
  }

  return (
    <button
      {...commonProps}
      className={cn(
        "group flex h-10 w-full items-center gap-3 rounded-md border border-input bg-background px-3 text-left text-[13px] text-muted-foreground transition-colors hover:border-foreground/30",
        className,
      )}
    >
      <svg
        className="text-muted-foreground"
        width={14}
        height={14}
        viewBox="0 0 14 14"
        fill="none"
      >
        <circle cx={6} cy={6} r={4.5} stroke="currentColor" strokeWidth={1.25} />
        <path
          d="M9.5 9.5L12 12"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinecap="round"
        />
      </svg>
      <span className="flex-1">Search WBC, Akkermansia, hsCRP…</span>
      <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px]">
        ⌘K
      </span>
    </button>
  );
}
