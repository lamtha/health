"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { X } from "lucide-react";

// Dismissal persists across reloads via localStorage. Keyed by count so
// the banner re-appears if new unmapped rows show up after a dismiss:
//   dismissed at 65 → stays hidden while count ≤ 65
//   later count of 80 → banner re-appears (you never dismissed at 80)
const STORAGE_KEY = "health:unmapped-banner-dismissed-at";

export function UnmappedBanner({
  metricRows,
  distinctNames,
}: {
  metricRows: number;
  distinctNames: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setDismissedAt(Number(stored));
    } catch {
      // localStorage unavailable (e.g. private mode) — always show.
    }
  }, []);

  if (!mounted) return null;
  if (dismissedAt !== null && distinctNames <= dismissedAt) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(distinctNames));
    } catch {
      // ignore
    }
    setDismissedAt(distinctNames);
  };

  return (
    <div className="mb-4 flex items-center justify-between rounded-lg border border-flag-high/30 bg-flag-high-bg px-4 py-2.5 text-[13px]">
      <Link
        href="/mappings"
        className="flex flex-1 items-center justify-between transition-opacity hover:opacity-80"
      >
        <div>
          <span className="font-medium text-foreground">
            {distinctNames} unmapped metric name{distinctNames === 1 ? "" : "s"}
          </span>
          <span className="ml-1.5 font-mono text-[11.5px] text-muted-foreground">
            · {metricRows} row{metricRows === 1 ? "" : "s"} not linked to a canonical
          </span>
        </div>
        <span className="mr-3 font-mono text-[11.5px] text-foreground">
          Map them →
        </span>
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="ml-2 rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
