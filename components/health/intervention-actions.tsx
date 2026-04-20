"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function today(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

// Stop-intervention controls. Collapses to a single "Stop today" button
// + "Custom date…" affordance.
export function StopIntervention({
  id,
  disabled,
}: {
  id: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [showCustom, setShowCustom] = useState(false);
  const [stoppedOn, setStoppedOn] = useState(today());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function stopOn(date: string) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/interventions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          stoppedOn: date,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setShowCustom(false);
      setNote("");
      router.refresh();
    });
  }

  if (disabled) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => stopOn(today())}
        disabled={isPending || showCustom}
      >
        Stop today
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setShowCustom((v) => !v)}
        disabled={isPending}
      >
        {showCustom ? "Cancel" : "Custom date…"}
      </Button>
      {showCustom && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={stoppedOn}
            onChange={(e) => setStoppedOn(e.target.value)}
            className="h-8 w-36"
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            className="h-8 w-48"
          />
          <Button
            size="sm"
            onClick={() => stopOn(stoppedOn)}
            disabled={isPending}
          >
            Stop
          </Button>
        </div>
      )}
      {error && <span className="text-[11px] text-flag-high">{error}</span>}
    </div>
  );
}

export function DeleteIntervention({ id }: { id: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/interventions/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push("/interventions");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {confirm ? (
        <>
          <Button size="sm" variant="destructive" onClick={run} disabled={isPending}>
            {isPending ? "Deleting…" : "Really delete"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirm(true)}
          className={cn("text-flag-high hover:text-flag-high")}
        >
          Delete
        </Button>
      )}
      {error && <span className="text-[11px] text-flag-high">{error}</span>}
    </div>
  );
}

export function ChangeDose({
  id,
  currentDose,
}: {
  id: number;
  currentDose: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newDose, setNewDose] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [occurredOn, setOccurredOn] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function save() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/interventions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "change",
          dose: newDose.trim() || null,
          occurredOn,
          changeNote: changeNote.trim() || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setOpen(false);
      setNewDose("");
      setChangeNote("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Record dose change
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 text-[12.5px]">
        Current dose:{" "}
        <span className="font-mono">{currentDose ?? "—"}</span>
      </div>
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
        <Input
          value={newDose}
          onChange={(e) => setNewDose(e.target.value)}
          placeholder="New dose (leave empty for “stopped this dose”)"
          className="h-8"
        />
        <Input
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
          className="h-8"
        />
        <Input
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          placeholder="Note (optional)"
          className="h-8"
        />
      </div>
      {error && <p className="mt-2 text-[11px] text-flag-high">{error}</p>}
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={isPending}>
          {isPending ? "Saving…" : "Save change"}
        </Button>
      </div>
    </div>
  );
}
