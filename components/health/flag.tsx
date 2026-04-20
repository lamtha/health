import { cn } from "@/lib/utils";

export type FlagValue = "high" | "low" | "ok" | null | undefined;

export function Flag({ flag }: { flag: FlagValue }) {
  const base =
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wider";
  if (flag === "high")
    return (
      <span
        className={cn(
          base,
          "border-flag-high/20 bg-flag-high-bg text-flag-high",
        )}
      >
        High
      </span>
    );
  if (flag === "low")
    return (
      <span
        className={cn(base, "border-flag-low/20 bg-flag-low-bg text-flag-low")}
      >
        Low
      </span>
    );
  if (flag === "ok")
    return (
      <span
        className={cn(base, "border-flag-ok/20 bg-flag-ok-bg text-flag-ok")}
      >
        In range
      </span>
    );
  return <span className="text-border">·</span>;
}
