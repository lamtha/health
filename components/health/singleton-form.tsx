"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function today(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function SingletonForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [occurredOn, setOccurredOn] = useState(today());
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function save() {
    setError(null);
    if (!description.trim()) {
      setError("description is required");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          occurredOn,
          description: description.trim(),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setDescription("");
      setOccurredOn(today());
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ Log event</Button>;
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="font-serif-display mb-3 text-[18px]">
        Log a one-off event
      </div>
      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <div>
          <Label>Date</Label>
          <Input
            type="date"
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            className="h-9"
          />
        </div>
        <div>
          <Label>Description</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Stomach flu; 3-day trip to Bali"
            className="h-9"
          />
        </div>
      </div>
      {error && <p className="mt-2 text-[12px] text-flag-high">Error: {error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
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

export function DeleteSingleton({ id }: { id: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function run() {
    if (!confirm("Delete this event?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    });
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={run}
      disabled={isPending}
      className="text-muted-foreground hover:text-flag-high"
    >
      Delete
    </Button>
  );
}
