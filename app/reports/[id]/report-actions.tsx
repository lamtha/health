"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function ReExtractButton({
  reportId,
  disabled,
}: {
  reportId: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (
      !window.confirm(
        "Re-extract this report? This re-sends the PDF to Claude and replaces the stored metrics with the new result.",
      )
    ) {
      return;
    }
    setPhase("running");
    setMessage(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/re-extract`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setPhase("error");
        setMessage(json.error ?? "Re-extract failed");
        return;
      }
      setPhase("idle");
      setMessage(
        `Done · ${json.metricCount} metrics · ${(json.elapsedMs / 1000).toFixed(1)}s`,
      );
      router.refresh();
    } catch (err) {
      setPhase("error");
      setMessage((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        onClick={run}
        disabled={disabled || phase === "running"}
      >
        {phase === "running" ? "Re-extracting…" : "Re-extract"}
      </Button>
      {message && (
        <span
          className={
            phase === "error"
              ? "font-mono text-[10.5px] text-flag-high"
              : "font-mono text-[10.5px] text-muted-foreground"
          }
        >
          {message}
        </span>
      )}
    </div>
  );
}
