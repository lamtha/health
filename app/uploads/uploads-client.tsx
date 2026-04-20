"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function UploadsDropzone() {
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(
    async (list: FileList | File[]) => {
      const arr = Array.from(list).filter(
        (f) => !f.type || f.type === "application/pdf",
      );
      if (arr.length === 0) {
        setError("Only PDFs are supported.");
        return;
      }
      setBusy(true);
      setError(null);
      const body = new FormData();
      for (const f of arr) body.append("files", f);
      try {
        const res = await fetch("/api/uploads", { method: "POST", body });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error || `HTTP ${res.status}`);
          setBusy(false);
          return;
        }
        router.push(`/uploads/${json.batchId}`);
      } catch (err) {
        setError((err as Error).message);
        setBusy(false);
      }
    },
    [router],
  );

  return (
    <div className="space-y-3">
      {error && (
        <Card className="border-destructive/30 bg-destructive/5 py-3">
          <CardContent className="text-[13px] text-destructive">
            {error}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="px-5 py-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                void submit(e.dataTransfer.files);
              }
            }}
            onClick={() => !busy && inputRef.current?.click()}
            role="button"
            tabIndex={0}
            className={cn(
              "flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-muted/30 p-8 text-center transition-colors",
              dragOver && "border-primary bg-muted/60",
              busy && "cursor-wait opacity-60",
            )}
          >
            <div className="font-serif-display text-[22px]">
              {busy ? "Uploading…" : "Drop PDF(s) here"}
            </div>
            <div className="text-[12.5px] text-muted-foreground">
              files stage on the server, then extract in the background ·
              duplicates skipped by hash
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              multiple
              disabled={busy}
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  void submit(e.target.files);
                }
                e.target.value = "";
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
