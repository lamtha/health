"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { providerDisplayName } from "@/lib/providers";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  TAGS,
  TAG_LABELS,
  type CategorySlug,
  type TagSlug,
} from "@/db/seeds/taxonomy";

export interface CanonicalOptionView {
  id: number;
  canonicalName: string;
  category: string;
}

export interface UnmappedRowProps {
  rawName: string;
  occurrenceCount: number;
  providers: string[];
  sampleReportId: number;
  sampleReportDate: string | null;
  sampleValue: string;
  sampleUnits: string | null;
  canonicals: CanonicalOptionView[];
}

export function MappingRow({
  rawName,
  occurrenceCount,
  providers,
  sampleReportId,
  sampleReportDate,
  sampleValue,
  sampleUnits,
  canonicals,
}: UnmappedRowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newName, setNewName] = useState(rawName);
  const [newCategory, setNewCategory] = useState<CategorySlug>("other");
  const [newTags, setNewTags] = useState<TagSlug[]>([]);
  const [newUnits, setNewUnits] = useState(sampleUnits ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return canonicals.slice(0, 12);
    return canonicals
      .filter(
        (c) =>
          c.canonicalName.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [canonicals, query]);

  function toggleTag(tag: TagSlug) {
    setNewTags((cur) =>
      cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag],
    );
  }

  async function save() {
    setError(null);
    const body: Record<string, unknown> = {
      rawName,
      // Global alias for now — /mappings defaults to global scope. A
      // provider-scoped override would be a follow-up affordance.
      providerScope: "",
    };
    if (mode === "existing") {
      if (!selectedId) {
        setError("pick a canonical metric");
        return;
      }
      body.canonicalMetricId = selectedId;
    } else {
      if (!newName.trim()) {
        setError("new canonical name is required");
        return;
      }
      body.newCanonical = {
        canonicalName: newName.trim(),
        category: newCategory,
        tags: newTags,
        preferredUnits: newUnits.trim() || null,
        description: "",
      };
    }

    startTransition(async () => {
      const res = await fetch("/api/mappings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-4 transition-opacity",
        saved ? "opacity-50" : "",
      )}
    >
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <div className="font-serif-display truncate text-[18px] leading-tight">
            {rawName}
          </div>
          <div className="mt-1 font-mono text-[11.5px] text-muted-foreground">
            {occurrenceCount} row{occurrenceCount === 1 ? "" : "s"} ·{" "}
            {providers.map(providerDisplayName).join(", ")} · sample{" "}
            <span className="text-foreground">
              {sampleValue}
              {sampleUnits ? ` ${sampleUnits}` : ""}
            </span>{" "}
            ({sampleReportDate ?? "—"}, report {sampleReportId})
          </div>
        </div>
        <div className="shrink-0 text-[11px] font-mono text-muted-foreground">
          {saved ? "mapped ✓" : ""}
        </div>
      </div>

      {!saved && (
        <>
          <div className="mt-3 flex gap-1 border-b border-border">
            <ModeTab
              active={mode === "existing"}
              onClick={() => setMode("existing")}
            >
              Map to existing
            </ModeTab>
            <ModeTab active={mode === "new"} onClick={() => setMode("new")}>
              Create new canonical
            </ModeTab>
          </div>

          {mode === "existing" ? (
            <div className="mt-3">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search canonical metrics…"
                className="h-9"
              />
              <ul className="mt-2 max-h-52 overflow-y-auto rounded-md border border-border">
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-[12px] text-muted-foreground">
                    No matches — try a different term or switch to “Create new”.
                  </li>
                ) : (
                  filtered.map((c) => (
                    <li
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "cursor-pointer border-b border-border px-3 py-2 text-[13px] last:border-b-0",
                        selectedId === c.id
                          ? "bg-muted/60 text-foreground"
                          : "hover:bg-muted/30",
                      )}
                    >
                      <div className="font-medium">{c.canonicalName}</div>
                      <div className="font-mono text-[10.5px] text-muted-foreground">
                        {c.category}
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div>
                <Label>Canonical name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Category</Label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as CategorySlug)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Preferred units</Label>
                  <Input
                    value={newUnits}
                    onChange={(e) => setNewUnits(e.target.value)}
                    className="h-9"
                    placeholder="e.g. mg/dL"
                  />
                </div>
              </div>
              <div>
                <Label>Tags</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {TAGS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      className={cn(
                        "inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-medium transition-colors",
                        newTags.includes(t)
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground hover:bg-muted/40",
                      )}
                    >
                      {TAG_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-2 text-[12px] text-flag-high">Error: {error}</p>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              onClick={save}
              disabled={isPending || (mode === "existing" && !selectedId)}
              size="sm"
            >
              {isPending
                ? "Saving…"
                : mode === "existing"
                  ? "Map & backfill"
                  : "Create & backfill"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground">
      {children}
    </label>
  );
}
