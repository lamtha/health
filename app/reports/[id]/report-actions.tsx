"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ParserChoice = "offline" | "claude";

export function ReExtractButton({
  reportId,
  disabled,
}: {
  reportId: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [choice, setChoice] = useState<ParserChoice>("offline");

  async function run() {
    setPhase("running");
    setMessage(null);
    try {
      const url = `/api/reports/${reportId}/re-extract?parser=${choice}`;
      const res = await fetch(url, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setPhase("error");
        setMessage(json.error ?? "Re-extract failed");
        return;
      }
      setPhase("idle");
      setOpen(false);
      setMessage(
        `Done · ${json.metricCount} metrics · ${json.model} · ${(json.elapsedMs / 1000).toFixed(1)}s`,
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
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Re-extract
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

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (phase === "running") return;
          setOpen(next);
          if (!next) setPhase("idle");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-extract this report</DialogTitle>
            <DialogDescription>
              Stored metrics will be replaced with the new result. Choose how
              the PDF gets re-parsed.
            </DialogDescription>
          </DialogHeader>

          <fieldset
            className="grid gap-2"
            aria-label="Parser"
            disabled={phase === "running"}
          >
            <ParserOption
              selected={choice === "offline"}
              onSelect={() => setChoice("offline")}
              title="Offline parser"
              badge="Default · PDF stays on this machine"
              description="Runs the deterministic parser locally. The PDF is never uploaded. Errors out if no parser matches this report — pick Claude API in that case."
            />
            <ParserOption
              selected={choice === "claude"}
              onSelect={() => setChoice("claude")}
              title="Claude API"
              badge="Uploads PDF to Anthropic"
              description="Sends the PDF to Claude for extraction. Works on any format, but the report leaves your machine and uses your API key."
            />
          </fieldset>

          {phase === "error" && message && (
            <div className="rounded-md border border-flag-high/40 bg-flag-high/5 px-3 py-2 font-mono text-[11px] text-flag-high">
              {message}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={phase === "running"}
            >
              Cancel
            </Button>
            <Button onClick={run} disabled={phase === "running"}>
              {phase === "running" ? "Re-extracting…" : "Re-extract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ParserOption({
  selected,
  onSelect,
  title,
  badge,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  badge: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors",
        selected
          ? "border-foreground bg-accent"
          : "border-border bg-background hover:border-foreground/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {badge}
        </span>
      </div>
      <span className="text-[11px] leading-snug text-muted-foreground">
        {description}
      </span>
    </button>
  );
}
