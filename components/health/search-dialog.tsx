"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CATEGORY_LABELS } from "@/db/seeds/taxonomy";
import { providerDisplayName } from "@/lib/providers";
import type { SearchResult } from "@/lib/search";

export interface SearchDialogHandle {
  open: () => void;
  close: () => void;
}

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!query.trim()) {
      setResult({ query: "", metrics: [], unmapped: [], reports: [] });
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) setResult((await res.json()) as SearchResult);
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResult(null);
      setLoading(false);
    }
  }, [open]);

  const metrics = result?.metrics ?? [];
  const unmapped = result?.unmapped ?? [];
  const reports = result?.reports ?? [];
  const anyResults = metrics.length + unmapped.length + reports.length > 0;

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Search</DialogTitle>
        <DialogDescription>Find metrics, reports, and providers</DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden p-0">
        <Command
          // Disable cmdk's built-in filter — results are already server-filtered.
          shouldFilter={false}
          className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
        placeholder="Search metrics, providers, dates (e.g. WBC, Quest, 2024-03)…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && query.trim() && !anyResults ? (
          <CommandEmpty>Searching…</CommandEmpty>
        ) : !query.trim() ? (
          <CommandEmpty>Start typing to search.</CommandEmpty>
        ) : !anyResults ? (
          <CommandEmpty>No matches.</CommandEmpty>
        ) : null}

        {metrics.length > 0 && (
          <CommandGroup heading="Metrics">
            {metrics.map((m) => (
              <CommandItem
                key={`m:${m.canonicalMetricId}`}
                value={`metric-${m.canonicalMetricId}`}
                onSelect={() =>
                  go(`/metric/${encodeURIComponent(m.canonicalName)}`)
                }
              >
                <div className="flex w-full items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-foreground">
                      {m.canonicalName}
                    </div>
                    {m.matchedAlias &&
                      !m.canonicalName.toLowerCase().includes(query.toLowerCase()) && (
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          via alias “{m.matchedAlias}”
                        </div>
                      )}
                  </div>
                  <div className="shrink-0 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    {CATEGORY_LABELS[m.category as keyof typeof CATEGORY_LABELS] ?? m.category}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {unmapped.length > 0 && (
          <>
            {metrics.length > 0 && <CommandSeparator />}
            <CommandGroup heading="Unmapped metrics">
              {unmapped.map((u) => (
                <CommandItem
                  key={`u:${u.rawName}`}
                  value={`unmapped-${u.rawName}`}
                  onSelect={() =>
                    go(`/metric/${encodeURIComponent(u.rawName)}`)
                  }
                >
                  <div className="flex w-full items-baseline justify-between gap-2">
                    <div className="truncate text-[13px] text-foreground">
                      {u.rawName}
                    </div>
                    <div className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                      {u.occurrenceCount} row{u.occurrenceCount === 1 ? "" : "s"}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {reports.length > 0 && (
          <>
            {(metrics.length > 0 || unmapped.length > 0) && <CommandSeparator />}
            <CommandGroup heading="Reports">
              {reports.map((r) => (
                <CommandItem
                  key={`r:${r.id}`}
                  value={`report-${r.id}`}
                  onSelect={() => go(`/reports/${r.id}`)}
                >
                  <div className="flex w-full items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-foreground">
                        {providerDisplayName(r.provider)}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {r.category}
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {r.reportDate ?? "—"}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
