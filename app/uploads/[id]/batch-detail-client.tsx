"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { BatchView } from "@/lib/batch-runner";

const POLL_MS = 1500;

const STATUS_CLASSES: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  extracting: "bg-primary/10 text-primary",
  saved: "bg-flag-ok-bg text-flag-ok",
  duplicate: "bg-amber-100 text-amber-800",
  error: "bg-destructive/10 text-destructive",
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function BatchDetailClient({ initial }: { initial: BatchView }) {
  const [batch, setBatch] = useState<BatchView>(initial);
  const batchRef = useRef(batch);
  batchRef.current = batch;

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/uploads/${initial.id}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const json = (await res.json()) as { batch: BatchView };
          if (!cancelled) setBatch(json.batch);
        }
      } catch {
        // swallow — next tick will retry
      }
    };

    const interval = setInterval(() => {
      const inFlight =
        (batchRef.current.counts.queued ?? 0) +
        (batchRef.current.counts.extracting ?? 0);
      if (inFlight > 0) void tick();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [initial.id]);

  const counts = batch.counts;
  const saved = counts.saved ?? 0;
  const dupe = counts.duplicate ?? 0;
  const err = counts.error ?? 0;
  const queued = counts.queued ?? 0;
  const extracting = counts.extracting ?? 0;
  const inFlight = queued + extracting;
  const done = inFlight === 0;

  return (
    <div className="space-y-4 px-8 pb-10">
      <Card className="py-0">
        <CardHeader className="flex flex-row items-center justify-between border-b px-5 py-3">
          <div>
            <CardTitle className="text-[13px]">
              {batch.totalCount} file{batch.totalCount === 1 ? "" : "s"}
            </CardTitle>
            <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
              {saved} saved · {dupe} duplicate · {err} error · {extracting} extracting · {queued} queued
            </div>
          </div>
          {done ? (
            <Link
              href="/uploads"
              className="rounded-md border px-3 py-1 text-[12px] hover:bg-muted"
            >
              ← All batches
            </Link>
          ) : (
            <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <Spinner />
              processing…
            </span>
          )}
        </CardHeader>

        <div className="max-h-[640px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detected</TableHead>
                <TableHead className="pr-5 text-right">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="pl-5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">
                        {it.originalFilename}
                      </div>
                      <div className="font-mono text-[10.5px] text-muted-foreground">
                        {formatBytes(it.sizeBytes)}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={it.status} />
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {it.provider ? (
                      <>
                        {it.provider}
                        {it.category ? ` · ${it.category}` : ""}
                        {it.reportDate ? ` · ${it.reportDate}` : ""}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right font-mono text-[11.5px]">
                    {it.status === "saved" && it.reportId != null ? (
                      <Link
                        href={`/reports/${it.reportId}`}
                        className="text-foreground hover:underline"
                      >
                        #{it.reportId} · {it.metricCount ?? 0} metrics →
                      </Link>
                    ) : it.status === "duplicate" &&
                      it.duplicateReportId != null ? (
                      <Link
                        href={`/reports/${it.duplicateReportId}`}
                        className="text-muted-foreground hover:underline"
                      >
                        existing #{it.duplicateReportId} →
                      </Link>
                    ) : it.status === "error" ? (
                      <span
                        className="text-destructive"
                        title={it.errorMessage ?? undefined}
                      >
                        {truncate(it.errorMessage ?? "failed", 60)}
                      </span>
                    ) : (
                      <span className="text-border">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <CardFooter className="border-t px-5 py-3 text-[12px] text-muted-foreground">
          Status is server-backed — safe to navigate away and come back.
        </CardFooter>
      </Card>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_CLASSES[status] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider",
        cls,
      )}
    >
      {status}
    </span>
  );
}

function Spinner() {
  return (
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
  );
}
