"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
export function DiagnosticActions() {
  useEffect(() => {
    let closed: HTMLDetailsElement[] = [];
    const expand = () => { closed = Array.from(document.querySelectorAll<HTMLDetailsElement>("main details:not([open])")); closed.forEach(el => { el.open = true; }); };
    const restore = () => { closed.forEach(el => { el.open = false; }); closed = []; };
    window.addEventListener("beforeprint", expand);
    window.addEventListener("afterprint", restore);
    return () => { window.removeEventListener("beforeprint", expand); window.removeEventListener("afterprint", restore); restore(); };
  }, []);
  return <div className="flex flex-wrap gap-2 print:hidden">
    <Button variant="outline" size="sm" onClick={() => window.print()}>Print / Save PDF</Button>
    <Button asChild variant="outline" size="sm"><a href="/api/diagnostic/export">Download review data</a></Button>
  </div>;
}
