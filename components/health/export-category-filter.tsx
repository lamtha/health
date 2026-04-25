"use client";

import {
  CATEGORIES,
  CATEGORY_LABELS,
  TAGS,
  TAG_LABELS,
  type CategorySlug,
  type TagSlug,
} from "@/db/seeds/taxonomy";
import { cn } from "@/lib/utils";

export interface ExportCategoryFilterProps {
  categoryCounts: Record<string, number>;
  tagCounts: Record<string, number>;
  activeCategories: Set<string>;
  activeTags: Set<string>;
  // Clicking a chip both toggles the filter and check/unchecks every
  // candidate matching it — so chip state and selection stay in sync.
  onToggleCategory: (slug: string) => void;
  onToggleTag: (slug: string) => void;
  onClearAll: () => void;
}

export function ExportCategoryFilter({
  categoryCounts,
  tagCounts,
  activeCategories,
  activeTags,
  onToggleCategory,
  onToggleTag,
  onClearAll,
}: ExportCategoryFilterProps) {
  const catChips = (CATEGORIES as readonly CategorySlug[])
    .map((c) => ({ slug: c, label: CATEGORY_LABELS[c], count: categoryCounts[c] ?? 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const tagChips = (TAGS as readonly TagSlug[])
    .map((t) => ({ slug: t, label: TAG_LABELS[t], count: tagCounts[t] ?? 0 }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const allActive = activeCategories.size === 0 && activeTags.size === 0;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <Chip
        active={allActive}
        label="All"
        kind="all"
        onClick={() => onClearAll()}
      />
      {catChips.map((c) => (
        <Chip
          key={`cat:${c.slug}`}
          active={activeCategories.has(c.slug)}
          label={c.label}
          count={c.count}
          kind="category"
          onClick={() => onToggleCategory(c.slug)}
        />
      ))}
      {tagChips.length > 0 && (
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      )}
      {tagChips.map((t) => (
        <Chip
          key={`tag:${t.slug}`}
          active={activeTags.has(t.slug)}
          label={t.label}
          count={t.count}
          kind="tag"
          onClick={() => onToggleTag(t.slug)}
        />
      ))}
    </div>
  );
}

function Chip({
  active,
  label,
  count,
  kind,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  kind: "all" | "category" | "tag";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : cn(
              "border-border text-muted-foreground hover:bg-muted/40",
              kind === "tag" && "italic",
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
    </button>
  );
}
