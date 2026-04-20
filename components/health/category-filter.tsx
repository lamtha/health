import Link from "next/link";

import {
  CATEGORIES,
  CATEGORY_LABELS,
  TAGS,
  TAG_LABELS,
  type CategorySlug,
  type TagSlug,
} from "@/db/seeds/taxonomy";
import { cn } from "@/lib/utils";
import type { MetricsFilter } from "@/lib/queries";

export interface CategoryFilterProps {
  basePath: "/" | "/reports";
  filter: MetricsFilter;
  categoryCounts: Record<string, number>;
  tagCounts: Record<string, number>;
  // For dashboard: distinct unmapped metric names; for /reports: count of reports with ≥1 unmapped.
  unmappedCount: number;
  // Label suffix under the chips — e.g. "metric" or "report"
  entityLabel: "metric" | "report";
}

export function CategoryFilter({
  basePath,
  filter,
  categoryCounts,
  tagCounts,
  unmappedCount,
  entityLabel,
}: CategoryFilterProps) {
  const catChips = (CATEGORIES as readonly CategorySlug[])
    .map((c) => ({ slug: c, label: CATEGORY_LABELS[c], count: categoryCounts[c] ?? 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const tagChips = (TAGS as readonly TagSlug[])
    .map((t) => ({ slug: t, label: TAG_LABELS[t], count: tagCounts[t] ?? 0 }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const hrefFor = (params: Record<string, string>) => {
    const search = new URLSearchParams(params);
    return `${basePath}${search.size ? `?${search.toString()}` : ""}`;
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <Chip
        href={hrefFor({})}
        active={filter.kind === "all"}
        label="All"
        kind="all"
      />
      {catChips.map((c) => (
        <Chip
          key={`cat:${c.slug}`}
          href={hrefFor({ cat: c.slug })}
          active={filter.kind === "category" && filter.slug === c.slug}
          label={c.label}
          count={c.count}
          kind="category"
        />
      ))}
      {tagChips.length > 0 && (
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      )}
      {tagChips.map((t) => (
        <Chip
          key={`tag:${t.slug}`}
          href={hrefFor({ tag: t.slug })}
          active={filter.kind === "tag" && filter.slug === t.slug}
          label={t.label}
          count={t.count}
          kind="tag"
        />
      ))}
      {unmappedCount > 0 && (
        <>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <Chip
            href={hrefFor({ unmapped: "1" })}
            active={filter.kind === "unmapped"}
            label={`Unmapped ${entityLabel}s`}
            count={unmappedCount}
            kind="unmapped"
          />
        </>
      )}
    </div>
  );
}

function Chip({
  href,
  active,
  label,
  count,
  kind,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
  kind: "all" | "category" | "tag" | "unmapped";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors",
        active
          ? kind === "unmapped"
            ? "border-flag-high bg-flag-high-bg text-flag-high"
            : "border-foreground bg-foreground text-background"
          : cn(
              "border-border text-muted-foreground hover:bg-muted/40",
              kind === "tag" && "italic",
              kind === "unmapped" && "border-flag-high/40 text-flag-high",
            ),
      )}
    >
      <span>{label}</span>
      {count != null && (
        <span
          className={cn(
            "font-mono text-[10.5px]",
            active ? "opacity-80" : "opacity-60",
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
