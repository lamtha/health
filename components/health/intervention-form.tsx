"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  INTERVENTION_KINDS,
  type InterventionKind,
} from "@/lib/interventions-kinds";

const KIND_LABELS: Record<InterventionKind, string> = {
  supplement: "Supplement",
  med: "Medication",
  diet: "Diet",
  protocol: "Protocol",
};

function today(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function InterventionForm({ expanded }: { expanded?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!expanded);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<InterventionKind>("supplement");
  const [dose, setDose] = useState("");
  const [notes, setNotes] = useState("");
  const [startedOn, setStartedOn] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("name is required");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/interventions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          dose: dose.trim() || null,
          notes: notes.trim() || null,
          startedOn,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setName("");
      setDose("");
      setNotes("");
      setStartedOn(today());
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>+ Start intervention</Button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="font-serif-display mb-3 text-[18px]">
        Start an intervention
      </div>
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
        <div>
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Berberine 500mg BID"
            className="h-9"
          />
        </div>
        <div>
          <Label>Kind</Label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as InterventionKind)}
            className={cn(
              "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-[13px]",
            )}
          >
            {INTERVENTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Started</Label>
          <Input
            type="date"
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
            className="h-9"
          />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <Label>Dose</Label>
          <Input
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            placeholder="optional — e.g. 500mg twice daily"
            className="h-9"
          />
        </div>
        <div>
          <Label>Notes</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="optional"
            className="h-9"
          />
        </div>
      </div>
      {error && <p className="mt-2 text-[12px] text-flag-high">Error: {error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button onClick={submit} size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Start"}
        </Button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground">
      {children}
    </label>
  );
}
