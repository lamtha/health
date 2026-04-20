"use client";

import { useEffect, useState } from "react";

import { SearchDialog } from "@/components/health/search-dialog";

const OPEN_EVENT = "health:open-search";

// Mounted once at the layout level. Owns the dialog state, listens for
// ⌘K globally, and listens for a custom window event dispatched by
// triggers elsewhere in the UI (top-bar chip, dashboard input, etc.).
export function SearchPortal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, []);

  return <SearchDialog open={open} onOpenChange={setOpen} />;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

// Dispatch from any client component to open the dialog.
export function openSearchDialog() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
  }
}
